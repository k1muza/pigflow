import type { PlannerConfig } from "../config";
import { Farm, horizonDay } from "../sim";
import { Engine, runEngine } from "./engine";
import { LEGACY_POLICIES, type Policies } from "./world";

/**
 * Running both engines against the same configuration, and saying where they
 * differ.
 *
 * This is the thing that makes a rewrite safe to do in public. The 1.x farm is
 * not going anywhere: it is the established answer, and every 2.0 number is read
 * against it. With all four 2.0 subsystems switched off the two engines are
 * meant to agree exactly — that is the claim the parity test makes — and once
 * they do, turning a subsystem on and re-running the comparison shows precisely
 * what that subsystem changed, with nothing else moving underneath it.
 *
 * Without this you get the usual rewrite: a second engine that gives different
 * answers, no way to tell which differences are the new modelling and which are
 * porting mistakes, and no way to ship either one with any confidence.
 */

/** The figures a plan is actually read on, which is what a comparison compares. */
export type ParityMetrics = {
  pigsSold: number;
  bornAlive: number;
  weaned: number;
  deaths: number;
  litters: number;
  servicesAttempted: number;
  soldLiveweightKg: number;
  feedKg: number;
  lorries: number;
  closingCash: number;
  totalRevenue: number;
  totalCost: number;
  peakHead: number;
  fullCostPerDeadweightKg: number;
  finalSows: number;
  /** 2.0 only: zero on a 1.x run, and zero on a 2.0 run with the switches down. */
  movementsBlocked: number;
  heatsMissed: number;
  feedShortfallKg: number;
};

export type ParityLine = {
  metric: keyof ParityMetrics;
  baseline: number;
  candidate: number;
  delta: number;
  /** Change against the baseline, or null where the baseline is zero. */
  deltaPct: number | null;
  /** Whether this one is inside the tolerance for the run being made. */
  matched: boolean;
};

export type ParityReport = {
  policies: Policies;
  /** True when every metric matched — which is what a legacy-mode run must do. */
  identical: boolean;
  lines: ParityLine[];
  /** Only the lines that moved, which is usually what a reader wants. */
  divergences: ParityLine[];
};

/** Money to the cent, head to the animal: a metric is not a floating-point sum. */
const TOLERANCE = 1e-6;

/** Reads the 1.x farm's numbers off a completed run. */
export function baselineMetrics(farm: Farm): ParityMetrics {
  const last = farm.history.at(-1);
  const state = farm.state();
  const cost = farm.costOfProduction();
  return {
    pigsSold: farm.lifetime.sold,
    bornAlive: farm.lifetime.bornAlive,
    weaned: farm.lifetime.weaned,
    deaths:
      farm.lifetime.pigletDeaths + farm.lifetime.growingDeaths + farm.lifetime.breedingDeaths,
    litters: farm.lifetime.litters,
    servicesAttempted: farm.lifetime.servicesAttempted,
    soldLiveweightKg: farm.lifetime.soldLiveweightKg,
    feedKg: farm.history.reduce((sum, day) => sum + day.sowFeedKg + day.growingFeedKg, 0),
    lorries: farm.lifetime.lorries,
    closingCash: last?.closingCash ?? 0,
    totalRevenue: farm.ledger.income,
    totalCost: farm.ledger.expenses,
    peakHead: farm.history.reduce((peak, day) => Math.max(peak, day.counts.total), 0),
    fullCostPerDeadweightKg: cost.fullCostPerDeadweightKg,
    finalSows: state.herd.sows,
    movementsBlocked: 0,
    heatsMissed: 0,
    feedShortfallKg: 0,
  };
}

/** Reads the 2.0 engine's numbers off a completed run. */
export function candidateMetrics(engine: Engine): ParityMetrics {
  const world = engine.world;
  const last = world.history.at(-1);
  const cost = engine.costOfProduction();
  return {
    pigsSold: world.lifetime.sold,
    bornAlive: world.lifetime.bornAlive,
    weaned: world.lifetime.weaned,
    deaths:
      world.lifetime.pigletDeaths + world.lifetime.growingDeaths + world.lifetime.breedingDeaths,
    litters: world.lifetime.litters,
    servicesAttempted: world.lifetime.servicesAttempted,
    soldLiveweightKg: world.lifetime.soldLiveweightKg,
    feedKg: world.history.reduce((sum, day) => sum + day.sowFeedKg + day.growingFeedKg, 0),
    lorries: world.lifetime.lorries,
    closingCash: last?.closingCash ?? 0,
    totalRevenue: world.ledger.income,
    totalCost: world.ledger.expenses,
    peakHead: world.history.reduce((peak, day) => Math.max(peak, day.counts.total), 0),
    fullCostPerDeadweightKg: cost.fullCostPerDeadweightKg,
    finalSows: last?.counts.sows ?? 0,
    movementsBlocked: world.lifetime.movementsBlocked,
    heatsMissed: world.lifetime.heatsMissed,
    feedShortfallKg: world.lifetime.feedShortfallKg,
  };
}

