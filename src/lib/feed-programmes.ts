import {
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

const DEFAULT_PROGRAMME = BRAZILIAN_2024_STANDARD_GROWTH_NUTRITION;

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
    description:
      "Brazilian Tables 2024 pre-starter and starter requirements for high-genetic-potential pigs.",
    status: "loaded",
    sourceProgramme: DEFAULT_PROGRAMME,
    phases: DEFAULT_PROGRAMME.phases.filter(isNurseryPhase),
  },
  {
    id: "grow-finish-pig",
    name: "Grow-Finish Pig",
    description:
      "Brazilian Tables 2024 standard-performance mixed-sex grower and finisher requirements.",
    status: "loaded",
    sourceProgramme: DEFAULT_PROGRAMME,
    phases: DEFAULT_PROGRAMME.phases.filter(isGrowFinishPhase),
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
