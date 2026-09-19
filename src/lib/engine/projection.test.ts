import { describe, expect, it } from "vitest";

import { cloneDefaultConfig, type PlannerConfig } from "../config";
import { calculateProjection } from "../model";

/**
 * The plan-level seam. Whichever engine ran it, a projection has to be the same
 * shape and be read by the same code — the cashflow page, the workbook and the
 * comparison tool should not know or care. And a 2.0 run with nothing switched
 * on has to come out where the 1.x run did, all the way through the monthly
 * roll-up, not just in the engine's own totals.
 */
function plan(tweak: (input: PlannerConfig) => void = () => {}): PlannerConfig {
  const input = cloneDefaultConfig();
  input.project.months = 24;
  input.project.variation = "settled";
  tweak(input);
  return input;
}

/** Every 2.0 subsystem down: the 1.x farm, run by the new engine. */
function asPortOnly(input: PlannerConfig): PlannerConfig {
  const config = structuredClone(input);
  config.project.engine = "2.0";
  config.housing.enforceCapacity = false;
  config.reproduction.enforceEstrusWindows = false;
  config.feed.procurementMode = "foresight";
  config.finance.accrualAccounting = false;
  // No mature weight is the 1.x growth rule: a rate per stage, held for as long
  // as the pig stands there.
  config.growth.matureWeightKg = 0;
  return config;
}

describe("Either engine produces the plan the product reads", () => {
  it("defaults to 1.x, so an existing plan is unchanged", () => {
    expect(cloneDefaultConfig().project.engine).toBe("1.x");
  });

  it("rolls a 2.0 run up into the same monthly projection, month for month", () => {
    const input = plan();
    const baseline = calculateProjection(input);
    const ported = calculateProjection(asPortOnly(input));

    expect(ported.months.length).toBe(baseline.months.length);
    for (const [index, month] of baseline.months.entries()) {
      const mirror = ported.months[index];
      expect(mirror.pigsSold, month.month).toBe(month.pigsSold);
      expect(mirror.bornAlive, month.month).toBe(month.bornAlive);
      expect(mirror.closingCash, month.month).toBeCloseTo(month.closingCash, 6);
      expect(mirror.netCashFlow, month.month).toBeCloseTo(month.netCashFlow, 6);
      expect(mirror.totalCost, month.month).toBeCloseTo(month.totalCost, 6);
    }
    expect(ported.summary.peakFundingNeed).toBeCloseTo(baseline.summary.peakFundingNeed, 6);
    expect(ported.costOfProduction.fullCostPerDeadweightKg).toBeCloseTo(
      baseline.costOfProduction.fullCostPerDeadweightKg,
      6,
    );
  }, 60_000);

  it("records housing pressure without enforcing it", () => {
    const cramped = plan((c) => {
      c.project.engine = "2.0";
      c.stock.sows = 12;
      c.herd.startMode = "staggered";
      c.herd.maxSows = 12;
      c.housing.farrowingPlaces = 4;
      c.housing.weanerPlaces = 20;
      c.housing.growerPlaces = 16;
      c.housing.finisherPlaces = 20;
    });
    const projection = calculateProjection(cramped);
    const titles = projection.warnings.map((warning) => warning.title);
    expect(titles).not.toContain("Housing is holding the farm back");
    expect(projection.months.some((month) => month.housingPeak !== undefined)).toBe(true);
  }, 60_000);
});
