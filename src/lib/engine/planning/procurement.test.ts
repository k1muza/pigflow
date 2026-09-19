import { describe, expect, it } from "vitest";

import { cloneDefaultConfig, type PlannerConfig } from "../../config";
import { STORE_IDS, type StoreId } from "../../sim/haulage";
import type { DemandForecastResult, ExpectedFarmState } from "./forecast";
import {
  ReorderPointProcurementPolicy,
  RollingCoverProcurementPolicy,
  type Forecaster,
  type ProcurementPlanningContext,
  type ProcurementSnapshot,
  zeroStores,
} from "./procurement";

const EMPTY_FARM: ExpectedFarmState = { day: 0, growing: [], sows: [], boars: [] };

function constantDemand(store: StoreId, kgPerDay: number): Forecaster {
  return (farm, _config, throughDay): DemandForecastResult => {
    const days = throughDay - farm.day + 1;
    const demandKg = Object.fromEntries(
      STORE_IDS.map((id) => [id, new Array<number>(days).fill(id === store ? kgPerDay : 0)]),
    ) as unknown as DemandForecastResult["demandKg"];
    return { fromDay: farm.day, throughDay, demandKg, explanation: [] };
  };
}

describe("Forward-looking reorder point", () => {
  it("orders for a new ration before recent consumption exists", () => {
    const planning = context((config, stores) => {
      config.feed.targetCoverDays = 14;
      config.feed.minimumOrderKg = 0;
      stores.held.weaner = 0;
      stores.recentDailyKg.weaner = 0;
    });
    const demand: Forecaster = (farm, _config, throughDay) => {
      const days = throughDay - farm.day + 1;
      const demandKg = Object.fromEntries(
        STORE_IDS.map((store) => [
          store,
          Array.from({ length: days }, (_, day) =>
            store === "weaner" && day >= 1 ? 100 : 0,
          ),
        ]),
      ) as unknown as DemandForecastResult["demandKg"];
      return { fromDay: farm.day, throughDay, demandKg, explanation: [] };
    };

    const decision = new ReorderPointProcurementPolicy(demand).decide(planning);
    expect(decision.dispatch).toBe("normal");
    expect(decision.arrivesDay).toBe(planning.config.feed.deliveryLeadDays);
    expect(decision.lines.find((line) => line.store === "weaner")?.kg).toBeGreaterThan(0);
  });
});

function context(
  tweak: (config: PlannerConfig, stores: ProcurementSnapshot) => void,
): ProcurementPlanningContext {
  const config = cloneDefaultConfig();
  config.feed.deliveryLeadDays = 3;
  config.feed.safetyCoverDays = 3;
  config.feed.rollingTargetCoverDays = 14;
  config.feed.feedBagKg = 50;
  const stores: ProcurementSnapshot = {
    day: 0,
    held: zeroStores(),
    onOrder: zeroStores(),
    capacities: Object.fromEntries(STORE_IDS.map((store) => [store, 100_000])) as Record<
      StoreId,
      number
    >,
    unitKg: Object.fromEntries(STORE_IDS.map((store) => [store, store === "gas" ? 48 : 50])) as Record<
      StoreId,
      number
    >,
    listPrices: Object.fromEntries(STORE_IDS.map((store) => [store, 1])) as Record<
      StoreId,
      number
    >,
    recentDailyKg: zeroStores(),
    pendingOrders: [],
    duePayments: [],
    cash: 1_000_000,
    workingCapitalTarget: 0,
  };
  tweak(config, stores);
  return { config, stores, farm: EMPTY_FARM };
}

describe("Rolling-cover target integrity", () => {
  it("covers an interim shortage even when a later confirmed delivery covers the target day", () => {
    const planning = context((_config, stores) => {
      stores.held.sow = 200;
      stores.pendingOrders = [
        {
          id: 1,
          placedDay: -1,
          arrivesDay: 10,
          emergency: false,
          lines: [{ store: "sow", kg: 2_000 }],
        },
      ];
    });
    const decision = new RollingCoverProcurementPolicy(constantDemand("sow", 50)).decide(planning);

    // The delivery on day 10 makes the final target-day balance positive, but
    // the bin breaches its safety floor before then. The bridge is eight bags.
    expect(decision.dispatch).toBe("normal");
    expect(decision.lines.find((line) => line.store === "sow")?.kg).toBe(400);
  });

  it("keeps one common target when the requirement spills across delivery days", () => {
    const planning = context((config, stores) => {
      config.feed.truckCapacityKg = 500;
      config.feed.maxSupplyTripsPerDay = 1;
      stores.held.sow = 400;
    });
    const decision = new RollingCoverProcurementPolicy(constantDemand("sow", 100)).decide(planning);
    const ordered = decision.lines.find((line) => line.store === "sow")?.kg ?? 0;

    expect(decision.targetDay).toBe(17);
    expect(ordered).toBe(1_600);
    expect(decision.trips.map((trip) => trip.day)).toEqual([3, 4, 5, 6]);
  });
});
