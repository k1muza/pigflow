import { describe, expect, it } from "vitest";

import { cloneDefaultConfig } from "../../config";
import { benchmarkRollingOptimizer } from "./optimizer-benchmark";

describe("The rolling optimiser against V1 perfect foresight", () => {
  it("stays supplied and exposes its three-year regret", async () => {
    const config = cloneDefaultConfig();
    config.stock.sows = 20;
    config.herd.maxSows = 20;
    config.herd.startMode = "staggered";
    config.feed.rollingTargetCoverDays = 21;

    const rows = await benchmarkRollingOptimizer(config, [3]);
    console.table(
      rows.map((row) => ({
        years: row.years,
        optimizerSold: row.optimizer.pigsSold,
        oracleSold: row.oracle.pigsSold,
        optimizerFeedKg: Math.round(row.optimizer.feedConsumedKg),
        oracleFeedKg: Math.round(row.oracle.feedConsumedKg),
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
      // Operational farms draw the market before feeding and before replacement
      // selection, while the V1 oracle deliberately retains its historical
      // after-growth timing. They should remain comparable, but exact biological
      // equality is no longer an invariant of this procurement benchmark.
      expect(row.optimizer.pigsSold, `${row.years}y pigs sold`).toBeGreaterThan(
        row.oracle.pigsSold * 0.95,
      );
      expect(row.optimizer.pigsSold, `${row.years}y pigs sold`).toBeLessThan(
        row.oracle.pigsSold * 1.05,
      );
      expect(row.optimizer.feedConsumedKg, `${row.years}y feed consumed`).toBeGreaterThan(
        row.oracle.feedConsumedKg * 0.95,
      );
      expect(row.optimizer.feedConsumedKg, `${row.years}y feed consumed`).toBeLessThan(
        row.oracle.feedConsumedKg * 1.05,
      );
      expect(Number.isFinite(row.regret.netProcurementCost)).toBe(true);
      expect(row.optimizer.averageLoadPct).toBeGreaterThan(0);
      expect(row.optimizer.averageLoadPct).toBeLessThanOrEqual(100);
    }
  }, 300_000);
});
