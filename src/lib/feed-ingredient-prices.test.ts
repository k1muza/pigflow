import { describe, expect, it } from "vitest";

import { ingredientDefaultPrice } from "./feed-ingredient-prices";

describe("ingredient default prices", () => {
  it("keeps sourced market prices separate from nutrient data", () => {
    expect(ingredientDefaultPrice("corn-yellow-dent")).toMatchObject({
      usdPerTonne: 200,
    });
    expect(ingredientDefaultPrice("soybean-meal-dehulled-solvent-extracted")).toMatchObject({
      usdPerTonne: 321,
      market: "Harare, Zimbabwe",
    });
  });

  it("does not invent a default when no sourced price is loaded", () => {
    expect(ingredientDefaultPrice("l-lysine-hcl")).toBeUndefined();
  });
});
