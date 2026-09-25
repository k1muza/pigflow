/**
 * Evidence-backed nutrient specifications for growing pigs.
 *
 * This module deliberately keeps nutrition phases separate from PigFlow's
 * housing/lifecycle stages. A pig can still be a "weaner" in the simulation
 * while its diet has moved from a prestarter to a late-nursery phase. The
 * current bodyweight selects the nutrient specification; the growth stage is
 * carried alongside it so callers can attach the result to the animal they
 * already know about.
 *
 * Source:
 *   PIC Nutrition and Feeding Guidelines, Metric Version 2021.04.14,
 *   Section Q (Prestart pigs) and Section R (Late nursery and grow-finish).
 *
 * PIC states that the specifications are based on nutrient intake per day and
 * should be adjusted for feed intake, local conditions, legislation, and
 * markets. These values are therefore reference constraints for a formulation
 * engine, not immutable biological constants.
 */

export type NutritionGrowthStage = "weaner" | "grower" | "finisher";

export type AminoAcidRatios = {
  methionineCysteineToLysPct: number;
  threonineToLysPct: number;
  tryptophanToLysPct: number;
  valineToLysPct: number;
  isoleucineToLysPct: number;
  leucineToLysPct: number;
  histidineToLysPct: number;
  phenylalanineTyrosineToLysPct: number;
};

export type MineralRequirements = {
  sodiumPct: number;
  chloridePct: number;
  /** Direct dietary percentage where PIC publishes one for prestarter diets. */
  calciumPct?: number;
  /** Direct dietary percentage where PIC publishes one for prestarter diets. */
  sttdPhosphorusPct?: number;
  /** Direct dietary percentage where PIC publishes one for prestarter diets. */
  availablePhosphorusPct?: number;
  /** Later phases are expressed relative to dietary energy. */
  sttdPhosphorusGPerMcalNE?: number;
  sttdPhosphorusGPerMcalME?: number;
  availablePhosphorusGPerMcalNE?: number;
  availablePhosphorusGPerMcalME?: number;
  analyzedCalciumToPhosphorusMin?: number;
  analyzedCalciumToPhosphorusMax?: number;
};

export type NutritionRequirements = {
  /**
   * Direct dietary energy targets are published for the two prestarter phases.
   * PIC intentionally treats later-phase energy density as an economic choice,
   * and gives lysine/phosphorus requirements per unit of energy instead.
   */
  netEnergyKcalKg?: number;
  metabolizableEnergyKcalKg?: number;

  /** Direct SID lysine % for prestarter phases. */
  sidLysinePct?: number;
  /** SID lysine-to-energy ratios for late nursery and grow-finish phases. */
  sidLysineGPerMcalNE?: number;
  sidLysineGPerMcalME?: number;

  aminoAcids: AminoAcidRatios;
  minerals: MineralRequirements;

  maxLLysineHclPct?: number;
  maxSidLysineToCrudeProteinPct?: number;
  minCrudeProteinPct?: number;
};

