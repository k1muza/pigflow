import { z } from "zod";

import picGrowth2021Json from "@/data/nutrition/programmes/pic-growth-2021.json";

export type NutritionGrowthStage = "weaner" | "grower" | "finisher";
export type NutritionVariant = "standard" | "ractopamine_lt_21d" | "ractopamine_gt_21d";
export type Range = { min: number; max: number };

const rangeSchema = z.object({ min: z.number(), max: z.number() });
const nullableNumber = z.number().nullable();

const ratiosSchema = z.object({
  methionineCysteine: z.number(),
  threonine: z.number(),
  tryptophan: z.number(),
  valine: z.number(),
  isoleucine: z.number(),
  leucine: z.number(),
  histidine: z.number(),
  phenylalanineTyrosine: z.number(),
});

const requirementsSchema = z.object({
  energy: z
    .object({
      netKcalKg: z.number().optional(),
      metabolizableKcalKg: z.number().optional(),
    })
    .optional()
    .default({}),
  aminoAcids: z.object({
    sidLysinePct: z.number().optional(),
    sidLysineGPerMcalNE: z.number().optional(),
    sidLysineGPerMcalME: z.number().optional(),
    ratiosToSidLysinePct: ratiosSchema,
  }),
  macroMinerals: z.object({
    sodiumPct: z.number(),
    chloridePct: z.number().optional(),
    chloridePctRange: rangeSchema.optional(),
    calciumPct: z.number().optional(),
    sttdPhosphorusPct: z.number().optional(),
    availablePhosphorusPct: z.number().optional(),
    sttdPhosphorusGPerMcalNE: z.number().optional(),
    sttdPhosphorusGPerMcalME: z.number().optional(),
    availablePhosphorusGPerMcalNE: z.number().optional(),
    availablePhosphorusGPerMcalME: z.number().optional(),
    analyzedCalciumToPhosphorusRange: rangeSchema.optional(),
  }),
  traceMineralsPpm: z.object({
    zinc: z.number(),
    iron: z.number(),
    manganese: z.number(),
    copper: z.number(),
    iodine: z.number(),
    selenium: z.number(),
  }),
  vitamins: z.object({
    vitaminAIuKg: z.number(),
    vitaminDIuKg: z.number(),
    vitaminEIuKg: z.number(),
    vitaminKMgKg: z.number(),
    niacinMgKg: z.number(),
    riboflavinMgKg: z.number(),
    pantothenicAcidMgKg: z.number(),
    vitaminB12McgKg: z.number(),
    totalCholineMgKg: z.number().optional(),
  }),
  practical: z.object({
    soybeanMealMaxPct: z.number().optional(),
    sidLysineToCrudeProteinMaxPct: z.number().optional(),
    highlyDigestibleProteinPctRange: rangeSchema.optional(),
    highlyDigestibleCarbohydratePct: z.number().optional(),
    lLysineHclMaxPct: z.number().optional(),
    crudeProteinMinPct: z.number().optional(),
  }),
});

const phaseSchema = z.object({
  id: z.string(),
  label: z.string(),
  variant: z.enum(["standard", "ractopamine_lt_21d", "ractopamine_gt_21d"]),
  sourceWeight: z.object({
    minKg: z.number(),
    maxKg: nullableNumber,
    label: z.string(),
  }),
  lookupWeight: z.object({
    minKg: z.number(),
    maxKg: nullableNumber,
  }),
  requirements: requirementsSchema,
});

const nutritionProgrammeFileSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string(),
  name: z.string(),
  source: z.object({
    publisher: z.string(),
    title: z.string(),
    version: z.string(),
    sections: z.array(z.string()),
    url: z.string().url(),
  }),
  phases: z.array(phaseSchema).min(1),
});

export type NutritionProgrammeFile = z.infer<typeof nutritionProgrammeFileSchema>;
type RawPhase = z.infer<typeof phaseSchema>;

export type AminoAcidRequirements = {
  methionineCysteineToLysPct: number;
  threonineToLysPct: number;
  tryptophanToLysPct: number;
  valineToLysPct: number;
  isoleucineToLysPct: number;
  leucineToLysPct: number;
  histidineToLysPct: number;
  phenylalanineTyrosineToLysPct: number;
};

export type TraceMinerals = {
  zincPpm: number;
  ironPpm: number;
  manganesePpm: number;
  copperPpm: number;
  iodinePpm: number;
  seleniumPpm: number;
};

