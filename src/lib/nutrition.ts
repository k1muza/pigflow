/**
 * PIC growing-pig nutrient specifications, represented at source-table
 * granularity.
 *
 * Source of truth:
 *   PIC Nutrition and Feeding Guidelines
 *   Metric Version 2021.04.14
 *   Section Q — Prestart pigs
 *   Section R — Late nursery and grow-finish gilts and barrows
 *
 * The source tables are deliberately preserved rather than collapsed into
 * PigFlow's weaner/grower/finisher stages. A simpler feeding programme can be
 * derived from these records later; the evidence layer should remain lossless.
 */

export type NutritionGrowthStage = "weaner" | "grower" | "finisher";
export type NutritionVariant = "standard" | "ractopamine_lt_21d" | "ractopamine_gt_21d";

export type Range = {
  min: number;
  max: number;
};

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
  /**
   * PIC prints no added-choline value in the table. Where a footnote gives a
   * total dietary target, it is represented here explicitly.
   */
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

  /** Direct concentration used by the PIC prestart table. */
  sidLysinePct?: number;
  /** Energy-relative specification used by late nursery and grow-finish. */
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

  /** Exact bodyweight interval printed by PIC. */
  sourceMinWeightKg: number;
  sourceMaxWeightKg: number | null;
  sourceWeightRange: string;

  /**
   * Non-overlapping interval used by PigFlow's default lookup.
   *
   * PIC's Section Q ends its second prestart band at 11.5 kg while Section R
   * starts late nursery at 11 kg. The evidence remains 11–23 kg above; the
   * default operational lookup keeps the prestart diet through 11.5 kg.
   */
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

const PIC_SOURCE_URL =
  "https://www.pic.com/wp-content/uploads/sites/3/2021/03/PIC_Nutrition-Guidelines_English-Metric.pdf";

const PRESTART_TRACE: TraceMinerals = {
  zincPpm: 130,
  ironPpm: 130,
  manganesePpm: 50,
  copperPpm: 18,
  iodinePpm: 0.65,
  seleniumPpm: 0.3,
};

const PRESTART_VITAMINS: Vitamins = {
  vitaminAIuKg: 5000,
  vitaminDIuKg: 1600,
  vitaminEIuKg: 50,
  vitaminKMgKg: 3,
  niacinMgKg: 50,
  riboflavinMgKg: 8,
  pantothenicAcidMgKg: 28,
  vitaminB12McgKg: 38,
  totalCholineMgKg: 1325,
};

function aminoAcids(
  methionineCysteineToLysPct: number,
  threonineToLysPct: number,
  tryptophanToLysPct: number,
  valineToLysPct: number,
  isoleucineToLysPct: number,
  leucineToLysPct: number,
  histidineToLysPct: number,
  phenylalanineTyrosineToLysPct: number,
): AminoAcidRequirements {
  return {
    methionineCysteineToLysPct,
    threonineToLysPct,
    tryptophanToLysPct,
    valineToLysPct,
    isoleucineToLysPct,
    leucineToLysPct,
    histidineToLysPct,
    phenylalanineTyrosineToLysPct,
  };
}

function growFinishPhase(input: {
  id: string;
  label: string;
  variant?: NutritionVariant;
  sourceMinWeightKg: number;
  sourceMaxWeightKg: number | null;
  lookupMinWeightKg: number;
  lookupMaxWeightKg: number | null;
  sourceWeightRange: string;
  lysNE: number;
  lysME: number;
  aa: AminoAcidRequirements;
  lLysHclMaxPct?: number;
  sidLysCpMaxPct?: number;
  crudeProteinMinPct?: number;
  sttdPNE: number;
  sttdPME: number;
  availablePNE: number;
  availablePME: number;
  sodiumPct: number;
  chloridePct: number;
  trace: TraceMinerals;
  vitamins: Vitamins;
}): NutritionPhase {
  return {
    id: input.id,
    label: input.label,
    variant: input.variant ?? "standard",
    sourceMinWeightKg: input.sourceMinWeightKg,
    sourceMaxWeightKg: input.sourceMaxWeightKg,
    sourceWeightRange: input.sourceWeightRange,
    lookupMinWeightKg: input.lookupMinWeightKg,
    lookupMaxWeightKg: input.lookupMaxWeightKg,
    requirements: {
      sidLysineGPerMcalNE: input.lysNE,
      sidLysineGPerMcalME: input.lysME,
      aminoAcids: input.aa,
      minerals: {
        sttdPhosphorusGPerMcalNE: input.sttdPNE,
        sttdPhosphorusGPerMcalME: input.sttdPME,
        availablePhosphorusGPerMcalNE: input.availablePNE,
        availablePhosphorusGPerMcalME: input.availablePME,
        analyzedCalciumToPhosphorus: { min: 1.25, max: 1.5 },
        sodiumPct: input.sodiumPct,
        chloridePct: input.chloridePct,
      },
      traceMinerals: input.trace,
      vitamins: input.vitamins,
      practical: {
        lLysineHclMaxPct: input.lLysHclMaxPct,
        sidLysineToCrudeProteinMaxPct: input.sidLysCpMaxPct,
        crudeProteinMinPct: input.crudeProteinMinPct,
      },
    },
  };
}

