import { describe, expect, it } from "vitest";

import { cloneDefaultConfig } from "./config";
import { calculateProjection } from "./model";
import {
  band,
  buildPlanEnsemble,
  compareEnsembles,
  compareFutureConfigs,
  comparePlanConfigs,
  diffManyPlanConfigs,
  diffPlanConfigs,
  quantile,
} from "./comparison";

describe("comparison bands", () => {
  it("interpolates p10, median and p90", () => {
    expect(quantile([1, 2, 3, 4, 5], 0.1)).toBeCloseTo(1.4);
    expect(band([1, 2, 3, 4, 5])).toEqual({ p10: 1.4, median: 3, p90: 4.6 });
  });

  it("uses matched seeds and calls a crossing delta too close", () => {
    const a = cloneDefaultConfig();
    const b = cloneDefaultConfig();
    a.project.months = 12;
    b.project.months = 12;
    b.herd.maxSows += 1;
    const result = comparePlanConfigs(a, b, [1, 2]);
    expect(result.a.seeds).toEqual(result.b.seeds);
    expect(result.breakEvenDeltaPct.p10).toBeLessThanOrEqual(result.breakEvenDeltaPct.p90);
  }, 15_000);

  it("runs settled plans once and returns point bands", () => {
    const a = cloneDefaultConfig();
    const b = cloneDefaultConfig();
    a.project.months = 12;
    b.project.months = 12;
    a.project.variation = "settled";
    b.project.variation = "settled";
    b.feed.growerFeedCostKg *= 1.05;
    const result = comparePlanConfigs(a, b);
    expect(result.mode).toBe("settled");
    expect(result.a.seeds).toHaveLength(1);
    expect(result.a.bands.breakEvenPerDeadweightKg.p10).toBe(
      result.a.bands.breakEvenPerDeadweightKg.p90,
    );
  }, 15_000);

  it("does not count generated financing as profit or loss", () => {
    const a = cloneDefaultConfig();
    const b = cloneDefaultConfig();
    a.project.months = 12;
    b.project.months = 12;
    a.project.variation = "settled";
    b.project.variation = "settled";
    b.finance.cashMovements = [
      {
        id: "auto-in-0",
        monthIndex: 0,
        kind: "in",
        amount: 50_000,
        note: "Cash injection",
        auto: true,
      },
    ];
    const result = comparePlanConfigs(a, b);
    expect(result.a.bands.profitOrLossPerYear.median).toBeCloseTo(
      result.b.bands.profitOrLossPerYear.median,
      6,
    );
  }, 15_000);

  it("continues from the original endpoint and reports only future years", () => {
    const a = cloneDefaultConfig();
    const b = cloneDefaultConfig();
    a.project.months = 12;
    b.project.months = 12;
    a.project.variation = "settled";
    b.project.variation = "settled";
    b.growth.saleWeightKg = 80;
    const result = compareFutureConfigs(a, b, 2);
    expect(result.projectionYears).toBe(2);
    expect(result.a.years).toHaveLength(2);
    expect(result.a.seeds).toHaveLength(1);
    // Read off a run of the same length as the one the comparison itself made,
    // not off a twelve month plan. Feed deliveries are planned against the
    // horizon, so a twelve month plan and the first twelve months of a thirty
    // six month one do not take the same number of loads in their first month,
    // and comparing across the two measures that rather than the continuation.
    const continued = structuredClone(a);
    continued.project.months = 12 + 2 * 12;
    expect(result.a.startingCash.median).toBeCloseTo(
      calculateProjection(continued).months[11].closingCash,
      6,
    );
    expect(result.a.years[1].closingCash.median).not.toBe(
      result.a.years[0].closingCash.median,
    );
  }, 20_000);

  it("keeps each plan's own scenario in a mixed continuation", () => {
    const settled = cloneDefaultConfig();
    const chance = cloneDefaultConfig();
    settled.project.months = 12;
    chance.project.months = 12;
    settled.project.variation = "settled";
    chance.project.variation = "chance";
    const result = compareFutureConfigs(settled, chance, 1, [1, 2, 3]);
    expect(result.mode).toBe("mixed");
    expect(result.a.settled).toBe(true);
    expect(result.b.settled).toBe(false);
    expect(result.a.startingCash.p10).toBeCloseTo(result.a.startingCash.p90, 9);
  }, 20_000);
});

describe("config diff", () => {
  it("shows changed inputs but omits names and comparison seeds", () => {
    const a = cloneDefaultConfig();
    const b = cloneDefaultConfig();
    b.project.name = "Candidate";
    b.project.seed = 99;
    b.herd.maxSows = 30;
    b.feed.growerFeedCostKg += 0.05;
    const differences = diffPlanConfigs(a, b);
    expect(differences.map((item) => item.path)).toEqual([
      "feed.growerFeedCostKg",
      "herd.maxSows",
    ]);
  });

  it("aligns every selected plan into one multi-plan diff", () => {
    const a = cloneDefaultConfig();
    const b = cloneDefaultConfig();
    const c = cloneDefaultConfig();
    b.herd.maxSows = 25;
    c.herd.maxSows = 30;
    const differences = diffManyPlanConfigs([a, b, c]);
    const capacity = differences.find((item) => item.path === "herd.maxSows");
    expect(capacity?.values).toEqual(["20", "25", "30"]);
  });
});

describe("multi-plan verdicts", () => {
  it("compares a settled candidate with the selected baseline without rerunning it", () => {
    const baseline = cloneDefaultConfig();
    const candidate = cloneDefaultConfig();
    baseline.project.months = 12;
    candidate.project.months = 12;
    baseline.project.variation = "settled";
    candidate.project.variation = "settled";
    candidate.feed.growerFeedCostKg *= 1.1;
    const result = compareEnsembles(
      buildPlanEnsemble(baseline, [1]),
      buildPlanEnsemble(candidate, [1]),
    );
    expect(result.mode).toBe("settled");
    expect(result.runs).toBe(1);
    expect(result.verdict).toBe("candidate-higher");
  }, 15_000);
});
