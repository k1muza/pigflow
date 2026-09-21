/**
 * The optimiser tuning loop.
 *
 * This is not part of the test suite. It is the bench the procurement policies
 * are tuned on: it runs V1 perfect foresight as the ideal, runs one or more
 * operational candidates against it over 3, 5, 10 and 20 years, and prints what
 * each candidate's decisions cost over the ideal.
 *
 * It lives behind `npm run bench:optimizer` rather than in `npm test` because a
 * full sweep is minutes of simulation, and because its job is to produce numbers
 * a person reads and acts on — not a pass or a fail. What it settles on gets
 * locked into `optimizer-benchmark.test.ts` as a regression gate.
 *
 *   npm run bench:optimizer                                  # policy vs the oracle
 *   BENCH_MODE=sweep npm run bench:optimizer                 # sweep the tuning knobs
 *   BENCH_YEARS=3,5 BENCH_MODE=sweep npm run bench:optimizer
 *   BENCH_SOWS=200 npm run bench:optimizer
 *
 * In PowerShell: `$env:BENCH_MODE="sweep"; npm run bench:optimizer`.
 *
 * The `BENCH_` prefix is not decoration. Vitest sets `MODE` in the child process
 * this runs in, so a bare `MODE=sweep` is silently overwritten with "test" and
 * the bench quietly does something other than what was asked of it — which it
 * did, once, and the tables looked perfectly reasonable.
 */
import { describe, it } from "vitest";

import { cloneDefaultConfig, type PlannerConfig } from "../../config";
import {
  OPTIMIZER_BENCHMARK_YEARS,
  sweepOptimizer,
  type OptimizerBenchmarkRow,
  type OptimizerCandidate,
} from "./optimizer-benchmark";

const years = (process.env.BENCH_YEARS ?? OPTIMIZER_BENCHMARK_YEARS.join(","))
  .split(",")
  .map((part) => Number(part.trim()))
  .filter((year) => Number.isFinite(year) && year > 0);

const sows = Number(process.env.BENCH_SOWS ?? 20);
const mode = process.env.BENCH_MODE ?? "compare";

/**
 * The farm every candidate is measured on.
 *
 * A staggered start is used deliberately: a farm whose sows all farrow in the
 * same week produces a demand curve with cliffs in it, and a procurement policy
 * judged on that is being judged on an artefact of the seeding rather than on
 * its own decisions.
 */
function scenario(): PlannerConfig {
  const config = cloneDefaultConfig();
  config.stock.sows = sows;
  config.herd.maxSows = sows;
  config.herd.startMode = "staggered";

  /**
   * Storage scaled with the herd, off by default.
   *
   * The shipping defaults describe a small farm: 6,000 kg of feed bin against a
   * herd that eats a few hundred kilograms a day. Put two hundred sows behind
   * the same bins and they hold under two days, which forces daily deliveries
   * whatever the policy decides — and a procurement policy measured there is
   * being measured on the storage rather than on itself. Setting this separates
   * the two questions.
   */
  if (process.env.BENCH_SCALE_STORAGE === "1") {
    const scale = sows / 20;
    config.feed.binCapacityKg *= scale;
    config.housing.beddingStoreKg *= scale;
    // The canister yard has a hard ceiling in the schema, so gas cannot be
    // scaled past it. It is the one store that stays small here, and a gas
    // constraint showing up in these runs is that ceiling rather than the herd.
    config.health.gasCanisters = Math.min(20, Math.ceil(config.health.gasCanisters * scale));
  }
  return config;
}

function money(value: number): string {
  return (value < 0 ? "-" : "") + "£" + Math.abs(Math.round(value)).toLocaleString("en-GB");
}