export function compareMetrics(
  baseline: ParityMetrics,
  candidate: ParityMetrics,
  policies: Policies,
  tolerance = TOLERANCE,
): ParityReport {
  const lines: ParityLine[] = (Object.keys(baseline) as (keyof ParityMetrics)[]).map((metric) => {
    const a = baseline[metric];
    const b = candidate[metric];
    const delta = b - a;
    const scale = Math.max(Math.abs(a), 1);
    return {
      metric,
      baseline: a,
      candidate: b,
      delta,
      deltaPct: a === 0 ? null : (delta / Math.abs(a)) * 100,
      matched: Math.abs(delta) <= tolerance * scale,
    };
  });
  return {
    policies,
    identical: lines.every((line) => line.matched),
    lines,
    divergences: lines.filter((line) => !line.matched),
  };
}

/**
 * Runs the 1.x farm and the 2.0 engine over the same plan and reports the
 * difference. With no policy overrides the 2.0 run uses whatever the plan asks
 * for; pass {@link LEGACY_POLICIES} to make the assertion that the port itself
 * changed nothing.
 */
export function compareEngines(
  config: PlannerConfig,
  options: { policies?: Partial<Policies>; throughDay?: number; tolerance?: number } = {},
): ParityReport {
  const through = options.throughDay ?? horizonDay(config);
  const farm = new Farm(config).advanceTo(through);
  const policies: Policies = { ...LEGACY_POLICIES, ...options.policies };
  const engine = runEngine(config, through, { policies });
  return compareMetrics(
    baselineMetrics(farm),
    candidateMetrics(engine),
    engine.policies,
    options.tolerance,
  );
}

/**
 * The migration table: what each 2.0 subsystem changes, one at a time, against
 * the same baseline. This is the read-out the rewrite is steered by — turn a
 * subsystem on, see what it moved, decide whether that is the modelling you
 * meant or a bug you have just found.
 */
export function migrationReport(
  config: PlannerConfig,
  throughDay = horizonDay(config),
): { subsystem: string; report: ParityReport }[] {
  const subsystems: { subsystem: string; policies: Partial<Policies> }[] = [
    { subsystem: "none (port only)", policies: {} },
    { subsystem: "housing capacity", policies: { enforceHousing: true } },
    { subsystem: "estrus windows", policies: { enforceEstrusWindows: true } },
    { subsystem: "operational procurement", policies: { operationalProcurement: true } },
    { subsystem: "accrual accounting", policies: { accrualAccounting: true } },
    {
      subsystem: "all four",
      policies: {
        enforceHousing: true,
        enforceEstrusWindows: true,
        operationalProcurement: true,
        accrualAccounting: true,
      },
    },
  ];
  return subsystems.map(({ subsystem, policies }) => ({
    subsystem,
    report: compareEngines(config, { policies, throughDay }),
  }));
}

/** The migration table as text, for a terminal or a commit message. */
export function formatMigrationReport(
  rows: { subsystem: string; report: ParityReport }[],
): string {
  const lines: string[] = [];
  for (const { subsystem, report } of rows) {
    lines.push("## " + subsystem);
    if (report.identical) {
      lines.push("   identical to the 1.x baseline");
      continue;
    }
    for (const line of report.divergences) {
      const pct = line.deltaPct === null ? "" : ` (${line.deltaPct >= 0 ? "+" : ""}${line.deltaPct.toFixed(1)}%)`;
      lines.push(
        "   " +
          line.metric.padEnd(26) +
          fixed(line.baseline) +
          " -> " +
          fixed(line.candidate) +
          pct,
      );
    }
  }
  return lines.join("\n");
}

function fixed(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}
