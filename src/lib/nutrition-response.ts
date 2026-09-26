import { z } from "zod";

import picSidLysineResponseJson from "@/data/nutrition/response-models/pic-sid-lysine-2021.json";

const responseEvidenceSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string(),
  name: z.string(),
  source: z.object({
    publisher: z.string(),
    title: z.string(),
    year: z.number().int(),
    doi: z.string(),
    url: z.string().url(),
  }),
  population: z.object({
    trials: z.number().int().positive(),
    pigs: z.number().int().positive(),
    trialYears: z.object({ min: z.number().int(), max: z.number().int() }),
    bodyWeightKg: z.object({ min: z.number().positive(), max: z.number().positive() }),
    sexModel: z.string(),
  }),
  energy: z.object({
    ingredientDatabase: z.string(),
    systems: z.array(z.enum(["ME", "NE"])),
  }),
  responses: z.array(z.enum(["ADG", "G:F"])),
  biologicalTarget: z.object({
    derivation: z.string(),
    approximateMaximumAdgPct: z.number().positive(),
    approximateMaximumGainFeedPct: z.number().positive(),
  }),
  capabilities: z.object({
    biologicalTarget: z.boolean(),
    marginalAdgCurve: z.boolean(),
    marginalGainFeedCurve: z.boolean(),
    economicOptimum: z.boolean(),
  }),
  notes: z.array(z.string()),
});

export type NutritionResponseEvidence = z.infer<typeof responseEvidenceSchema>;

export type NutritionPerformancePrediction = {
  averageDailyGainKg: number;
  feedConversionRatio: number;
};

export type NutritionPerformanceInput = {
  weightKg: number;
  sidLysinePct: number;
  metabolizableEnergyKcalKg?: number;
  netEnergyKcalKg?: number;
};

/**
 * Contract for a sourced biological response model.
 *
 * The economics layer deliberately consumes this abstraction rather than
 * inventing ADG/FCR itself. A future PIC model can implement it when the
 * response coefficients are available from a source we can reproduce.
 */
export interface NutritionPerformancePredictor {
  readonly id: string;
  predict(input: NutritionPerformanceInput): NutritionPerformancePrediction;
}

export function loadNutritionResponseEvidence(input: unknown): NutritionResponseEvidence {
  return responseEvidenceSchema.parse(input);
}

export const PIC_SID_LYSINE_RESPONSE_2021 =
  loadNutritionResponseEvidence(picSidLysineResponseJson);

export function canPredictPicEconomicResponse(): boolean {
  const capabilities = PIC_SID_LYSINE_RESPONSE_2021.capabilities;
  return capabilities.marginalAdgCurve && capabilities.marginalGainFeedCurve;
}