function reportRows(rows: readonly OptimizerBenchmarkRow[]): void {
  console.table(
    rows.map((row) => ({
      years: row.years,
      policy: row.policy,
      netRegret: money(row.regret.netProcurementCost),
      "regret%": row.regret.netProcurementPct.toFixed(2) + "%",
      haulageRegret: money(row.regret.haulageCost),
      stockRegret: money(row.regret.closingInventoryValue),
      lorries: `${row.optimizer.lorries} vs ${row.oracle.lorries}`,
      extraSupply: row.regret.suppliesLorries,
      extraBedding: row.regret.beddingLorries,
      supplyLoad: Math.round(row.optimizer.suppliesLoadPct) + "%",
      beddingLoad: Math.round(row.optimizer.beddingLoadPct) + "%",
      emerg: row.optimizer.emergencyOrders,
      short: Math.round(row.optimizer.shortfallKg),
      sold: `${row.optimizer.pigsSold} vs ${row.oracle.pigsSold}`,
    })),
  );
}

/**
 * The settings worth trying. Cheap to extend; each costs one engine run.
 *
 * The sweep moves one thing at a time from the shipping defaults rather than
 * taking the cross product. A full grid of the four dimensions below is 200-odd
 * runs and the better part of a day, and it would not answer a different
 * question: what is being looked for here is whether any single lever is
 * leaving money on the table, and a one-at-a-time sweep finds that. A cross
 * product is worth paying for only once a lever has been shown to matter.
 */
function sweepCandidates(): OptimizerCandidate[] {
  const candidates: OptimizerCandidate[] = [{ policy: "balanced-load", label: "balanced-load (shipping defaults)" }];

  // The one config knob balanced-load actually reads.
  for (const safetyCoverDays of [0, 1, 2, 5, 7, 10, 14]) {
    candidates.push({ policy: "balanced-load", safetyCoverDays });
  }
  // How far the allocator may rank stores once a deck is being filled. Too short
  // and it cannot tell which bin runs dry first; too long and it is ranking on
  // forecast it has no business trusting.
  for (const allocationLookAheadDays of [30, 60, 90, 120, 270, 365]) {
    candidates.push({ policy: "balanced-load", tuning: { allocationLookAheadDays } });
  }
  // How finely a loose store takes its share of the deck.
  for (const looseStepKg of [10, 50, 100]) {
    candidates.push({ policy: "balanced-load", tuning: { looseStepKg } });
  }
  // How far past a normal delivery the daily risk check looks before sending.
  for (const riskLookAheadDays of [0, 3, 7]) {
    candidates.push({ policy: "balanced-load", tuning: { riskLookAheadDays } });
  }
  return candidates;
}

describe("optimiser tuning bench", () => {
  it(
    `runs the ${mode} loop over ${years.join("/")} years at ${sows} sows`,
    async () => {
      const config = scenario();

      if (mode === "sweep") {
        const candidates = sweepCandidates();
        console.log(`sweeping ${candidates.length} candidates over ${years.join("/")}y…`);
        const entries = await sweepOptimizer(config, candidates, years, (done, total, label) =>
          console.log(`  [${done}/${total}] ${label}`),
        );
        console.table(
          entries.map((entry) => ({
            candidate: entry.label,
            feasible: entry.feasible,
            totalRegret: money(entry.totalRegret),
            ...Object.fromEntries(
              entry.rows.map((row) => [
                `${row.years}y`,
                row.regret.netProcurementPct.toFixed(2) + "%",
              ]),
            ),
            emerg: entry.rows.reduce((n, row) => n + row.optimizer.emergencyOrders, 0),
            short: Math.round(entry.rows.reduce((n, row) => n + row.optimizer.shortfallKg, 0)),
          })),
        );
        const best = entries[0];
        console.log(`\nbest: ${best.label} — total regret ${money(best.totalRegret)}`);
        reportRows(best.rows);
        return;
      }

      // One candidate on shipping defaults, measured against the V1 foresight
      // oracle. This used to compare several policies against one shared oracle;
      // only balanced-load is left, and the oracle is still what the number means.
      const compared = await sweepOptimizer(
        config,
        [{ policy: "balanced-load" }],
        years,
        (done, total, label) => console.log(`  [${done}/${total}] ${label}`),
      );
      for (const entry of compared) {
        console.log(`\n=== ${entry.label} — total regret ${money(entry.totalRegret)} ===`);
        reportRows(entry.rows);
      }
    },
    // A sweep at twenty years is minutes of simulation, not seconds.
    3_600_000,
  );
});
