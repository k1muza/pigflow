import { z } from "zod";

import ingredientLibraryJson from "@/data/nutrition/ingredients/ingredient-library.json";

const rangeSchema = z.object({ min: z.number(), max: z.number() });

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
      totalPct: z.record(z.string(), z.number()).default({}),
      sidPct: z.record(z.string(), z.number()).default({}),
    })
    .default({ totalPct: {}, sidPct: {} }),
  macroMinerals: z
    .object({
      calciumPct: z.number().optional(),
      totalPhosphorusPct: z.number().optional(),
      availablePhosphorusPct: z.number().optional(),
      sttdPhosphorusPct: z.number().optional(),
      sodiumPct: z.number().optional(),
      chloridePct: z.number().optional(),
      potassiumPct: z.number().optional(),
      magnesiumPct: z.number().optional(),
    })
    .default({}),
  traceMineralsPpm: z.record(z.string(), z.number()).default({}),
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