export type NutritionPhase = {
  id: string;
  label: string;
  /**
   * Non-overlapping lookup range used by PigFlow.
   * PIC's source tables overlap slightly at the prestarter/late-nursery join:
   * "~7.5 to 11.5 kg" and "11 to 23 kg". PigFlow keeps the prestarter
   * recommendation through 11.5 kg, then applies the late-nursery table.
   */
  minWeightKg: number;
  maxWeightKg: number | null;
  sourceWeightRange: string;
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

export const PIC_GROWTH_NUTRITION_2021: NutritionProgramme = {
  id: "pic-growth-2021-04-14",
  name: "PIC growing pig nutrient specifications",
  source: "PIC Nutrition and Feeding Guidelines",
  sourceVersion: "Metric Version 2021.04.14",
  sourceSections: ["Q — Prestart pigs", "R — Late nursery and grow-finish gilts and barrows"],
  sourceUrl: PIC_SOURCE_URL,
  phases: [
    {
      id: "pic-prestart-1",
      label: "Prestart 1",
      minWeightKg: 0,
      maxWeightKg: 7.5,
      sourceWeightRange: "Weaning to ~7.5 kg",
      requirements: {
        netEnergyKcalKg: 2545,
        metabolizableEnergyKcalKg: 3395,
        sidLysinePct: 1.46,
        aminoAcids: {
          methionineCysteineToLysPct: 58,
          threonineToLysPct: 65,
          tryptophanToLysPct: 20,
          valineToLysPct: 67,
          isoleucineToLysPct: 55,
          leucineToLysPct: 100,
          histidineToLysPct: 32,
          phenylalanineTyrosineToLysPct: 92,
        },
        minerals: {
          availablePhosphorusPct: 0.45,
          sttdPhosphorusPct: 0.5,
          calciumPct: 0.65,
          sodiumPct: 0.4,
          // PIC publishes 0.35–0.40%; formulation should treat 0.35 as the
          // minimum rather than inventing a point target.
          chloridePct: 0.35,
        },
      },
    },
    {
      id: "pic-prestart-2",
      label: "Prestart 2",
      minWeightKg: 7.5,
      maxWeightKg: 11.5,
      sourceWeightRange: "~7.5 to 11.5 kg",
      requirements: {
        netEnergyKcalKg: 2545,
        metabolizableEnergyKcalKg: 3395,
        sidLysinePct: 1.42,
        aminoAcids: {
          methionineCysteineToLysPct: 58,
          threonineToLysPct: 65,
          tryptophanToLysPct: 19,
          valineToLysPct: 67,
          isoleucineToLysPct: 55,
          leucineToLysPct: 100,
          histidineToLysPct: 32,
          phenylalanineTyrosineToLysPct: 92,
        },
        minerals: {
          availablePhosphorusPct: 0.4,
          sttdPhosphorusPct: 0.45,
          calciumPct: 0.65,
          sodiumPct: 0.35,
          chloridePct: 0.32,
        },
      },
    },
    {
      id: "pic-late-nursery-11-23",
      label: "Late nursery",
      minWeightKg: 11.5,
      maxWeightKg: 23,
      sourceWeightRange: "11 to 23 kg",
      requirements: {
        sidLysineGPerMcalNE: 5.32,
        sidLysineGPerMcalME: 3.9,
        aminoAcids: {
          methionineCysteineToLysPct: 58,
          threonineToLysPct: 65,
          tryptophanToLysPct: 19,
          valineToLysPct: 68,
          isoleucineToLysPct: 55,
          leucineToLysPct: 100,
          histidineToLysPct: 32,
          phenylalanineTyrosineToLysPct: 92,
        },
        minerals: {
          sttdPhosphorusGPerMcalNE: 1.8,
          sttdPhosphorusGPerMcalME: 1.32,
          availablePhosphorusGPerMcalNE: 1.54,
          availablePhosphorusGPerMcalME: 1.14,
          analyzedCalciumToPhosphorusMin: 1.25,
          analyzedCalciumToPhosphorusMax: 1.5,
          sodiumPct: 0.28,
          chloridePct: 0.32,
        },
        maxSidLysineToCrudeProteinPct: 6.4,
      },
    },
    {
      id: "pic-grow-finish-23-41",
      label: "Grow-finish 23–41 kg",
      minWeightKg: 23,
      maxWeightKg: 41,
      sourceWeightRange: "23 to 41 kg",
      requirements: {
        sidLysineGPerMcalNE: 4.74,
        sidLysineGPerMcalME: 3.47,
        aminoAcids: {
          methionineCysteineToLysPct: 58,
          threonineToLysPct: 65,
          tryptophanToLysPct: 18,
          valineToLysPct: 68,
          isoleucineToLysPct: 56,
          leucineToLysPct: 101,
          histidineToLysPct: 34,
          phenylalanineTyrosineToLysPct: 94,
        },
        minerals: {
          sttdPhosphorusGPerMcalNE: 1.62,
          sttdPhosphorusGPerMcalME: 1.2,
          availablePhosphorusGPerMcalNE: 1.39,
          availablePhosphorusGPerMcalME: 1.03,
          analyzedCalciumToPhosphorusMin: 1.25,
          analyzedCalciumToPhosphorusMax: 1.5,
          sodiumPct: 0.25,
          chloridePct: 0.25,
        },
        maxLLysineHclPct: 0.45,
      },
    },
    {
      id: "pic-grow-finish-41-59",
      label: "Grow-finish 41–59 kg",
      minWeightKg: 41,
      maxWeightKg: 59,
      sourceWeightRange: "41 to 59 kg",
      requirements: {
        sidLysineGPerMcalNE: 4.11,
        sidLysineGPerMcalME: 3.03,
        aminoAcids: {
          methionineCysteineToLysPct: 58,
          threonineToLysPct: 65,
          tryptophanToLysPct: 18,
          valineToLysPct: 68,
          isoleucineToLysPct: 56,
          leucineToLysPct: 101,
          histidineToLysPct: 34,
          phenylalanineTyrosineToLysPct: 94,
        },
        minerals: {
          sttdPhosphorusGPerMcalNE: 1.43,
          sttdPhosphorusGPerMcalME: 1.07,
          availablePhosphorusGPerMcalNE: 1.23,
          availablePhosphorusGPerMcalME: 0.92,
          analyzedCalciumToPhosphorusMin: 1.25,
          analyzedCalciumToPhosphorusMax: 1.5,
          sodiumPct: 0.25,
          chloridePct: 0.25,
        },
        maxLLysineHclPct: 0.4,
      },
    },
    {
      id: "pic-grow-finish-59-82",
      label: "Grow-finish 59–82 kg",
      minWeightKg: 59,
      maxWeightKg: 82,
      sourceWeightRange: "59 to 82 kg",
      requirements: {
        sidLysineGPerMcalNE: 3.54,
        sidLysineGPerMcalME: 2.62,
        aminoAcids: {
          methionineCysteineToLysPct: 58,
          threonineToLysPct: 65,
          tryptophanToLysPct: 18,
          valineToLysPct: 68,
          isoleucineToLysPct: 56,
          leucineToLysPct: 101,
          histidineToLysPct: 34,
          phenylalanineTyrosineToLysPct: 94,
        },
        minerals: {
          sttdPhosphorusGPerMcalNE: 1.25,
          sttdPhosphorusGPerMcalME: 0.95,
          availablePhosphorusGPerMcalNE: 1.07,
          availablePhosphorusGPerMcalME: 0.82,
          analyzedCalciumToPhosphorusMin: 1.25,
          analyzedCalciumToPhosphorusMax: 1.5,
          sodiumPct: 0.25,
          chloridePct: 0.25,
        },
        maxLLysineHclPct: 0.35,
      },
    },
    {
      id: "pic-grow-finish-82-104",
      label: "Grow-finish 82–104 kg",
      minWeightKg: 82,
      maxWeightKg: 104,
      sourceWeightRange: "82 to 104 kg",
      requirements: {
        sidLysineGPerMcalNE: 3.06,
        sidLysineGPerMcalME: 2.29,
        aminoAcids: {
          methionineCysteineToLysPct: 58,
          threonineToLysPct: 65,
          tryptophanToLysPct: 18,
          valineToLysPct: 68,
          isoleucineToLysPct: 56,
          leucineToLysPct: 101,
          histidineToLysPct: 34,
          phenylalanineTyrosineToLysPct: 95,
        },
        minerals: {
          sttdPhosphorusGPerMcalNE: 1.1,
          sttdPhosphorusGPerMcalME: 0.84,
          availablePhosphorusGPerMcalNE: 0.94,
          availablePhosphorusGPerMcalME: 0.72,
          analyzedCalciumToPhosphorusMin: 1.25,
          analyzedCalciumToPhosphorusMax: 1.5,
          sodiumPct: 0.25,
          chloridePct: 0.25,
        },
        maxLLysineHclPct: 0.28,
      },
    },
    {
      id: "pic-grow-finish-104-market",
      label: "Grow-finish 104 kg to market",
      minWeightKg: 104,
      maxWeightKg: null,
      sourceWeightRange: "104 kg to market",
      requirements: {
        sidLysineGPerMcalNE: 2.72,
        sidLysineGPerMcalME: 2.08,
        aminoAcids: {
          methionineCysteineToLysPct: 58,
          threonineToLysPct: 66,
          tryptophanToLysPct: 18,
          valineToLysPct: 68,
          isoleucineToLysPct: 56,
          leucineToLysPct: 102,
          histidineToLysPct: 34,
          phenylalanineTyrosineToLysPct: 96,
        },
        minerals: {
          sttdPhosphorusGPerMcalNE: 0.99,
          sttdPhosphorusGPerMcalME: 0.77,
          availablePhosphorusGPerMcalNE: 0.85,
          availablePhosphorusGPerMcalME: 0.66,
          analyzedCalciumToPhosphorusMin: 1.25,
          analyzedCalciumToPhosphorusMax: 1.5,
          sodiumPct: 0.25,
          chloridePct: 0.25,
        },
        maxLLysineHclPct: 0.25,
        minCrudeProteinPct: 13,
      },
    },
  ],
};

/** The default programme currently used for growing-pig nutrition lookups. */
export const DEFAULT_GROWTH_NUTRITION_PROGRAMME = PIC_GROWTH_NUTRITION_2021;

/**
 * Finds the dietary phase for a growing pig's current liveweight.
 *
 * Ranges are half-open: a 23.0 kg pig has entered the 23–41 kg specification,
 * while 22.99 kg remains in late nursery. The last phase is open-ended because
 * PIC expresses it as "104 kg to market".
 */
export function nutritionPhaseAtWeight(
  weightKg: number,
  programme: NutritionProgramme = DEFAULT_GROWTH_NUTRITION_PROGRAMME,
): NutritionPhase {
  if (!Number.isFinite(weightKg) || weightKg < 0) {
    throw new Error("Nutrition lookup requires a non-negative finite liveweight.");
  }

  const phase = programme.phases.find(
    ({ minWeightKg, maxWeightKg }) =>
      weightKg >= minWeightKg && (maxWeightKg === null || weightKg < maxWeightKg),
  );

  if (!phase) {
    throw new Error(`No nutrition phase covers ${weightKg} kg in ${programme.id}.`);
  }
  return phase;
}

export type GrowthStageNutrition = {
  growthStage: NutritionGrowthStage;
  weightKg: number;
  programmeId: string;
  phase: NutritionPhase;
};

/**
 * Attaches the weight-selected nutrient specification to PigFlow's existing
 * growth stage. Stage and diet phase intentionally remain different concepts.
 */
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
