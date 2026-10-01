
import { describe, expect, it } from "vitest";

import {
  feedRecipeFormulaReportRows,
  feedRecipeReportFilename,
} from "./feed-formulation-report";

describe("feed formulation recipe report", () => {
  it("converts recipe percentages into target-batch and per-tonne quantities", () => {
    const rows = feedRecipeFormulaReportRows({
      formula: {
        ingredients: [
          { ingredientId: "grain", inclusionPct: 60 },
          { ingredientId: "protein", inclusionPct: 40 },
        ],
      },
      ingredients: [
        { ingredientId: "grain", name: "Grain", pricePerKg: 0.3 },
        { ingredientId: "protein", name: "Protein", pricePerKg: 0.5 },
      ],
      targetBatchKg: 500,
    });

    expect(rows).toEqual([
      {
        ingredientId: "grain",
        name: "Grain",
        inclusionPct: 60,
        kgForBatch: 300,
        kgPerTonne: 600,
        pricePerKg: 0.3,
        costForBatchContribution: 90,
        costPerTonneContribution: 180,
      },
      {
        ingredientId: "protein",
        name: "Protein",
        inclusionPct: 40,
        kgForBatch: 200,
        kgPerTonne: 400,
        pricePerKg: 0.5,
        costForBatchContribution: 100,
        costPerTonneContribution: 200,
      },
    ]);
    expect(rows.reduce((sum, row) => sum + row.kgForBatch, 0)).toBeCloseTo(500, 8);
    expect(
      rows.reduce((sum, row) => sum + row.costForBatchContribution, 0),
    ).toBeCloseTo(190, 8);
    expect(
      rows.reduce((sum, row) => sum + row.costPerTonneContribution, 0),
    ).toBeCloseTo(380, 8);
  });

  it("fails rather than exporting an ingredient without the price snapshot", () => {
    expect(() =>
      feedRecipeFormulaReportRows({
        formula: {
          ingredients: [{ ingredientId: "missing", inclusionPct: 100 }],
        },
        ingredients: [],
        targetBatchKg: 250,
      }),
    ).toThrow("Missing report ingredient metadata for missing.");
  });

  it("builds a stable recipe report filename", () => {
    expect(
      feedRecipeReportFilename({
        phaseLabel: "Pre-starter 4.4–6.2 kg",
        recipeLabel: "Lower soy",
      }),
    ).toBe("pigflow-pre-starter-4-4-6-2-kg-lower-soy-recipe.xlsx");
  });
});
