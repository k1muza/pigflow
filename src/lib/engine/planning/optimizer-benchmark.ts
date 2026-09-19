import type { PlannerConfig } from "../../config";
import { FEED_RATIONS } from "../../sim/animals";
import { STORE_IDS, type StoreId, type Trip } from "../../sim/haulage";
import { Engine, engineHorizonDay } from "../engine";
import { LEGACY_POLICIES, type Policies } from "../world";

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

export type OptimizerBenchmarkRow = {
  years: number;
  oracle: OptimizerBenchmarkMeasures;
  optimizer: OptimizerBenchmarkMeasures;
  /** Positive means the rolling optimiser cost more than V1 foresight. */
  regret: {
    netProcurementCost: number;
    haulageCost: number;
    lorries: number;
    closingInventoryValue: number;
  };
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

  for (const record of engine.history) {
    if (record.day > throughDay) break;
    lorries += record.deliveries.length;
    emergencyOrders += record.emergencyOrders;
    emergencyPremium += record.emergencyPremium;
    shortfallKg += record.feedShortfallKg;
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
  return {
    lorries,
    suppliesLorries,
    beddingLorries,
    averageLoadPct:
      lorries > 0 ? (payloadKg / (lorries * Math.max(config.feed.truckCapacityKg, 1))) * 100 : 0,
    suppliesLoadPct:
      suppliesLorries > 0
        ? (suppliesPayloadKg /
            (suppliesLorries * Math.max(config.feed.truckCapacityKg, 1))) *
          100
        : 0,
    beddingLoadPct:
      beddingLorries > 0
        ? (beddingPayloadKg / (beddingLorries * Math.max(config.feed.truckCapacityKg, 1))) * 100
        : 0,
    haulageCost,
    goodsPurchased,
    closingInventoryValue,
    netProcurementCost:
      goodsPurchased - closingInventoryValue + haulageCost + emergencyPremium,
    emergencyOrders,
    emergencyStores,
    emergencyPremium,
    shortfallKg,
    pigsSold: engine.history
      .filter((record) => record.day <= throughDay)
      .reduce((total, record) => total + record.sold, 0),
    feedConsumedKg,
  };
}

/**
 * Runs V1's full-horizon haulage plan as an oracle and the rolling-cover policy
 * against the same settled herd. Biology is held to legacy rules in both runs,
 * so every difference in the result is a procurement decision rather than a
 * different litter, growth curve, housing queue or mortality draw.
 */
async function runInYearChunks(config: PlannerConfig, policies: Policies): Promise<Engine> {
  const engine = new Engine(config, { policies });
  for (let year = 1; year * 12 <= config.project.months; year += 1) {
    const checkpoint = structuredClone(config);
    checkpoint.project.months = year * 12;
    engine.advanceTo(engineHorizonDay(checkpoint));
    // Long simulations are CPU-bound. Yield between years so a test runner or
    // CLI reporter stays responsive during the 20-year benchmark.
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  return engine;
}

export async function benchmarkRollingOptimizer(
  input: PlannerConfig,
  years: readonly number[] = OPTIMIZER_BENCHMARK_YEARS,
): Promise<OptimizerBenchmarkRow[]> {
  const longest = Math.max(...years);
  const config = structuredClone(input);
  config.project.months = longest * 12;
  config.project.variation = "settled";
  config.housing.enforceCapacity = false;
  config.feed.operationalPolicy = "rolling-cover";

  const oraclePolicies = { ...LEGACY_POLICIES, operationalProcurement: false };
  const optimizerPolicies = { ...LEGACY_POLICIES, operationalProcurement: true };
  const oracle = await runInYearChunks(config, oraclePolicies);
  const optimizer = await runInYearChunks(config, optimizerPolicies);

  return years.map((year) => {
    const checkpoint = structuredClone(config);
    checkpoint.project.months = year * 12;
    const day = engineHorizonDay(checkpoint);
    const ideal = measuresThrough(oracle, config, day);
    const actual = measuresThrough(optimizer, config, day);
    return {
      years: year,
      oracle: ideal,
      optimizer: actual,
      regret: {
        netProcurementCost: actual.netProcurementCost - ideal.netProcurementCost,
        haulageCost: actual.haulageCost - ideal.haulageCost,
        lorries: actual.lorries - ideal.lorries,
        closingInventoryValue: actual.closingInventoryValue - ideal.closingInventoryValue,
      },
    };
  });
}
