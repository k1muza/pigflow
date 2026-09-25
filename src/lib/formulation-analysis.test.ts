import { describe, expect, it } from "vitest";

import { analyzeFeedFormulation, formulationDietFormula } from "./formulation-analysis";
import { feedFormulationById } from "./feed-formulations";

describe("formulation analysis", () => {
  it("normalizes PIC's rounded printed ratios to exactly 100% for calculation", () => {
    const formulation = feedFormulationById("pic-corn-soybean-meal")!;
    const normalized = formulationDietFormula(formulation);

    expect(normalized.sourceInclusionTotalPct).toBeCloseTo(100.01, 8);
    expect(normalized.normalizationFactor).toBeCloseTo(100 / 100.01, 10);
    expect(
      normalized.formula.ingredients.reduce((sum, row) => sum + row.inclusionPct, 0),
    ).toBeCloseTo(100, 10);

    expect(formulation.ingredients[0].inclusionPct).toBe(70.99);
  });

  it("calculates the corn-soy nutrient profile from ingredient records", () => {
    const formulation = feedFormulationById("pic-corn-soybean-meal")!;
    const { analysis } = analyzeFeedFormulation(formulation);

    expect(analysis.energy.metabolizableKcalKg).toMatchObject({ complete: true });
    expect(analysis.energy.metabolizableKcalKg.value).toBeCloseTo(3334.0784, 3);

    expect(analysis.energy.netKcalKg).toMatchObject({ complete: true });
    expect(analysis.energy.netKcalKg.value).toBeCloseTo(2506.1023, 3);

    expect(analysis.sidAminoAcidsPct.lysine).toMatchObject({ complete: true });
    expect(analysis.sidAminoAcidsPct.lysine.value).toBeCloseTo(0.928804, 5);

    expect(analysis.crudeProteinPct).toMatchObject({ complete: true });
    expect(analysis.crudeProteinPct.value).toBeCloseTo(18.0711, 3);
  });

  it("keeps a calculated nutrient incomplete when a formulation ingredient lacks that value", () => {
    const formulation = feedFormulationById("pic-high-fiber")!;
    const { analysis } = analyzeFeedFormulation(formulation);

    expect(analysis.energy.metabolizableKcalKg.complete).toBe(false);
    expect(analysis.energy.metabolizableKcalKg.missingIngredientIds).toContain(
      "corn-ddgs-low-oil",
    );
  });
});
