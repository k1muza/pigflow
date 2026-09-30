import { describe, expect, it } from "vitest";

import {
  GLOBAL_IMPORT_PRICE_MULTIPLIER,
  INGREDIENT_DEFAULT_PRICES,
  REGIONAL_IMPORT_PRICE_MULTIPLIER,
  ingredientDefaultPlanningPricePerTonne,
  ingredientDefaultPrice,
  ingredientDefaultPricePerKg,
} from "./feed-ingredient-prices";

describe("feed ingredient default prices", () => {
  it("keeps one positive planning price per ingredient", () => {
    const ids = INGREDIENT_DEFAULT_PRICES.map((price) => price.ingredientId);

    expect(new Set(ids).size).toBe(ids.length);
    expect(
      INGREDIENT_DEFAULT_PRICES.every(
        (price) =>
          Number.isFinite(price.usdPerTonne) &&
          price.usdPerTonne > 0 &&
          price.asOf.length > 0 &&
          price.sourceUrl.startsWith("http"),
      ),
    ).toBe(true);
  });

  it("prioritizes Harare prices for core bulk ingredients", () => {
    expect(ingredientDefaultPrice("corn-yellow-dent")).toMatchObject({
      usdPerTonne: 348.6,
      sourceScope: "harare",
    });
    expect(
      ingredientDefaultPrice("soybean-meal-dehulled-solvent-extracted"),
    ).toMatchObject({
      usdPerTonne: 550,
      sourceScope: "harare",
    });
    expect(ingredientDefaultPrice("wheat-bran")).toMatchObject({
      usdPerTonne: 200,
      sourceScope: "harare",
    });
  });

  it("has planning prices for every ingredient in the current strict starter basket", () => {
    const ingredientIds = [
      "corn-yellow-dent",
      "soybean-meal-dehulled-solvent-extracted",
      "soybean-meal-solvent-extracted",
      "dicalcium-phosphate",
      "sodium-chloride",
      "l-lysine-hcl",
      "corn-oil",
      "monocalcium-phosphate",
      "dl-methionine",
      "l-threonine",
      "l-tryptophan",
    ];

    for (const ingredientId of ingredientIds) {
      expect(ingredientDefaultPrice(ingredientId), ingredientId).toBeDefined();
      expect(ingredientDefaultPricePerKg(ingredientId), ingredientId).toBeGreaterThan(0);
    }
  });

  it("applies simple import multipliers before formulation uses the price", () => {
    expect(REGIONAL_IMPORT_PRICE_MULTIPLIER).toBe(1.15);
    expect(GLOBAL_IMPORT_PRICE_MULTIPLIER).toBe(1.3);

    expect(ingredientDefaultPlanningPricePerTonne("corn-yellow-dent")).toBeCloseTo(
      348.6,
      6,
    );
    expect(ingredientDefaultPlanningPricePerTonne("dicalcium-phosphate")).toBeCloseTo(
      616.4,
      6,
    );
    expect(ingredientDefaultPlanningPricePerTonne("l-threonine")).toBeCloseTo(
      1638,
      6,
    );
  });

  it("converts landed planning prices to the per-kg unit used by the formulation workbench", () => {
    expect(ingredientDefaultPricePerKg("corn-yellow-dent")).toBeCloseTo(
      0.3486,
      6,
    );
    expect(ingredientDefaultPricePerKg("dl-methionine")).toBeCloseTo(
      2.85085,
      6,
    );
    expect(ingredientDefaultPricePerKg("l-threonine")).toBeCloseTo(
      1.638,
      6,
    );
  });
});
