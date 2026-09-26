import { z } from "zod";

import {\n  feedSportIngredientRowsJson,\n  feedSportManifestJson,\n  feedSportNutrientsJson,\n} from "@/data/nutrition/feedsport/snapshot";\n\nconst compositionSchema = z.object({
  nutrientId: z.union([z.string(), z.number()]),
  value: z.number().finite(),
  table: z.string(),
  basis: z.string().optional(),
});

const ingredientSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(""),
  category: z.string().min(1),
  compositions: z.array(compositionSchema),
});

const nutrientSchema = z.object({
  id: z.union([z.string(), z.number()]),
  name: z.string().min(1),
  description: z.string().default(""),
  unit: z.string(),
  categoryId: z.string(),
});

const manifestSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.literal("feedsport-ingredient-snapshot"),
  source: z.object({
    repository: z.string(),
    ref: z.string(),
    commit: z.string(),
    ingredientsPath: z.string(),
    nutrientsPath: z.string(),
  }),
  basisPolicy: z.string(),
  ingredientCount: z.number().int().nonnegative(),
  nutrientCount: z.number().int().nonnegative(),
  swineNutrientCount: z.number().int().nonnegative(),
  ingredientsWithSwineData: z.number().int().nonnegative(),
  shardSize: z.number().int().positive(),
  ingredientShards: z.array(z.string()),
});

export type FeedSportComposition = z.infer<typeof compositionSchema>;
export type FeedSportIngredient = z.infer<typeof ingredientSchema>;
export type FeedSportNutrient = z.infer<typeof nutrientSchema>;
export type FeedSportSnapshotManifest = z.infer<typeof manifestSchema>;

const ingredientRows = [
  ...ingredients01,
  ...ingredients02,
  ...ingredients03,
  ...ingredients04,
  ...ingredients05,
  ...ingredients06,
  ...ingredients07,
  ...ingredients08,
  ...ingredients09,
  ...ingredients10,
  ...ingredients11,
  ...ingredients12,
  ...ingredients13,
  ...ingredients14,
  ...ingredients15,
  ...ingredients16,
  ...ingredients17,
];

export const FEEDSPORT_MANIFEST = manifestSchema.parse(feedSportManifestJson);
export const FEEDSPORT_NUTRIENTS = z.array(nutrientSchema).parse(feedSportNutrientsJson);
export const FEEDSPORT_INGREDIENTS = z.array(ingredientSchema).parse(feedSportIngredientRowsJson);

export const FEEDSPORT_NUTRIENT_BY_ID = new Map(
  FEEDSPORT_NUTRIENTS.map((nutrient) => [String(nutrient.id), nutrient]),
);

export const FEEDSPORT_INGREDIENT_BY_ID = new Map(
  FEEDSPORT_INGREDIENTS.map((ingredient) => [ingredient.id, ingredient]),
);

/**
 * Returns the composition rows for one FeedSport nutrient without choosing
 * between competing source tables. The mapping layer can make that policy
 * explicitly later; this import boundary intentionally preserves the source.
 */
export function feedSportCompositions(
  ingredientId: string,
  nutrientId: string,
): readonly FeedSportComposition[] {
  const ingredient = FEEDSPORT_INGREDIENT_BY_ID.get(ingredientId);
  if (!ingredient) return [];
  return ingredient.compositions.filter(
    (composition) => String(composition.nutrientId) === nutrientId,
  );
}
