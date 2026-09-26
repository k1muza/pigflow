import {
  BRAZILIAN_2024_GESTATION_NUTRITION,
  BRAZILIAN_2024_HIGH_GILT_NUTRITION,
  BRAZILIAN_2024_HIGH_GROWTH_NUTRITION,
  BRAZILIAN_2024_LACTATION_NUTRITION,
  BRAZILIAN_2024_STANDARD_GILT_NUTRITION,
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
const HIGH_PERFORMANCE_PROGRAMME = BRAZILIAN_2024_HIGH_GROWTH_NUTRITION;

export const FEED_PROGRAMMES: readonly FeedProgrammeDefinition[] = [
  {
    id: "developing-gilt",
    name: "Developing Gilt",
    description:
      "Brazilian Tables 2024 standard-performance gilt requirements from Table 5.38.",
    status: "loaded",
    sourceProgramme: BRAZILIAN_2024_STANDARD_GILT_NUTRITION,
    phases: BRAZILIAN_2024_STANDARD_GILT_NUTRITION.phases,
  },
  {
    id: "gestating-gilt-sow",
    name: "Gestating Gilt & Sow",
    description:
      "Brazilian Tables 2024 breeder requirements by parity and gestation period from Table 6.08.",
    status: "loaded",
    sourceProgramme: BRAZILIAN_2024_GESTATION_NUTRITION,
    phases: BRAZILIAN_2024_GESTATION_NUTRITION.phases,
  },
  {
    id: "lactating-gilt-sow",
    name: "Lactating Gilt & Sow",
    description:
      "Brazilian Tables 2024 lactation requirements by parity and litter-weight gain from Table 6.15.",
    status: "loaded",
    sourceProgramme: BRAZILIAN_2024_LACTATION_NUTRITION,
    phases: BRAZILIAN_2024_LACTATION_NUTRITION.phases,
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
  {
    id: "developing-gilt-high-performance",
    name: "Developing Gilt — High Performance",
    description:
      "Brazilian Tables 2024 high-performance gilt requirements from Table 5.36.",
    status: "loaded",
    sourceProgramme: BRAZILIAN_2024_HIGH_GILT_NUTRITION,
    phases: BRAZILIAN_2024_HIGH_GILT_NUTRITION.phases,
  },
  {
    id: "nursery-pig-high-performance",
    name: "Nursery Pig — High Performance",
    description:
      "Brazilian Tables 2024 pre-starter and starter requirements paired with the high-performance mixed-sex programme.",
    status: "loaded",
    sourceProgramme: HIGH_PERFORMANCE_PROGRAMME,
    phases: HIGH_PERFORMANCE_PROGRAMME.phases.filter(isNurseryPhase),
  },
  {
    id: "grow-finish-pig-high-performance",
    name: "Grow-Finish Pig — High Performance",
    description:
      "Brazilian Tables 2024 high-performance mixed-sex grower and finisher requirements.",
    status: "loaded",
    sourceProgramme: HIGH_PERFORMANCE_PROGRAMME,
    phases: HIGH_PERFORMANCE_PROGRAMME.phases.filter(isGrowFinishPhase),
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
