import { describe, expect, it } from "vitest";

import {
  PIC_EXAMPLE_FORMULATIONS,
  feedFormulationById,
} from "./feed-formulations";

describe("PIC example formulation library", () => {
  it("stores the two PIC example ingredient-ratio sets", () => {
    expect(PIC_EXAMPLE_FORMULATIONS.map((formulation) => formulation.id)).toEqual([
      "pic-corn-soybean-meal",
      "pic-high-fiber",
    ]);
  });

  it("preserves the corn-soybean meal ingredient ratios", () => {
    const formulation = feedFormulationById("pic-corn-soybean-meal");
    expect(formulation?.reportedTotalPct).toBe(100);
    expect(formulation?.ingredients.reduce((sum, row) => sum + row.inclusionPct, 0)).toBeCloseTo(
      100,
      1,
    );
    expect(
      formulation?.ingredients.find((row) => row.ingredientId === "corn-yellow-dent")
        ?.inclusionPct,
    ).toBe(70.99);
    expect(
      formulation?.ingredients.find(
        (row) => row.ingredientId === "soybean-meal-dehulled-solvent-extracted",
      )?.inclusionPct,
    ).toBe(25.19);
  });

  it("does not store PIC's reported resulting nutrient profile", () => {
    const formulation = feedFormulationById("pic-corn-soybean-meal");
    expect(formulation).toBeDefined();
    expect("nutrientProfiles" in formulation!).toBe(false);
    expect("ingredientDatabase" in formulation!).toBe(false);
  });
});
