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
  });

  it("separates minimums, targets and maximum caps", () => {
    const grower = nutritionPhaseAtWeight(30);
    expect(nutrientRequirementValue("sid-lysine", grower)).toEqual({
      value: "3.47 g/Mcal ME · 4.74 g/Mcal NE",
      basis: "energy-relative requirement",
      minimum: "3.47 g/Mcal ME · 4.74 g/Mcal NE",
      maximum: undefined,
    });

    expect(nutrientRequirementValue("sid-threonine", grower)).toEqual({
      value: "65%",
      basis: "minimum ratio to SID Lys",
      minimum: "65%",
    });

    expect(nutrientRequirementValue("zinc", grower)).toEqual({
      value: "111 ppm",
      basis: "added supplementation",
      target: "111 ppm",
    });
  });

  it("exposes source ranges and related maximum caps where PIC provides them", () => {
    const prestart = nutritionPhaseAtWeight(5);
    expect(nutrientRequirementValue("chloride", prestart)).toEqual({
      value: "0.35%–0.4%",
      basis: "diet range",
      minimum: "0.35%",
      maximum: "0.4%",
    });

    const lateNursery = nutritionPhaseAtWeight(20);
    expect(nutrientRequirementValue("sid-lysine", lateNursery)).toEqual({
      value: "3.9 g/Mcal ME · 5.32 g/Mcal NE",
      basis: "energy-relative requirement",
      minimum: "3.9 g/Mcal ME · 5.32 g/Mcal NE",
      maximum: "6.4% of crude protein (SID Lys:CP)",
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
