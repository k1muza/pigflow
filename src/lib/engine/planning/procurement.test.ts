import { describe, expect, it } from "vitest";

import { cloneDefaultConfig, type PlannerConfig } from "../../config";
import { STORE_IDS, type StoreId } from "../../sim/haulage";
import { forecastDemand, type DemandForecastResult, type ExpectedFarmState } from "./forecast";
import {
  BalancedLoadProcurementPolicy,
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

describe("Expected demand follows observed thriftiness", () => {
  it("raises the forecast for an existing fast-growing finisher without drawing new noise", () => {
    const config = cloneDefaultConfig();
    const makeFarm = (growthFactor: number): ExpectedFarmState => ({
      day: 0,
      growing: [
        {
          head: 10,
          stage: "finisher",
          destination: "market",
          sex: "female",
          weightKg: 90,
          ageDays: 150,
          growthFactor,
          litters: 0,
          weanDay: null,
        },
      ],
      sows: [],
      boars: [],
    });

    const average = forecastDemand(makeFarm(1), config, 0).demandKg.finisher[0];
    const fast = forecastDemand(makeFarm(1.2), config, 0).demandKg.finisher[0];

    expect(fast).toBeGreaterThan(average);
  });
});

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


describe("Capacity-balanced procurement", () => {
  it("fills one justified truck instead of scheduling several to chase a cover target", () => {
    const planning = context((config, stores) => {
      config.feed.safetyCoverDays = 0;
      config.feed.truckCapacityKg = 500;
      stores.held.sow = 200;
      stores.unitKg.sow = 50;
    });

    const decision = new BalancedLoadProcurementPolicy(constantDemand("sow", 100)).decide(planning);

    expect(decision.dispatch).toBe("normal");
    expect(decision.trips).toHaveLength(1);
    expect(decision.trips[0].payloadKg).toBe(500);
    expect(decision.lines.find((line) => line.store === "sow")?.kg).toBe(500);
    expect(decision.nextDispatchDay).not.toBeNull();
  });

  it("shares spare capacity by earliest projected risk date", () => {
    const planning = context((config, stores) => {
      config.feed.safetyCoverDays = 0;
      config.feed.truckCapacityKg = 500;
      stores.held.sow = 200;
      stores.held.weaner = 200;
      stores.unitKg.sow = 50;
      stores.unitKg.weaner = 50;
    });
    const demand: Forecaster = (farm, _config, throughDay) => {
      const days = throughDay - farm.day + 1;
      const demandKg = Object.fromEntries(
        STORE_IDS.map((store) => [
          store,
          new Array<number>(days).fill(store === "sow" || store === "weaner" ? 100 : 0),
        ]),
      ) as unknown as DemandForecastResult["demandKg"];
      return { fromDay: farm.day, throughDay, demandKg, explanation: [] };
    };

    const decision = new BalancedLoadProcurementPolicy(demand).decide(planning);
    const sow = decision.lines.find((line) => line.store === "sow")?.kg ?? 0;
    const weaner = decision.lines.find((line) => line.store === "weaner")?.kg ?? 0;

    expect(decision.trips).toHaveLength(1);
    expect(decision.trips[0].payloadKg).toBe(500);
    expect(sow + weaner).toBe(500);
    const sowRisk = decision.lines.find((line) => line.store === "sow")?.projectedExhaustionDayAfter;
    const weanerRisk = decision.lines.find((line) => line.store === "weaner")?.projectedExhaustionDayAfter;
    expect(sowRisk).not.toBeNull();
    expect(weanerRisk).not.toBeNull();
    expect(Math.abs((sowRisk ?? 0) - (weanerRisk ?? 0))).toBeLessThanOrEqual(1);
  });

  it("does not load a dormant store merely to fill the vehicle", () => {
    const planning = context((config, stores) => {
      config.feed.safetyCoverDays = 0;
      config.feed.truckCapacityKg = 500;
      stores.held.sow = 200;
      stores.unitKg.sow = 50;
      stores.unitKg.creep = 50;
    });

    const decision = new BalancedLoadProcurementPolicy(constantDemand("sow", 100)).decide(planning);

    expect(decision.lines.some((line) => line.store === "creep")).toBe(false);
    expect(decision.trips[0].payloadKg).toBe(500);
  });



  it("uses a short forecast on no-order mornings and defers the long walk until a truck is due", () => {
    const planning = context((config, stores) => {
      config.feed.safetyCoverDays = 3;
      stores.held.sow = 10_000;
      stores.capacities.sow = 20_000;
    });
    const throughDays: number[] = [];
    const demand: Forecaster = (farm, _config, throughDay) => {
      throughDays.push(throughDay);
      const days = throughDay - farm.day + 1;
      const demandKg = Object.fromEntries(
        STORE_IDS.map((store) => [
          store,
          new Array<number>(days).fill(store === "sow" ? 10 : 0),
        ]),
      ) as unknown as DemandForecastResult["demandKg"];
      return { fromDay: farm.day, throughDay, demandKg, explanation: [] };
    };

    const decision = new BalancedLoadProcurementPolicy(demand).decide(planning);

    expect(decision.dispatch).toBe("none");
    expect(throughDays).toHaveLength(1);
    // Daily risk checking only needs lead time + safety + a boundary day.
    expect(throughDays[0]).toBeLessThanOrEqual(10);
  });
  it("lets a small gas yard become the next-trip limiter rather than chasing a fixed cover target", () => {
    const planning = context((config, stores) => {
      config.feed.safetyCoverDays = 1;
      config.feed.truckCapacityKg = 500;
      // Thirty kilograms reaches the reorder boundary today. Forty lasts one
      // day beyond it, correctly producing a no-dispatch decision.
      stores.held.gas = 30;
      stores.held.sow = 200;
      stores.capacities.gas = 136;
      stores.unitKg.gas = 48;
      stores.unitKg.sow = 50;
    });
    const demand: Forecaster = (farm, _config, throughDay) => {
      const days = throughDay - farm.day + 1;
      const demandKg = Object.fromEntries(
        STORE_IDS.map((store) => [
          store,
          new Array<number>(days).fill(store === "gas" ? 10 : store === "sow" ? 20 : 0),
        ]),
      ) as unknown as DemandForecastResult["demandKg"];
      return { fromDay: farm.day, throughDay, demandKg, explanation: [] };
    };

    const decision = new BalancedLoadProcurementPolicy(demand).decide(planning);
    const gas = decision.lines.find((line) => line.store === "gas")?.kg ?? 0;

    expect(decision.trips).toHaveLength(1);
    expect(gas).toBe(96);
    // The next dispatch date, rather than an artificial fixed-cover target,
    // carries the small yard's constraint forward.
    expect(decision.nextDispatchDay).not.toBeNull();
  });
});
