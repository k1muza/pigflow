import { Badge } from "@/components/ui/badge";
import { FeedFormulationWorkbench } from "@/components/feed-formulation-workbench";
import { FEED_PROGRAMMES } from "@/lib/feed-programmes";
import {
  INGREDIENT_LIBRARY,
  formulationPriorityNutrients,
} from "@/lib/ingredient-nutrients";

export default function FeedFormulationsPage() {
  const programmes = FEED_PROGRAMMES
    .filter((programme) => programme.status === "loaded" && programme.phases.length > 0)
    .map((programme) => ({
      id: programme.id,
      name: programme.name,
      phases: programme.phases.map((phase) => ({
        id: phase.id,
        label: phase.label,
        sourceTable: phase.sourceTable,
      })),
    }));

  const ingredients = INGREDIENT_LIBRARY.ingredients.map((ingredient) => ({
    id: ingredient.id,
    name: ingredient.name,
    category: ingredient.category,
    minInclusionPct: ingredient.constraints.minInclusionPct,
    maxInclusionPct: ingredient.constraints.maxInclusionPct,
    priorityNutrients: formulationPriorityNutrients(ingredient),
  }));

  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Formulations</h1>
          <Badge variant="secondary">GLPK least-cost solver</Badge>
        </div>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-muted">
          Generate diets from your available ingredients and local prices, using Brazilian Tables
          2024 nutrient targets as hard constraints. If no exact diet exists, PigFlow runs a
          diagnostic model to show the limiting nutrients instead of quietly weakening the target.
        </p>
      </div>

      <FeedFormulationWorkbench programmes={programmes} ingredients={ingredients} />
    </div>
  );
}
