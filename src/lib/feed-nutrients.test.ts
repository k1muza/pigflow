import { describe, expect, it } from "vitest";

import { nutritionPhaseAtWeight } from "./nutrition";
import {
  FEED_NUTRIENTS,
  feedNutrientById,
  nutrientRequirementValue,
} from "./feed-nutrients";

describe("feed nutrient catalogue", () => {
  it("has stable unique nutrient ids", () => {
    const ids = FEED_NUTRIENTS.map((nutrient) => nutrient.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(feedNutrientById("sid-lysine")?.shortName).toBe("SID Lys");
  });

  it("resolves programme-specific requirement values", () => {
    const phase = nutritionPhaseAtWeight(30);
    expect(nutrientRequirementValue("sid-lysine", phase)).toEqual({
      value: "3.47 g/Mcal ME",
      basis: "energy-relative",
    });
    expect(nutrientRequirementValue("sid-threonine", phase)).toEqual({
      value: "65%",
      basis: "ratio to SID Lys",
    });
    expect(nutrientRequirementValue("zinc", phase)).toEqual({
      value: "111 ppm",
      basis: "diet",
    });
  });
});