export const PIC_GROWTH_NUTRITION_2021: NutritionProgramme = {
  id: "pic-growth-2021-04-14",
  name: "PIC growing pig nutrient specifications",
  source: "PIC Nutrition and Feeding Guidelines",
  sourceVersion: "Metric Version 2021.04.14",
  sourceSections: [
    "Q — Nutrient Specifications for Prestart Pigs",
    "R — Nutrient Specifications for Late Nursery and Grow-Finish Gilts and Barrows",
  ],
  sourceUrl: PIC_SOURCE_URL,
  phases: [
    {
      id: "pic-prestart-weaning-7.5",
      label: "Prestart: weaning to ~7.5 kg",
      variant: "standard",
      sourceMinWeightKg: 0,
      sourceMaxWeightKg: 7.5,
      sourceWeightRange: "Weaning to ~7.5 kg",
      lookupMinWeightKg: 0,
      lookupMaxWeightKg: 7.5,
      requirements: {
        netEnergyKcalKg: 2545,
        metabolizableEnergyKcalKg: 3395,
        sidLysinePct: 1.46,
        aminoAcids: aminoAcids(58, 65, 20, 67, 55, 100, 32, 92),
        minerals: {
          availablePhosphorusPct: 0.45,
          sttdPhosphorusPct: 0.5,
          calciumPct: 0.65,
          sodiumPct: 0.4,
          chloridePctRange: { min: 0.35, max: 0.4 },
        },
        traceMinerals: PRESTART_TRACE,
        vitamins: PRESTART_VITAMINS,
        practical: {
          soybeanMealMaxPct: 20,
          sidLysineToCrudeProteinMaxPct: 6.4,
          highlyDigestibleProteinPct: { min: 5, max: 10 },
          highlyDigestibleCarbohydratePct: 15,
        },
      },
    },
    {
      id: "pic-prestart-7.5-11.5",
      label: "Prestart: ~7.5 to 11.5 kg",
      variant: "standard",
      sourceMinWeightKg: 7.5,
      sourceMaxWeightKg: 11.5,
      sourceWeightRange: "~7.5 to 11.5 kg",
      lookupMinWeightKg: 7.5,
      lookupMaxWeightKg: 11.5,
      requirements: {
        netEnergyKcalKg: 2545,
        metabolizableEnergyKcalKg: 3395,
        sidLysinePct: 1.42,
        aminoAcids: aminoAcids(58, 65, 19, 67, 55, 100, 32, 92),
        minerals: {
          availablePhosphorusPct: 0.4,
          sttdPhosphorusPct: 0.45,
          calciumPct: 0.65,
          sodiumPct: 0.35,
          chloridePct: 0.32,
        },
        traceMinerals: PRESTART_TRACE,
        vitamins: PRESTART_VITAMINS,
        practical: {
          soybeanMealMaxPct: 28,
          sidLysineToCrudeProteinMaxPct: 6.4,
          highlyDigestibleProteinPct: { min: 3, max: 5 },
          highlyDigestibleCarbohydratePct: 7.5,
        },
      },
    },
    growFinishPhase({
      id: "pic-late-nursery-11-23",
      label: "Late nursery: 11–23 kg",
      sourceMinWeightKg: 11,
      sourceMaxWeightKg: 23,
      sourceWeightRange: "11–23 kg",
      lookupMinWeightKg: 11.5,
      lookupMaxWeightKg: 23,
      lysNE: 5.32,
      lysME: 3.9,
      aa: aminoAcids(58, 65, 19, 68, 55, 100, 32, 92),
      sidLysCpMaxPct: 6.4,
      sttdPNE: 1.8,
      sttdPME: 1.32,
      availablePNE: 1.54,
      availablePME: 1.14,
      sodiumPct: 0.28,
      chloridePct: 0.32,
      trace: { zincPpm: 130, ironPpm: 130, manganesePpm: 50, copperPpm: 18, iodinePpm: 0.65, seleniumPpm: 0.3 },
      vitamins: { vitaminAIuKg: 5000, vitaminDIuKg: 1600, vitaminEIuKg: 51, vitaminKMgKg: 3.1, niacinMgKg: 51, riboflavinMgKg: 8, pantothenicAcidMgKg: 28, vitaminB12McgKg: 38, totalCholineMgKg: 1325 },
    }),
    growFinishPhase({
      id: "pic-grow-finish-23-41",
      label: "Grow-finish: 23–41 kg",
      sourceMinWeightKg: 23,
      sourceMaxWeightKg: 41,
      sourceWeightRange: "23–41 kg",
      lookupMinWeightKg: 23,
      lookupMaxWeightKg: 41,
      lysNE: 4.74,
      lysME: 3.47,
      aa: aminoAcids(58, 65, 18, 68, 56, 101, 34, 94),
      lLysHclMaxPct: 0.45,
      sttdPNE: 1.62,
      sttdPME: 1.2,
      availablePNE: 1.39,
      availablePME: 1.03,
      sodiumPct: 0.25,
      chloridePct: 0.25,
      trace: { zincPpm: 111, ironPpm: 111, manganesePpm: 43, copperPpm: 15, iodinePpm: 0.55, seleniumPpm: 0.3 },
      vitamins: { vitaminAIuKg: 4250, vitaminDIuKg: 1360, vitaminEIuKg: 44, vitaminKMgKg: 2.6, niacinMgKg: 44, riboflavinMgKg: 7, pantothenicAcidMgKg: 24, vitaminB12McgKg: 33 },
    }),
    growFinishPhase({
      id: "pic-grow-finish-41-59",
      label: "Grow-finish: 41–59 kg",
      sourceMinWeightKg: 41,
      sourceMaxWeightKg: 59,
      sourceWeightRange: "41–59 kg",
      lookupMinWeightKg: 41,
      lookupMaxWeightKg: 59,
      lysNE: 4.11,
      lysME: 3.03,
      aa: aminoAcids(58, 65, 18, 68, 56, 101, 34, 94),
      lLysHclMaxPct: 0.4,
      sttdPNE: 1.43,
      sttdPME: 1.07,
      availablePNE: 1.23,
      availablePME: 0.92,
      sodiumPct: 0.25,
      chloridePct: 0.25,
      trace: { zincPpm: 98, ironPpm: 98, manganesePpm: 38, copperPpm: 14, iodinePpm: 0.49, seleniumPpm: 0.3 },
      vitamins: { vitaminAIuKg: 3750, vitaminDIuKg: 1200, vitaminEIuKg: 37, vitaminKMgKg: 2.4, niacinMgKg: 37, riboflavinMgKg: 7, pantothenicAcidMgKg: 22, vitaminB12McgKg: 29 },
    }),
    growFinishPhase({
      id: "pic-grow-finish-59-82",
      label: "Grow-finish: 59–82 kg",
      sourceMinWeightKg: 59,
      sourceMaxWeightKg: 82,
      sourceWeightRange: "59–82 kg",
      lookupMinWeightKg: 59,
      lookupMaxWeightKg: 82,
      lysNE: 3.54,
      lysME: 2.62,
      aa: aminoAcids(58, 65, 18, 68, 56, 101, 34, 94),
      lLysHclMaxPct: 0.35,
      sttdPNE: 1.25,
      sttdPME: 0.95,
      availablePNE: 1.07,
      availablePME: 0.82,
      sodiumPct: 0.25,
      chloridePct: 0.25,
      trace: { zincPpm: 78, ironPpm: 78, manganesePpm: 30, copperPpm: 11, iodinePpm: 0.39, seleniumPpm: 0.3 },
      vitamins: { vitaminAIuKg: 3000, vitaminDIuKg: 960, vitaminEIuKg: 31, vitaminKMgKg: 1.8, niacinMgKg: 31, riboflavinMgKg: 4, pantothenicAcidMgKg: 18, vitaminB12McgKg: 22 },
    }),
    growFinishPhase({
      id: "pic-grow-finish-82-104",
      label: "Grow-finish: 82–104 kg",
      sourceMinWeightKg: 82,
      sourceMaxWeightKg: 104,
      sourceWeightRange: "82–104 kg",
      lookupMinWeightKg: 82,
      lookupMaxWeightKg: 104,
      lysNE: 3.06,
      lysME: 2.29,
      aa: aminoAcids(58, 65, 18, 68, 56, 101, 34, 95),
      lLysHclMaxPct: 0.28,
      sttdPNE: 1.1,
      sttdPME: 0.84,
      availablePNE: 0.94,
      availablePME: 0.72,
      sodiumPct: 0.25,
      chloridePct: 0.25,
      trace: { zincPpm: 65, ironPpm: 65, manganesePpm: 25, copperPpm: 9, iodinePpm: 0.33, seleniumPpm: 0.25 },
      vitamins: { vitaminAIuKg: 2500, vitaminDIuKg: 800, vitaminEIuKg: 26, vitaminKMgKg: 1.5, niacinMgKg: 26, riboflavinMgKg: 4, pantothenicAcidMgKg: 14, vitaminB12McgKg: 20 },
    }),
    growFinishPhase({
      id: "pic-grow-finish-104-market",
      label: "Grow-finish: 104 kg to market",
      sourceMinWeightKg: 104,
      sourceMaxWeightKg: null,
      sourceWeightRange: "104 kg to market",
      lookupMinWeightKg: 104,
      lookupMaxWeightKg: null,
      lysNE: 2.72,
      lysME: 2.08,
      aa: aminoAcids(58, 66, 18, 68, 56, 102, 34, 96),
      lLysHclMaxPct: 0.25,
      crudeProteinMinPct: 13,
      sttdPNE: 0.99,
      sttdPME: 0.77,
      availablePNE: 0.85,
      availablePME: 0.66,
      sodiumPct: 0.25,
      chloridePct: 0.25,
      trace: { zincPpm: 65, ironPpm: 65, manganesePpm: 25, copperPpm: 9, iodinePpm: 0.33, seleniumPpm: 0.25 },
      vitamins: { vitaminAIuKg: 2500, vitaminDIuKg: 800, vitaminEIuKg: 26, vitaminKMgKg: 1.5, niacinMgKg: 26, riboflavinMgKg: 4, pantothenicAcidMgKg: 14, vitaminB12McgKg: 20 },
    }),
    growFinishPhase({
      id: "pic-grow-finish-104-market-ractopamine-lt21d",
      label: "104 kg to market with ractopamine (<21 days)",
      variant: "ractopamine_lt_21d",
      sourceMinWeightKg: 104,
      sourceMaxWeightKg: null,
      sourceWeightRange: "104 kg to market with ractopamine, <21 days",
      lookupMinWeightKg: 104,
      lookupMaxWeightKg: null,
      lysNE: 3.92,
      lysME: 2.99,
      aa: aminoAcids(58, 68, 20, 68, 56, 100, 33, 94),
      lLysHclMaxPct: 0.45,
      sttdPNE: 1.2,
      sttdPME: 0.93,
      availablePNE: 0.99,
      availablePME: 0.77,
      sodiumPct: 0.25,
      chloridePct: 0.25,
      trace: { zincPpm: 65, ironPpm: 65, manganesePpm: 25, copperPpm: 9, iodinePpm: 0.33, seleniumPpm: 0.25 },
      vitamins: { vitaminAIuKg: 2500, vitaminDIuKg: 800, vitaminEIuKg: 26, vitaminKMgKg: 1.5, niacinMgKg: 26, riboflavinMgKg: 4, pantothenicAcidMgKg: 14, vitaminB12McgKg: 20 },
    }),
    growFinishPhase({
      id: "pic-grow-finish-104-market-ractopamine-gt21d",
      label: "104 kg to market with ractopamine (>21 days)",
      variant: "ractopamine_gt_21d",
      sourceMinWeightKg: 104,
      sourceMaxWeightKg: null,
      sourceWeightRange: "104 kg to market with ractopamine, >21 days",
      lookupMinWeightKg: 104,
      lookupMaxWeightKg: null,
      lysNE: 3.81,
      lysME: 2.91,
      aa: aminoAcids(58, 68, 20, 68, 56, 100, 33, 95),
      lLysHclMaxPct: 0.45,
      sttdPNE: 1.16,
      sttdPME: 0.9,
      availablePNE: 0.96,
      availablePME: 0.74,
      sodiumPct: 0.25,
      chloridePct: 0.25,
      trace: { zincPpm: 65, ironPpm: 65, manganesePpm: 25, copperPpm: 9, iodinePpm: 0.33, seleniumPpm: 0.25 },
      vitamins: { vitaminAIuKg: 2500, vitaminDIuKg: 800, vitaminEIuKg: 26, vitaminKMgKg: 1.5, niacinMgKg: 26, riboflavinMgKg: 4, pantothenicAcidMgKg: 14, vitaminB12McgKg: 20 },
    }),
  ],
};

export const DEFAULT_GROWTH_NUTRITION_PROGRAMME = PIC_GROWTH_NUTRITION_2021;

/** All source-table records that apply to a weight, including special variants. */
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

/**
 * Default operational phase for a liveweight.
 *
 * Special finishing variants are never selected implicitly. A farmer must opt
 * into those explicitly; ordinary lookup returns the standard programme.
 */
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

  if (!phase) {
    throw new Error(`No standard nutrition phase covers ${weightKg} kg in ${programme.id}.`);
  }
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
  if (!phase) {
    throw new Error(`No ${variant} nutrition phase covers ${weightKg} kg in ${programme.id}.`);
  }
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
  return {
    growthStage,
    weightKg,
    programmeId: programme.id,
    phase: nutritionPhaseAtWeight(weightKg, programme),
  };
}

function assertWeight(weightKg: number): void {
  if (!Number.isFinite(weightKg) || weightKg < 0) {
    throw new Error("Nutrition lookup requires a non-negative finite liveweight.");
  }
}
