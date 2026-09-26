import { describe, expect, it } from "vitest";

import { nutritionPhaseAtWeight } from "./nutrition";
import {
  FEED_NUTRIENTS,
  abundantIngredientsForNutrient,
  feedNutrientById,
  nutrientRequirementValue,
} from "./feed-nutrients";

describe("feed nutrient catalogue", () => {
  it("has stable unique nutrient ids", () => {
    const ids = FEED_NUTRIENTS.map((nutrient) => nutrient.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(feedNutrientById("sid-lysine")?.shortName).toBe("SID Lys");
    expect(feedNutrientById("potassium")?.shortName).toBe("K");
    expect(feedNutrientById("linoleic-acid")?.shortName).toBe("C18:2");
  });

  it("exposes direct Brazilian dietary concentrations", () => {
    const grower = nutritionPhaseAtWeight(30);

    expect(nutrientRequirementValue("sid-lysine", grower)).toEqual({
      value: "1.038%",
      basis: "diet · reference SID amino acid",
      minimum: "1.038%",
    });

    expect(nutrientRequirementValue("sid-threonine", grower)).toEqual({
      value: "0.706%",
      basis: "diet · 68% of SID Lys",
      minimum: "0.706%",
    });

    expect(nutrientRequirementValue("crude-protein", grower)).toEqual({
      value: "16.72%",
      basis: "diet",
      minimum: "16.72%",
    });
  });

  it("keeps Chapter 7 supplementation separate from Chapter 5 requirements", () => {
    const grower = nutritionPhaseAtWeight(30);
    expect(nutrientRequirementValue("zinc", grower)).toBeUndefined();
    expect(nutrientRequirementValue("vitamin-a", grower)).toBeUndefined();
  });

  it("exposes Brazilian electrolyte and fatty-acid requirements", () => {
    const prestart = nutritionPhaseAtWeight(5);

    expect(nutrientRequirementValue("chloride", prestart)).toEqual({
      value: "0.219%",
      basis: "diet",
      minimum: "0.219%",
    });
    expect(nutrientRequirementValue("potassium", prestart)).toEqual({
      value: "0.527%",
      basis: "diet",
      minimum: "0.527%",
    });
    expect(nutrientRequirementValue("linoleic-acid", prestart)).toEqual({
      value: "0.554%",
      basis: "diet",
      minimum: "0.554%",
    });
  });

  it("ranks ingredients by quantified nutrient concentration", () => {
    expect(abundantIngredientsForNutrient("sid-lysine")[0]).toMatchObject({
      ingredientId: "l-lysine-hcl",
      value: 78.8,
      unit: "%",
    });

    expect(abundantIngredientsForNutrient("calcium")[0]?.ingredientId).toBe(
      "limestone-ground",
    );
    expect(abundantIngredientsForNutrient("sodium")[0]?.ingredientId).toBe(
      "sodium-chloride",
    );
  });

  it("returns no abundance rows when the current ingredient library has no data", () => {
    expect(abundantIngredientsForNutrient("vitamin-a")).toEqual([]);
  });
});
