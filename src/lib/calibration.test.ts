import { describe, expect, it } from "vitest";

import {
  applyProductionCalibration2026,
  cloneDefaultConfig,
  withConfigDefaults,
} from "./config";

describe("2026 production calibration", () => {
  it("updates production coefficients without touching farm prices or policy", () => {
    const before = cloneDefaultConfig();
    before.reproduction.weaningAgeDays = 35;
    before.finance.salePriceKg = 3.5;
    before.feed.weanerFeedCostKg = 0.64;
    before.project.name = "50 sow plan";

    const after = applyProductionCalibration2026(before);

    expect(after.growth.pigletDailyGainKg).toBe(0.28);
    expect(after.feed.lactationKgDay).toBe(7);
    expect(after.feed.lactationFeedKgPerKgGain).toBe(2);
    expect(after.feed.creepKgPerPigDay).toBe(0.03);
    expect(after.growth.weanerMortalityPct).toBe(3);
    expect(after.herd.giltServiceAgeDays).toBe(200);

    expect(after.reproduction.weaningAgeDays).toBe(35);
    expect(after.finance.salePriceKg).toBe(3.5);
    expect(after.feed.weanerFeedCostKg).toBe(0.64);
    expect(after.project.name).toBe("50 sow plan");
  });

  it("does not rewrite an existing saved plan merely because defaults changed", () => {
    const stored = cloneDefaultConfig();
    stored.growth.pigletDailyGainKg = 0.40285714285714286;
    stored.feed.lactationKgDay = 6;
    stored.feed.lactationFeedKgPerKgGain = 1.8;
    stored.feed.creepKgPerPigDay = 0.05;
    stored.growth.weanerMortalityPct = 2;
    stored.herd.giltServiceAgeDays = 240;

    const loaded = withConfigDefaults(stored)!;
    expect(loaded.growth.pigletDailyGainKg).toBe(0.40285714285714286);
    expect(loaded.feed.lactationKgDay).toBe(6);
    expect(loaded.feed.lactationFeedKgPerKgGain).toBe(1.8);
    expect(loaded.feed.creepKgPerPigDay).toBe(0.05);
    expect(loaded.growth.weanerMortalityPct).toBe(2);
    expect(loaded.herd.giltServiceAgeDays).toBe(240);
  });
});
