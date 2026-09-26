import {
  PIC_GROWTH_NUTRITION_2021,
  type NutritionPhase,
  type NutritionProgramme,
} from "./nutrition";

export type FeedProgrammeStatus = "loaded" | "not_loaded";

export type FeedProgrammeDefinition = {
  id: string;
  name: string;
  description: string;
  status: FeedProgrammeStatus;
  sourceProgramme?: NutritionProgramme;
  phases: readonly NutritionPhase[];
};

function isNurseryPhase(phase: NutritionPhase): boolean {
  return phase.lookupMinWeightKg < 23;
}

function isGrowFinishPhase(phase: NutritionPhase): boolean {
  return phase.lookupMinWeightKg >= 23;
}

export const FEED_PROGRAMMES: readonly FeedProgrammeDefinition[] = [
  {
    id: "mature-boar",
    name: "Mature Boar",
    description: "Feeding and nutrient guidance for mature breeding boars.",
    status: "not_loaded",
    phases: [],
  },
  {
    id: "developing-gilt",
    name: "Developing Gilt",
    description: "Development feeding programme for replacement gilts before breeding.",
    status: "not_loaded",
    phases: [],
  },
  {
    id: "gestating-gilt-sow",
    name: "Gestating Gilt & Sow",
    description: "Gestation feeding and nutrient specifications for gilts and sows.",
    status: "not_loaded",
    phases: [],
  },
  {
    id: "lactating-gilt-sow",
    name: "Lactating Gilt & Sow",
    description: "Lactation feeding and nutrient specifications for gilts and sows.",
    status: "not_loaded",
    phases: [],
  },
  {
    id: "weaned-sow",
    name: "Weaned Sow",
    description: "Post-weaning feeding management before the next service.",
    status: "not_loaded",
    phases: [],
  },
  {
    id: "nursery-pig",
    name: "Nursery Pig",
    description: "Prestart and late-nursery nutrient specifications by liveweight.",
    status: "loaded",
    sourceProgramme: PIC_GROWTH_NUTRITION_2021,
    phases: PIC_GROWTH_NUTRITION_2021.phases.filter(isNurseryPhase),
  },
  {
    id: "grow-finish-pig",
    name: "Grow-Finish Pig",
    description: "Grow-finish nutrient specifications from 23 kg through market weight.",
    status: "loaded",
    sourceProgramme: PIC_GROWTH_NUTRITION_2021,
    phases: PIC_GROWTH_NUTRITION_2021.phases.filter(isGrowFinishPhase),
  },
];

export function feedProgrammeById(id: string): FeedProgrammeDefinition | undefined {
  return FEED_PROGRAMMES.find((programme) => programme.id === id);
}

export function feedProgrammePhaseById(
  programmeId: string,
  phaseId: string,
): NutritionPhase | undefined {
  return feedProgrammeById(programmeId)?.phases.find((phase) => phase.id === phaseId);
}
