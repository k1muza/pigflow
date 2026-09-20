import type { PlannerConfig } from "../../config";
import { FEED_RATIONS } from "../../sim/animals";
import { STORE_IDS, type StoreId, type Trip } from "../../sim/haulage";
import { Engine, engineHorizonDay } from "../engine";
import { LEGACY_POLICIES, type Policies } from "../world";
import { forecastDemand } from "./forecast";
import {
  BalancedLoadProcurementPolicy,
  type BalancedLoadTuning,
  type OperationalProcurementPolicy,
  type ProcurementPolicy,
} from "./procurement";

/**
 * The horizons a procurement policy is judged over.
 *
 * Three years is long enough for the herd to reach a steady state and for the
 * stores to have cycled many times; twenty is long enough that a small per-trip
 * error compounds into a number somebody would notice on a funding application.
 * A policy that looks good at three and bad at twenty is drifting, and that is
 * exactly what this set is here to catch.
 */
export const OPTIMIZER_BENCHMARK_YEARS = [3, 5, 10, 20] as const;

export type OptimizerBenchmarkMeasures = {
  lorries: number;
  suppliesLorries: number;
  beddingLorries: number;
  averageLoadPct: number;
  suppliesLoadPct: number;
  beddingLoadPct: number;
  haulageCost: number;
  goodsPurchased: number;
  closingInventoryValue: number;
  /** Purchased goods actually used, plus their journeys and emergency premium. */
  netProcurementCost: number;
  emergencyOrders: number;
  emergencyStores: Partial<Record<StoreId, number>>;
  emergencyPremium: number;
  shortfallKg: number;
  pigsSold: number;
  feedConsumedKg: number;
};

export type OptimizerRegret = {
  netProcurementCost: number;
  haulageCost: number;
  lorries: number;
  suppliesLorries: number;
  beddingLorries: number;
  closingInventoryValue: number;
  /** Regret as a share of what V1 spent, which is how it stays comparable across horizons. */
  netProcurementPct: number;
};

export type OptimizerBenchmarkRow = {
  years: number;
  policy: OperationalProcurementPolicy;
  oracle: OptimizerBenchmarkMeasures;
  optimizer: OptimizerBenchmarkMeasures;
  /** Positive means the rolling optimiser cost more than V1 foresight. */
  regret: OptimizerRegret;
};

/**
 * The settings a sweep is allowed to move.
 *
 * Only fields the operational policies actually read belong here. `targetCoverDays`
 * is deliberately absent: V1's own haulage planner reads it, so moving it moves
 * the oracle too and the regret would no longer be measuring the optimiser.
 */
export type OptimizerKnobs = {
  policy: OperationalProcurementPolicy;
  /** Days of demand each store is held above, on top of lead time. */
  safetyCoverDays?: number;
  /** Fixed cover target. Read by rolling-cover only. */
  rollingTargetCoverDays?: number;
  /** Lorries allowed to land in one day. Read by rolling-cover only. */
  maxSupplyTripsPerDay?: number;
  /**
   * balanced-load's own numbers, which are not configuration and are therefore
   * injected as a policy rather than written into the config the farm sees.
   */
  tuning?: Partial<BalancedLoadTuning>;
};

export type OptimizerCandidate = OptimizerKnobs & {
  /** How this candidate is named in a sweep table. */
  label?: string;
};

function zeroStores(): Record<StoreId, number> {
  return Object.fromEntries(STORE_IDS.map((store) => [store, 0])) as Record<StoreId, number>;
}

function listPrice(config: PlannerConfig, store: StoreId): number {
  switch (store) {
    case "sow":
      return config.feed.sowFeedCostKg;
    case "creep":
      return config.feed.creepFeedCostKg;
    case "weaner":
      return config.feed.weanerFeedCostKg;
    case "grower":
      return config.feed.growerFeedCostKg;
    case "finisher":
      return config.feed.finisherFeedCostKg;
    case "gas":
      return config.health.gasCostPerKg;
    case "bedding":
      return config.housing.beddingCostPerKg;
  }
}

function linesOf(trips: readonly Trip[]): { store: StoreId; kg: number }[] {
  return trips.flatMap((trip) => trip.lines);
}

