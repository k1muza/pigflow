import { describe, expect, it } from "vitest";

import type { FeedFormulation } from "./feed-formulations";
import { analyzeFeedFormulation, formulationDietFormula } from "./formulation-analysis";

const TEST_FORMULATION: FeedFormulation = {
  id: "test-corn-soy",
  name: "Test corn-soy diet",
  description: "Synthetic formulation fixture.",
  ingredients: [
    { ingredientId: "corn-yellow-dent", sourceName: "Corn", inclusionPct: 60.01 },
    {
      ingredientId: "soybean-meal-dehulled-solvent-extracted",
      sourceName: "Soybean meal",
      inclusionPct: 35,
    },
    { ingredientId: "corn-oil", sourceName: "Corn oil", inclusionPct: 5 },
  ],
  featured: false,
};

describe("formulation analysis", () => {
  it("normalizes rounded formulation rows to exactly 100% for calculation", () => {
    const normalized = formulationDietFormula(TEST_FORMULATION);

    expect(normalized.sourceInclusionTotalPct).toBeCloseTo(100.01, 8);
    expect(normalized.normalizationFactor).toBeCloseTo(100 / 100.01, 10);
    expect(
      normalized.formula.ingredients.reduce((sum, row) => sum + row.inclusionPct, 0),
    ).toBeCloseTo(100, 10);
    expect(TEST_FORMULATION.ingredients[0].inclusionPct).toBe(60.01);
  });

  it("calculates nutrients from ingredient records rather than storing source outputs", () => {
    const { analysis, nutrientDataSources } = analyzeFeedFormulation(TEST_FORMULATION);

    expect(analysis.energy.metabolizableKcalKg.complete).toBe(true);
    expect(analysis.energy.metabolizableKcalKg.value).toBeGreaterThan(3000);
    expect(analysis.sidAminoAcidsPct.lysine.complete).toBe(true);
    expect(analysis.sidAminoAcidsPct.lysine.value).toBeGreaterThan(0);
    expect(analysis.crudeProteinPct.complete).toBe(true);
    expect(analysis.crudeProteinPct.value).toBeGreaterThan(0);
    expect(nutrientDataSources.length).toBeGreaterThan(0);
  });
});
