export type FormulationIngredient = {
  ingredientId: string;
  sourceName: string;
  inclusionPct: number;
};

export type FormulationRequirementTarget = {
  programmeId: string;
  phaseId: string;
  provenance: "source" | "pigflow";
  note?: string;
};

export type FeedFormulation = {
  id: string;
  name: string;
  description: string;
  sourceTable?: string;
  sourcePage?: number;
  sourceUrl?: string;
  reportedTotalPct?: number;
  ingredients: readonly FormulationIngredient[];
  requirementTarget?: FormulationRequirementTarget;
  featured: boolean;
};

/**
 * Static source diets were removed with the PIC dataset. New formulations
 * should be created from PigFlow's formulation workflow and evaluated against
 * a selected Brazilian Tables requirement phase.
 */
export const FEED_FORMULATIONS: readonly FeedFormulation[] = [];

export function feedFormulationById(id: string): FeedFormulation | undefined {
  return FEED_FORMULATIONS.find((formulation) => formulation.id === id);
}