function measuresThrough(
  engine: Engine,
  config: PlannerConfig,
  throughDay: number,
): OptimizerBenchmarkMeasures {
  const delivered = zeroStores();
  const consumed = zeroStores();
  let lorries = 0;
  let suppliesLorries = 0;
  let beddingLorries = 0;
  let payloadKg = 0;
  let suppliesPayloadKg = 0;
  let beddingPayloadKg = 0;
  let haulageCost = 0;
  let emergencyOrders = 0;
  const emergencyStores: Partial<Record<StoreId, number>> = {};
  let emergencyPremium = 0;
  let shortfallKg = 0;
  let feedConsumedKg = 0;
  let pigsSold = 0;

  for (const record of engine.history) {
    if (record.day > throughDay) break;
    lorries += record.deliveries.length;
    emergencyOrders += record.emergencyOrders;
    emergencyPremium += record.emergencyPremium;
    shortfallKg += record.feedShortfallKg;
    pigsSold += record.sold;
    for (const trip of record.deliveries) {
      payloadKg += trip.payloadKg;
      haulageCost += trip.cost;
      if (trip.kind === "supplies") {
        suppliesLorries += 1;
        suppliesPayloadKg += trip.payloadKg;
      } else {
        beddingLorries += 1;
        beddingPayloadKg += trip.payloadKg;
      }
      if (record.emergencyOrders > 0) {
        for (const line of trip.lines) {
          emergencyStores[line.store] = (emergencyStores[line.store] ?? 0) + line.kg;
        }
      }
    }
    for (const line of linesOf(record.deliveries)) delivered[line.store] += line.kg;
    for (const ration of FEED_RATIONS) {
      consumed[ration] += record.feedByRation[ration];
      feedConsumedKg += record.feedByRation[ration];
    }
    consumed.gas += record.gasKg;
    consumed.bedding += record.beddingKg;
  }

  let goodsPurchased = 0;
  let closingInventoryValue = 0;
  for (const store of STORE_IDS) {
    const price = listPrice(config, store);
    goodsPurchased += delivered[store] * price;
    closingInventoryValue += Math.max(0, delivered[store] - consumed[store]) * price;
  }
  const deck = Math.max(config.feed.truckCapacityKg, 1);
  return {
    lorries,
    suppliesLorries,
    beddingLorries,
    averageLoadPct: lorries > 0 ? (payloadKg / (lorries * deck)) * 100 : 0,
    suppliesLoadPct: suppliesLorries > 0 ? (suppliesPayloadKg / (suppliesLorries * deck)) * 100 : 0,
    beddingLoadPct: beddingLorries > 0 ? (beddingPayloadKg / (beddingLorries * deck)) * 100 : 0,
    haulageCost,
    goodsPurchased,
    closingInventoryValue,
    netProcurementCost: goodsPurchased - closingInventoryValue + haulageCost + emergencyPremium,
    emergencyOrders,
    emergencyStores,
    emergencyPremium,
    shortfallKg,
    pigsSold,
    feedConsumedKg,
  };
}

/**
 * Runs the engine a year at a time so a twenty-year benchmark does not hold one
 * unbroken synchronous run. The work is identical; only the yielding differs,
 * and without it a test reporter or CLI has no chance to draw anything.
 */
