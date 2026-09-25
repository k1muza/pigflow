import { IngredientNutrientBrowser } from "@/components/ingredient-nutrient-browser";

export default function IngredientCatalogPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Ingredient database</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-muted">
          Browse NRC 2012 feed ingredient composition and open an ingredient for its full nutrient record.
        </p>
      </div>
      <IngredientNutrientBrowser />
    </div>
  );
}