export type Vitamins = {
  vitaminAIuKg: number;
  vitaminDIuKg: number;
  vitaminEIuKg: number;
  vitaminKMgKg: number;
  niacinMgKg: number;
  riboflavinMgKg: number;
  pantothenicAcidMgKg: number;
  vitaminB12McgKg: number;
  totalCholineMgKg?: number;
};

export type MineralRequirements = {
  sodiumPct: number;
  chloridePct?: number;
  chloridePctRange?: Range;
  calciumPct?: number;
  sttdPhosphorusPct?: number;
  availablePhosphorusPct?: number;
  sttdPhosphorusGPerMcalNE?: number;
  sttdPhosphorusGPerMcalME?: number;
  availablePhosphorusGPerMcalNE?: number;
  availablePhosphorusGPerMcalME?: number;
  analyzedCalciumToPhosphorus?: Range;
};

export type PracticalDietConstraints = {
  soybeanMealMaxPct?: number;
  sidLysineToCrudeProteinMaxPct?: number;
  highlyDigestibleProteinPct?: Range;
  highlyDigestibleCarbohydratePct?: number;
  lLysineHclMaxPct?: number;
  crudeProteinMinPct?: number;
};

export type NutritionRequirements = {
  netEnergyKcalKg?: number;
  metabolizableEnergyKcalKg?: number;
  sidLysinePct?: number;
  sidLysineGPerMcalNE?: number;
  sidLysineGPerMcalME?: number;
  aminoAcids: AminoAcidRequirements;
  minerals: MineralRequirements;
  traceMinerals: TraceMinerals;
  vitamins: Vitamins;
  practical: PracticalDietConstraints;
};

export type NutritionPhase = {
  id: string;
  label: string;
  variant: NutritionVariant;
  sourceMinWeightKg: number;
  sourceMaxWeightKg: number | null;
  sourceWeightRange: string;
  lookupMinWeightKg: number;
  lookupMaxWeightKg: number | null;
  requirements: NutritionRequirements;
};

export type NutritionProgramme = {
  id: string;
  name: string;
  source: string;
  sourceVersion: string;
  sourceSections: readonly string[];
  sourceUrl: string;
  phases: readonly NutritionPhase[];
};

function phaseFromFile(phase: RawPhase): NutritionPhase {
  const aa = phase.requirements.aminoAcids;
  const minerals = phase.requirements.macroMinerals;
  const trace = phase.requirements.traceMineralsPpm;
  return {
    id: phase.id,
    label: phase.label,
    variant: phase.variant,
    sourceMinWeightKg: phase.sourceWeight.minKg,
    sourceMaxWeightKg: phase.sourceWeight.maxKg,
    sourceWeightRange: phase.sourceWeight.label,
    lookupMinWeightKg: phase.lookupWeight.minKg,
    lookupMaxWeightKg: phase.lookupWeight.maxKg,
    requirements: {
      netEnergyKcalKg: phase.requirements.energy.netKcalKg,
      metabolizableEnergyKcalKg: phase.requirements.energy.metabolizableKcalKg,
      sidLysinePct: aa.sidLysinePct,
      sidLysineGPerMcalNE: aa.sidLysineGPerMcalNE,
      sidLysineGPerMcalME: aa.sidLysineGPerMcalME,
      aminoAcids: {
        methionineCysteineToLysPct: aa.ratiosToSidLysinePct.methionineCysteine,
        threonineToLysPct: aa.ratiosToSidLysinePct.threonine,
        tryptophanToLysPct: aa.ratiosToSidLysinePct.tryptophan,
        valineToLysPct: aa.ratiosToSidLysinePct.valine,
        isoleucineToLysPct: aa.ratiosToSidLysinePct.isoleucine,
        leucineToLysPct: aa.ratiosToSidLysinePct.leucine,
        histidineToLysPct: aa.ratiosToSidLysinePct.histidine,
        phenylalanineTyrosineToLysPct: aa.ratiosToSidLysinePct.phenylalanineTyrosine,
      },
      minerals: {
        sodiumPct: minerals.sodiumPct,
        chloridePct: minerals.chloridePct,
        chloridePctRange: minerals.chloridePctRange,
        calciumPct: minerals.calciumPct,
        sttdPhosphorusPct: minerals.sttdPhosphorusPct,
        availablePhosphorusPct: minerals.availablePhosphorusPct,
        sttdPhosphorusGPerMcalNE: minerals.sttdPhosphorusGPerMcalNE,
        sttdPhosphorusGPerMcalME: minerals.sttdPhosphorusGPerMcalME,
        availablePhosphorusGPerMcalNE: minerals.availablePhosphorusGPerMcalNE,
        availablePhosphorusGPerMcalME: minerals.availablePhosphorusGPerMcalME,
        analyzedCalciumToPhosphorus: minerals.analyzedCalciumToPhosphorusRange,
      },
      traceMinerals: {
        zincPpm: trace.zinc,
        ironPpm: trace.iron,
        manganesePpm: trace.manganese,
        copperPpm: trace.copper,
        iodinePpm: trace.iodine,
        seleniumPpm: trace.selenium,
      },
      vitamins: phase.requirements.vitamins,
      practical: {
        soybeanMealMaxPct: phase.requirements.practical.soybeanMealMaxPct,
        sidLysineToCrudeProteinMaxPct:
          phase.requirements.practical.sidLysineToCrudeProteinMaxPct,
        highlyDigestibleProteinPct:
          phase.requirements.practical.highlyDigestibleProteinPctRange,
        highlyDigestibleCarbohydratePct:
          phase.requirements.practical.highlyDigestibleCarbohydratePct,
        lLysineHclMaxPct: phase.requirements.practical.lLysineHclMaxPct,
        crudeProteinMinPct: phase.requirements.practical.crudeProteinMinPct,
      },
    },
  };
}