async function runInYearChunks(
  config: PlannerConfig,
  policies: Policies,
  procurement?: ProcurementPolicy,
): Promise<Engine> {
  const engine = new Engine(config, { policies, procurement });
  for (let year = 1; year * 12 <= config.project.months; year += 1) {
    const checkpoint = structuredClone(config);
    checkpoint.project.months = year * 12;
    engine.advanceTo(engineHorizonDay(checkpoint));
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  return engine;
}

/**
 * Settles a configuration into the shape every run in a comparison shares: the
 * longest horizon under test, no biological variation, and capacity reported
 * rather than enforced. Everything a policy is judged on has to differ only in
 * the policy, so this is applied identically to the oracle and to each candidate.
 */
export function benchmarkConfig(input: PlannerConfig, years: readonly number[]): PlannerConfig {
  const config = structuredClone(input);
  config.project.months = Math.max(...years) * 12;
  config.project.variation = "settled";
  config.housing.enforceCapacity = false;
  return config;
}

/**
 * V1 with perfect foresight: the whole horizon's consumption known in advance and
 * the lorries cut against it. It is the best a plan could have done knowing the
 * future, which is what makes it the right zero for regret — not a target any
 * operational policy could honestly reach.
 */
export async function runOracle(config: PlannerConfig): Promise<Engine> {
  return runInYearChunks(config, { ...LEGACY_POLICIES, operationalProcurement: false });
}

/**
 * One oracle per horizon, which is not the same thing as one oracle read at
 * several checkpoints.
 *
 * V1 cuts its lorries against the entire configured horizon, so what it knows
 * about year eleven changes the load it sends in year two. Reading a twenty-year
 * oracle at the three-year mark therefore measures the optimiser against an
 * ideal that had seen seventeen years it could not have seen — and the answer
 * moves: the same three years scored -£108 against a three-year oracle and
 * -£288 against a twenty-year one, on 165 lorries versus 168. Neither number is
 * wrong, but only the first is the three-year question.
 *
 * So each horizon gets an oracle whose own project ends there. The operational
 * runs need no such treatment: they buy out of the bin in front of them and
 * never read the project end, so one run to the longest horizon has the same
 * prefix as a shorter one. {@link runOptimizer} relies on that, and
 * `optimizer-benchmark.test.ts` holds it to it.
 */
export async function runOracles(
  config: PlannerConfig,
  years: readonly number[],
): Promise<Map<number, Engine>> {
  const oracles = new Map<number, Engine>();
  for (const year of years) {
    oracles.set(year, await runOracle(horizonOf(config, year)));
  }
  return oracles;
}

/** The same settled configuration, ending after `years`. */
function horizonOf(config: PlannerConfig, years: number): PlannerConfig {
  const truncated = structuredClone(config);
  truncated.project.months = years * 12;
  return truncated;
}

/**
 * The same farm, buying out of the bin it can actually see. Every policy switch
 * other than procurement stays off so the two runs differ in one thing only.
 */
export async function runOptimizer(
  config: PlannerConfig,
  knobs: OptimizerKnobs,
): Promise<Engine> {
  const tuned = structuredClone(config);
  tuned.feed.operationalPolicy = knobs.policy;
  if (knobs.safetyCoverDays !== undefined) tuned.feed.safetyCoverDays = knobs.safetyCoverDays;
  if (knobs.rollingTargetCoverDays !== undefined) {
    tuned.feed.rollingTargetCoverDays = knobs.rollingTargetCoverDays;
  }
  if (knobs.maxSupplyTripsPerDay !== undefined) {
    tuned.feed.maxSupplyTripsPerDay = knobs.maxSupplyTripsPerDay;
  }
  const procurement =
    knobs.tuning && knobs.policy === "balanced-load"
      ? new BalancedLoadProcurementPolicy(forecastDemand, knobs.tuning)
      : undefined;
  return runInYearChunks(
    tuned,
    { ...LEGACY_POLICIES, operationalProcurement: true },
    procurement,
  );
}

/**
 * Differences the operational run against each horizon's own oracle.
 *
 * `oracles` is keyed by year and must contain every year asked for: comparing a
 * horizon against an oracle built for a different one is the bug this signature
 * exists to make impossible to write by accident.
 */
export function compareAt(
  oracles: ReadonlyMap<number, Engine>,
  optimizer: Engine,
  config: PlannerConfig,
  years: readonly number[],
  policy: OperationalProcurementPolicy,
): OptimizerBenchmarkRow[] {
  return years.map((year) => {
    const oracle = oracles.get(year);
    if (!oracle) throw new Error(`no oracle was run for the ${year}-year horizon`);
    const day = engineHorizonDay(horizonOf(config, year));
    const ideal = measuresThrough(oracle, config, day);
    const actual = measuresThrough(optimizer, config, day);
    return {
      years: year,
      policy,
      oracle: ideal,
      optimizer: actual,
      regret: {
        netProcurementCost: actual.netProcurementCost - ideal.netProcurementCost,
        haulageCost: actual.haulageCost - ideal.haulageCost,
        lorries: actual.lorries - ideal.lorries,
        suppliesLorries: actual.suppliesLorries - ideal.suppliesLorries,
        beddingLorries: actual.beddingLorries - ideal.beddingLorries,
        closingInventoryValue: actual.closingInventoryValue - ideal.closingInventoryValue,
        netProcurementPct:
          ideal.netProcurementCost > 0
            ? ((actual.netProcurementCost - ideal.netProcurementCost) / ideal.netProcurementCost) *
              100
            : 0,
      },
    };
  });
}

/**
 * One policy against V1 foresight over every horizon asked for.
 *
 * Both engines are run once, to the longest horizon, and read back at each
 * checkpoint. Running them separately per horizon would cost four times as much
 * and could not produce a different answer: the engine is deterministic and a
 * three-year checkpoint inside a twenty-year run is the same three years.
 */
export async function benchmarkOptimizer(
  input: PlannerConfig,
  knobs: OptimizerKnobs,
  years: readonly number[] = OPTIMIZER_BENCHMARK_YEARS,
): Promise<OptimizerBenchmarkRow[]> {
  const config = benchmarkConfig(input, years);
  const oracles = await runOracles(config, years);
  const optimizer = await runOptimizer(config, knobs);
  return compareAt(oracles, optimizer, config, years, knobs.policy);
}

export type OptimizerSweepEntry = {
  label: string;
  knobs: OptimizerKnobs;
  rows: OptimizerBenchmarkRow[];
  /** Regret summed over the horizons swept, which is what candidates are ranked on. */
  totalRegret: number;
  /** A candidate that starved the herd is not a candidate, whatever it cost. */
  feasible: boolean;
};

export function labelFor(knobs: OptimizerKnobs): string {
  const parts: string[] = [knobs.policy];
  if (knobs.safetyCoverDays !== undefined) parts.push(`safety=${knobs.safetyCoverDays}`);
  if (knobs.rollingTargetCoverDays !== undefined) parts.push(`cover=${knobs.rollingTargetCoverDays}`);
  if (knobs.maxSupplyTripsPerDay !== undefined) parts.push(`trips=${knobs.maxSupplyTripsPerDay}`);
  if (knobs.tuning?.riskLookAheadDays !== undefined) {
    parts.push(`risk=${knobs.tuning.riskLookAheadDays}`);
  }
  if (knobs.tuning?.allocationLookAheadDays !== undefined) {
    parts.push(`look=${knobs.tuning.allocationLookAheadDays}`);
  }
  if (knobs.tuning?.looseStepKg !== undefined) parts.push(`step=${knobs.tuning.looseStepKg}`);
  return parts.join(" ");
}

/**
 * Every candidate against one shared oracle.
 *
 * This is the loop the tuning is done in. The ideal is computed once — it cannot
 * change, since no knob here is one V1 reads — and each candidate pays only for
 * its own run. Candidates are ranked by summed regret, but a candidate that let
 * the herd go short is marked infeasible rather than allowed to win on cost:
 * the cheapest procurement plan in the world is buying nothing.
 */
export async function sweepOptimizer(
  input: PlannerConfig,
  candidates: readonly OptimizerCandidate[],
  years: readonly number[] = OPTIMIZER_BENCHMARK_YEARS,
  onProgress?: (done: number, total: number, label: string) => void,
): Promise<OptimizerSweepEntry[]> {
  const config = benchmarkConfig(input, years);
  // Built once and shared by every candidate: the ideal cannot depend on which
  // candidate is being scored against it, and no knob a candidate moves is one
  // that V1 foresight reads.
  const oracles = await runOracles(config, years);

  const entries: OptimizerSweepEntry[] = [];
  for (const [index, candidate] of candidates.entries()) {
    const label = candidate.label ?? labelFor(candidate);
    const optimizer = await runOptimizer(config, candidate);
    const rows = compareAt(oracles, optimizer, config, years, candidate.policy);
    entries.push({
      label,
      knobs: candidate,
      rows,
      totalRegret: rows.reduce((total, row) => total + row.regret.netProcurementCost, 0),
      feasible: rows.every(
        (row) => row.optimizer.shortfallKg <= 1e-6 && row.optimizer.emergencyOrders === 0,
      ),
    });
    onProgress?.(index + 1, candidates.length, label);
  }

  return entries.sort((a, b) => {
    if (a.feasible !== b.feasible) return a.feasible ? -1 : 1;
    return a.totalRegret - b.totalRegret;
  });
}
