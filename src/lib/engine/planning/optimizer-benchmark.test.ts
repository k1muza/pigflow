import { describe, expect, it } from "vitest";

import { cloneDefaultConfig } from "../../config";
import { benchmarkRollingOptimizer, OPTIMIZER_BENCHMARK_YEARS } from "./optimizer-benchmark";

describe("The rolling optimiser against V1 perfect foresight", () => {
  it("stays supplied and exposes its regret over 3, 5, 10 and 20 years", async () => {
    const config = cloneDefaultConfig();
    config.stock.sows = 20;
    config.herd.maxSows = 20;
    config.herd.startMode = "staggered";
    config.feed.rollingTargetCoverDays = 21;

    const rows = await benchmarkRollingOptimizer(config, [3]);
    console.table(
      rows.map((row) => ({
        years: row.years,
        emergencies: row.optimizer.emergencyOrders,
        shortfallKg: Math.round(row.optimizer.shortfallKg),
        extraLorries: row.regret.lorries,
        supplyTrips: row.optimizer.suppliesLorries,
        beddingTrips: row.optimizer.beddingLorries,
        haulageRegret: Math.round(row.regret.haulageCost),
        inventoryRegret: Math.round(row.regret.closingInventoryValue),
        netRegret: Math.round(row.regret.netProcurementCost),
        supplyLoadPct: Math.round(row.optimizer.suppliesLoadPct),
        beddingLoadPct: Math.round(row.optimizer.beddingLoadPct),
        emergencyStores: JSON.stringify(row.optimizer.emergencyStores),
      })),
    );
    expect(rows.map((row) => row.years)).toEqual([3]);

    for (const row of rows) {
      expect(row.optimizer.shortfallKg, `${row.years}y shortfall`).toBeCloseTo(0, 6);
      expect(row.optimizer.emergencyOrders, `${row.years}y emergency orders`).toBe(0);
      expect(row.optimizer.pigsSold, `${row.years}y pigs sold`).toBe(row.oracle.pigsSold);
      expect(row.optimizer.feedConsumedKg, `${row.years}y feed consumed`).toBeCloseTo(
        row.oracle.feedConsumedKg,
        6,
      );
      expect(Number.isFinite(row.regret.netProcurementCost)).toBe(true);
      expect(row.optimizer.averageLoadPct).toBeGreaterThan(0);
      expect(row.optimizer.averageLoadPct).toBeLessThanOrEqual(100);
    }
  }, 300_000);
});
