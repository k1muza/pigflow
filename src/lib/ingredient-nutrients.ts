import { z } from "zod";

import ingredientLibraryJson from "@/data/nutrition/ingredients/ingredient-library.json";

const ingredientSchema = z.object({
  id: z.string(),
  name: z.string(),
  aliases: z.array(z.string()).default([]),
  category: z.enum([
    "cereal",
    "protein_meal",
    "byproduct",
    "oil_fat",
    "mineral",
    "amino_acid",
    "vitamin_mineral_premix",
    "other",
  ]),
  composition: z.object({
    dryMatterPct: z.number().optional(),
    crudeProteinPct: z.number().optional(),
    crudeFatPct: z.number().optional(),
    crudeFibrePct: z.number().optional(),
    ashPct: z.number().optional(),
    starchPct: z.number().optional(),
    sugarPct: z.number().optional(),
    neutralDetergentFibrePct: z.number().optional(),
    acidDetergentFibrePct: z.number().optional(),
  }),
  energy: z.object({
    digestibleKcalKg: z.number().optional(),
    metabolizableKcalKg: z.number().optional(),
    netKcalKg: z.number().optional(),
  }),
  aminoAcids: z
    .object({
      /** Concentration printed by the source, on the library basis. */
      totalPct: z.record(z.string(), z.number()).default({}),
      /** NRC Table 17-1 standardized ileal digestibility coefficient. */
      sidDigestibilityPct: z.record(z.string(), z.number()).default({}),
      /** Explicit SID concentration for crystalline sources when appropriate. */
      sidPct: z.record(z.string(), z.number()).default({}),
    })
    .default({ totalPct: {}, sidDigestibilityPct: {}, sidPct: {} }),
  macroMinerals: z
    .object({
      calciumPct: z.number().optional(),
      totalPhosphorusPct: z.number().optional(),
      availablePhosphorusPct: z.number().optional(),
      /** NRC source coefficient; use sttdPhosphorusPctOf() for concentration. */
      sttdPhosphorusDigestibilityPct: z.number().optional(),
      /** Explicit concentration for sources that publish one directly. */
      sttdPhosphorusPct: z.number().optional(),
      sodiumPct: z.number().optional(),
      chloridePct: z.number().optional(),
      potassiumPct: z.number().optional(),
      magnesiumPct: z.number().optional(),
    })
    .default({}),
  traceMineralsPpm: z.record(z.string(), z.number()).default({}),
  vitamins: z
    .object({
      vitaminAIuKg: z.number().optional(),
      vitaminDIuKg: z.number().optional(),
      vitaminEIuKg: z.number().optional(),
      vitaminKMgKg: z.number().optional(),
      niacinMgKg: z.number().optional(),
      riboflavinMgKg: z.number().optional(),
      pantothenicAcidMgKg: z.number().optional(),
      vitaminB12McgKg: z.number().optional(),
      totalCholineMgKg: z.number().optional(),
    })
    .default({}),
  constraints: z
    .object({
      minInclusionPct: z.number().optional(),
      maxInclusionPct: z.number().optional(),
      notes: z.array(z.string()).default([]),
    })
    .default({ notes: [] }),
  provenance: z
    .object({
      sourceIngredientName: z.string().optional(),
      sourcePage: z.number().optional(),
      sourceTable: z.string().optional(),
      source: z
        .object({
          publisher: z.string(),
          title: z.string(),
          year: z.number().int().optional(),
          url: z.string().url(),
          basis: z.string().optional(),
        })
        .optional(),
      notes: z.array(z.string()).default([]),
    })
    .default({ notes: [] }),
});

const ingredientLibrarySchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string(),
  name: z.string(),
  basis: z.object({
    nutrientComposition: z.enum(["as-fed", "dry-matter"]),
    energy: z.string(),
    aminoAcids: z.string(),
    macroMinerals: z.string(),
    traceMinerals: z.string(),
  }),
  source: z.object({
    publisher: z.string(),
    title: z.string(),
    edition: z.string(),
    year: z.number().int(),
    chapter: z.string(),
    doi: z.string(),
    url: z.string().url(),
    companionModel: z.object({
      title: z.string(),
      url: z.string().url(),
    }),
  }),
  notes: z.array(z.string()).default([]),
  ingredients: z.array(ingredientSchema),
});

export type IngredientNutrientRecord = z.infer<typeof ingredientSchema>;
export type IngredientLibrary = z.infer<typeof ingredientLibrarySchema>;

export function loadIngredientLibrary(input: unknown): IngredientLibrary {
  return ingredientLibrarySchema.parse(input);
}

export const INGREDIENT_LIBRARY = loadIngredientLibrary(ingredientLibraryJson);


/**
 * Standardized ileal digestible concentration for one amino acid.
 *
 * NRC Table 17-1 publishes total concentration and an SID coefficient. Keeping
 * that coefficient in JSON lets the source remain auditable while formulation
 * receives the concentration it needs.
 */
export function sidAminoAcidPct(
  ingredient: IngredientNutrientRecord,
  aminoAcid: string,
): number | undefined {
  const explicit = ingredient.aminoAcids.sidPct[aminoAcid];
  if (explicit !== undefined) return explicit;

  const total = ingredient.aminoAcids.totalPct[aminoAcid];
  const digestibility = ingredient.aminoAcids.sidDigestibilityPct[aminoAcid];
  if (total === undefined || digestibility === undefined) return undefined;
  return total * (digestibility / 100);
}

/** STTD phosphorus concentration derived from the NRC total-P row and coefficient. */
export function sttdPhosphorusPctOf(
  ingredient: IngredientNutrientRecord,
): number | undefined {
  if (ingredient.macroMinerals.sttdPhosphorusPct !== undefined) {
    return ingredient.macroMinerals.sttdPhosphorusPct;
  }
  const total = ingredient.macroMinerals.totalPhosphorusPct;
  const digestibility = ingredient.macroMinerals.sttdPhosphorusDigestibilityPct;
  if (total === undefined || digestibility === undefined) return undefined;
  return total * (digestibility / 100);
}
