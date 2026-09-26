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
    expect(analysis.energy.metabolizableKcalKg.value).toBeCloseTo(3334.0447, 3);

    expect(analysis.energy.netKcalKg).toMatchObject({ complete: true });
    expect(analysis.energy.netKcalKg.value).toBeCloseTo(2506.1085, 3);

    expect(analysis.sidAminoAcidsPct.lysine).toMatchObject({ complete: true });
    expect(analysis.sidAminoAcidsPct.lysine.value).toBeCloseTo(0.928804, 5);

    expect(analysis.crudeProteinPct).toMatchObject({ complete: true });
    expect(analysis.crudeProteinPct.value).toBeCloseTo(18.0711, 3);
  });

  it("treats non-contributing ingredient classes as structural zero, not missing", () => {
    const formulation = feedFormulationById("pic-corn-soybean-meal")!;
    const { analysis } = analyzeFeedFormulation(formulation);

    expect(analysis.traceMineralsPpm.zinc.missingIngredientIds).not.toContain(
      "corn-oil",
    );
    expect(analysis.traceMineralsPpm.zinc.missingIngredientIds).not.toContain(
      "sodium-chloride",
    );
    expect(analysis.traceMineralsPpm.zinc.missingIngredientIds).not.toContain(
      "l-lysine-hcl",
    );
    expect(analysis.traceMineralsPpm.zinc.missingIngredientIds).not.toContain(
      "dl-methionine",
    );
    expect(analysis.traceMineralsPpm.zinc.missingIngredientIds).not.toContain(
      "l-threonine",
    );

    expect(analysis.traceMineralsPpm.zinc.missingIngredientIds).toContain(
      "vitamin-trace-mineral-premix",
    );
  });

  it("uses fallback nutrient data to complete the high-fiber formulation energy and SID lysine", () => {
    const formulation = feedFormulationById("pic-high-fiber")!;
    const { analysis, nutrientDataSources } = analyzeFeedFormulation(formulation);

    expect(analysis.energy.metabolizableKcalKg).toMatchObject({ complete: true });
    expect(analysis.energy.metabolizableKcalKg.value).toBeCloseTo(3238.9640, 3);
    expect(analysis.energy.netKcalKg).toMatchObject({ complete: true });
    expect(analysis.energy.netKcalKg.value).toBeCloseTo(2400.4460, 3);
    expect(analysis.sidAminoAcidsPct.lysine).toMatchObject({ complete: true });
    expect(analysis.sidAminoAcidsPct.lysine.value).toBeCloseTo(0.928005, 5);
    expect(nutrientDataSources).toContain(
      "Tables of composition and nutritional values of feed materials",
    );
  });
});