export function loadNutritionProgramme(input: unknown): NutritionProgramme {
  const file = nutritionProgrammeFileSchema.parse(input);
  return {
    id: file.id,
    name: file.name,
    source: file.source.title,
    sourceVersion: file.source.version,
    sourceSections: file.source.sections,
    sourceUrl: file.source.url,
    phases: file.phases.map(phaseFromFile),
  };
}

export const PIC_GROWTH_NUTRITION_2021 = loadNutritionProgramme(picGrowth2021Json);
export const DEFAULT_GROWTH_NUTRITION_PROGRAMME = PIC_GROWTH_NUTRITION_2021;

export function nutritionPhasesAtSourceWeight(
  weightKg: number,
  programme: NutritionProgramme = DEFAULT_GROWTH_NUTRITION_PROGRAMME,
): readonly NutritionPhase[] {
  assertWeight(weightKg);
  return programme.phases.filter(
    ({ sourceMinWeightKg, sourceMaxWeightKg }) =>
      weightKg >= sourceMinWeightKg &&
      (sourceMaxWeightKg === null || weightKg < sourceMaxWeightKg),
  );
}

export function nutritionPhaseAtWeight(
  weightKg: number,
  programme: NutritionProgramme = DEFAULT_GROWTH_NUTRITION_PROGRAMME,
): NutritionPhase {
  assertWeight(weightKg);
  const phase = programme.phases.find(
    ({ variant, lookupMinWeightKg, lookupMaxWeightKg }) =>
      variant === "standard" &&
      weightKg >= lookupMinWeightKg &&
      (lookupMaxWeightKg === null || weightKg < lookupMaxWeightKg),
  );
  if (!phase) throw new Error(`No standard nutrition phase covers ${weightKg} kg in ${programme.id}.`);
  return phase;
}

export function nutritionPhaseForVariant(
  weightKg: number,
  variant: NutritionVariant,
  programme: NutritionProgramme = DEFAULT_GROWTH_NUTRITION_PROGRAMME,
): NutritionPhase {
  assertWeight(weightKg);
  const phase = programme.phases.find(
    (candidate) =>
      candidate.variant === variant &&
      weightKg >= candidate.lookupMinWeightKg &&
      (candidate.lookupMaxWeightKg === null || weightKg < candidate.lookupMaxWeightKg),
  );
  if (!phase) throw new Error(`No ${variant} nutrition phase covers ${weightKg} kg in ${programme.id}.`);
  return phase;
}

export type GrowthStageNutrition = {
  growthStage: NutritionGrowthStage;
  weightKg: number;
  programmeId: string;
  phase: NutritionPhase;
};

export function nutritionForGrowthStage(
  growthStage: NutritionGrowthStage,
  weightKg: number,
  programme: NutritionProgramme = DEFAULT_GROWTH_NUTRITION_PROGRAMME,
): GrowthStageNutrition {
  return { growthStage, weightKg, programmeId: programme.id, phase: nutritionPhaseAtWeight(weightKg, programme) };
}

function assertWeight(weightKg: number): void {
  if (!Number.isFinite(weightKg) || weightKg < 0) {
    throw new Error("Nutrition lookup requires a non-negative finite liveweight.");
  }
}
