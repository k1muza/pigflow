import {
  analyzeDiet,
  type DietAnalysis,
  type DietFormula,
  type IngredientPrice,
} from "./diet-formula";
import {
  INGREDIENT_LIBRARY,
  type IngredientLibrary,
} from "./ingredient-nutrients";
import type { FeedFormulation } from "./feed-formulations";

export type FeedFormulationAnalysis = {
  sourceInclusionTotalPct: number;
  normalizationFactor: number;
  formula: DietFormula;
  analysis: DietAnalysis;
  nutrientDataSources: readonly string[];
};

/**
 * PIC prints individual inclusion rows rounded to two decimal places. Those
 * rows can sum to 100.01% or 100.02% even though the source reports a 100%
 * ration. Preserve the published ratios in FeedFormulation, but normalize the
 * weights used by calculation back to exactly 100%.
 */
export function formulationDietFormula(formulation: FeedFormulation): {
  sourceInclusionTotalPct: number;
  normalizationFactor: number;
  formula: DietFormula;
} {
  const sourceInclusionTotalPct = formulation.ingredients.reduce(
    (sum, ingredient) => sum + ingredient.inclusionPct,
    0,
  );

  if (!Number.isFinite(sourceInclusionTotalPct) || sourceInclusionTotalPct <= 0) {
    throw new Error(`Formulation ${formulation.id} has no valid ingredient total.`);
  }

  const normalizationFactor = 100 / sourceInclusionTotalPct;
  const formula: DietFormula = {
    ingredients: formulation.ingredients.map((ingredient) => ({
      ingredientId: ingredient.ingredientId,
      inclusionPct: ingredient.inclusionPct * normalizationFactor,
    })),
  };

  return { sourceInclusionTotalPct, normalizationFactor, formula };
}

export function analyzeFeedFormulation(
  formulation: FeedFormulation,
  prices: readonly IngredientPrice[] = [],
  library: IngredientLibrary = INGREDIENT_LIBRARY,
): FeedFormulationAnalysis {
  const normalized = formulationDietFormula(formulation);
  const analysis = analyzeDiet(normalized.formula, prices, library);

  const nutrientDataSources = Array.from(
    new Set(
      formulation.ingredients.map((row) => {
        const ingredient = library.ingredients.find(
          (candidate) => candidate.id === row.ingredientId,
        );
        if (!ingredient) return "Unknown ingredient source";
        return (
          ingredient.provenance.source?.title ??
          `${library.source.title} (${library.source.year})`
        );
      }),
    ),
  );

  return {
    ...normalized,
    analysis,
    nutrientDataSources,
  };
}
