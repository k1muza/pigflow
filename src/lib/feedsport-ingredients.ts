import { z } from "zod";

import manifestJson from "@/data/nutrition/feedsport/manifest.json";
import nutrientsJson from "@/data/nutrition/feedsport/nutrients.json";
import ingredients01 from "@/data/nutrition/feedsport/ingredients/ingredients-01.json";
import ingredients02 from "@/data/nutrition/feedsport/ingredients/ingredients-02.json";
import ingredients03 from "@/data/nutrition/feedsport/ingredients/ingredients-03.json";
import ingredients04 from "@/data/nutrition/feedsport/ingredients/ingredients-04.json";
import ingredients05 from "@/data/nutrition/feedsport/ingredients/ingredients-05.json";
import ingredients06 from "@/data/nutrition/feedsport/ingredients/ingredients-06.json";
import ingredients07 from "@/data/nutrition/feedsport/ingredients/ingredients-07.json";
import ingredients08 from "@/data/nutrition/feedsport/ingredients/ingredients-08.json";
import ingredients09 from "@/data/nutrition/feedsport/ingredients/ingredients-09.json";
import ingredients10 from "@/data/nutrition/feedsport/ingredients/ingredients-10.json";
import ingredients11 from "@/data/nutrition/feedsport/ingredients/ingredients-11.json";
import ingredients12 from "@/data/nutrition/feedsport/ingredients/ingredients-12.json";
import ingredients13 from "@/data/nutrition/feedsport/ingredients/ingredients-13.json";
import ingredients14 from "@/data/nutrition/feedsport/ingredients/ingredients-14.json";
import ingredients15 from "@/data/nutrition/feedsport/ingredients/ingredients-15.json";
import ingredients16 from "@/data/nutrition/feedsport/ingredients/ingredients-16.json";
import ingredients17 from "@/data/nutrition/feedsport/ingredients/ingredients-17.json";

const compositionSchema = z.object({
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

export const FEEDSPORT_MANIFEST = manifestSchema.parse(manifestJson);
export const FEEDSPORT_NUTRIENTS = z.array(nutrientSchema).parse(nutrientsJson);
export const FEEDSPORT_INGREDIENTS = z.array(ingredientSchema).parse(ingredientRows);

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
