import {
  BRAZILIAN_2024_HIGH_GROWTH_NUTRITION,
  BRAZILIAN_2024_STANDARD_GROWTH_NUTRITION,
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
  return phase.phaseClass === "pre-starter" || phase.phaseClass === "starter";
}

function isGrowFinishPhase(phase: NutritionPhase): boolean {
  return phase.phaseClass === "grower" || phase.phaseClass === "finisher";
}

function loadedProgramme(
  id: string,
  name: string,
  description: string,
  sourceProgramme: NutritionProgramme,
  predicate: (phase: NutritionPhase) => boolean,
): FeedProgrammeDefinition {
  return {
    id,
    name,
    description,
    status: "loaded",
    sourceProgramme,
    phases: sourceProgramme.phases.filter(predicate),
  };
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
  loadedProgramme(
    "nursery-pig",
    "Nursery Pig — Standard performance",
    "Brazilian Tables 2024 pre-starter and starter requirements for standard-performance mixed-sex pigs with high genetic potential.",
    BRAZILIAN_2024_STANDARD_GROWTH_NUTRITION,
    isNurseryPhase,
  ),
  loadedProgramme(
    "grow-finish-pig",
    "Grow-Finish Pig — Standard performance",
    "Brazilian Tables 2024 grower and finisher requirements for standard-performance mixed-sex pigs with high genetic potential.",
    BRAZILIAN_2024_STANDARD_GROWTH_NUTRITION,
    isGrowFinishPhase,
  ),
  loadedProgramme(
    "nursery-pig-high-performance",
    "Nursery Pig — High performance",
    "Brazilian Tables 2024 pre-starter and starter requirements for high-performance mixed-sex pigs with high genetic potential.",
    BRAZILIAN_2024_HIGH_GROWTH_NUTRITION,
    isNurseryPhase,
  ),
  loadedProgramme(
    "grow-finish-pig-high-performance",
    "Grow-Finish Pig — High performance",
    "Brazilian Tables 2024 grower and finisher requirements for high-performance mixed-sex pigs with high genetic potential.",
    BRAZILIAN_2024_HIGH_GROWTH_NUTRITION,
    isGrowFinishPhase,
  ),
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
