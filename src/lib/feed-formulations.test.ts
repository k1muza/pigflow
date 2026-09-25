import { describe, expect, it } from "vitest";

import {
  PIC_EXAMPLE_FORMULATIONS,
  feedFormulationById,
} from "./feed-formulations";

describe("PIC example formulation library", () => {
  it("stores the two actual example diets from PIC Table B2", () => {
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
    expect(formulation?.ingredients.find((row) => row.ingredientId === "corn-yellow-dent")?.inclusionPct).toBe(
      70.99,
    );
    expect(
      formulation?.ingredients.find(
        (row) => row.ingredientId === "soybean-meal-dehulled-solvent-extracted",
      )?.inclusionPct,
    ).toBe(25.19);
  });

  it("preserves PIC's reported nutrient profiles", () => {
    const cornSoy = feedFormulationById("pic-corn-soybean-meal");
    expect(cornSoy?.nutrientProfiles[0]).toMatchObject({
      basis: "NRC 2012",
      metabolizableEnergyKcalKg: 3342,
      netEnergyKcalKg: 2515,
      sidLysinePct: 0.93,
    });
    expect(cornSoy?.nutrientProfiles[1]).toMatchObject({
      metabolizableEnergyKcalKg: 3232,
      netEnergyKcalKg: 2414,
      sidLysinePct: 0.91,
    });

    expect(feedFormulationById("pic-high-fiber")?.nutrientProfiles[0]).toMatchObject({
      metabolizableEnergyKcalKg: 3342,
      netEnergyKcalKg: 2452,
      sidLysinePct: 0.93,
    });
  });
});
