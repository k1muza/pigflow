import { describe, expect, it } from "vitest";

import { cloneDefaultConfig, plannerSchema, withConfigDefaults } from "./config";

describe("nutrition economics config", () => {
  it("defaults new plans to maximum profit without local ingredient prices", () => {
    const config = cloneDefaultConfig();
    expect(config.nutrition).toEqual({
      formulationObjective: "max_profit",
      performanceMetric: "adg",
      facilityCostPerPigDay: 0,
      ingredientPrices: [],
    });
  });

  it("parses a config that predates the nutrition section", () => {
    const old = cloneDefaultConfig() as unknown as Record<string, unknown>;
    delete old.nutrition;

    const parsed = plannerSchema.parse(old);
    expect(parsed.nutrition.formulationObjective).toBe("max_profit");
    expect(parsed.nutrition.ingredientPrices).toEqual([]);
  });

  it("adds nutrition defaults when loading an older saved plan", () => {
    const old = cloneDefaultConfig() as unknown as Record<string, unknown>;
    delete old.nutrition;

    const loaded = withConfigDefaults(old);
    expect(loaded?.nutrition.formulationObjective).toBe("max_profit");
    expect(loaded?.nutrition.facilityCostPerPigDay).toBe(0);
  });
});
