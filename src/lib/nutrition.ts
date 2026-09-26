import {
  BRAZILIAN_2024_BREEDER_SWINE,
  BRAZILIAN_2024_GROWING_SWINE,
  BRAZILIAN_2024_SOURCE,
} from "./brazilian-nutrition";

export type NutritionGrowthStage = "weaner" | "grower" | "finisher";
export type NutritionVariant = "default";
export type GrowingPerformance = "standard" | "high";
export type NutritionPerformance = GrowingPerformance | "breeder";
export type GrowingPhaseClass = "pre-starter" | "starter" | "grower" | "finisher";
export type NutritionPhaseClass = GrowingPhaseClass | "gestation" | "lactation";
export type Range = { min: number; max: number };

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

export type SidAminoAcidConcentrations = {
  lysine: number;
  methionineCysteine: number;
  threonine: number;
  tryptophan: number;
  valine: number;
  isoleucine: number;
  leucine: number;
  histidine: number;
  phenylalanineTyrosine: number;
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
  calciumPct?: number;
  /** Brazilian Tables call this standardized digestible phosphorus (Dig. P). */
  sttdPhosphorusPct?: number;
  availablePhosphorusPct?: number;
};

export type PracticalDietConstraints = {
  soybeanMealMaxPct?: number;
  sidLysineToCrudeProteinMaxPct?: number;
  highlyDigestibleProteinPct?: Range;
  highlyDigestibleCarbohydratePct?: number;
  lLysineHclMaxPct?: number;
};

export type NutritionRequirements = {
  netEnergyKcalKg: number;
  metabolizableEnergyKcalKg: number;
  sidLysinePct: number;
  sidAminoAcidsPct: SidAminoAcidConcentrations;
  aminoAcids: AminoAcidRequirements;
  crudeProteinPct: number;
  digestibleProteinPct: number;
  potassiumPct: number;
  linoleicAcidPct?: number;
  minerals: MineralRequirements;
  /**
   * Chapter 7 of the Brazilian Tables publishes suggested supplementation,
   * not nutritional requirements. Keep these optional until those tables are
   * represented as supplementation guidance rather than requirement minima.
   */
  traceMinerals?: TraceMinerals;
  vitamins?: Vitamins;
  practical: PracticalDietConstraints;
};

export type NutritionPhase = {
  id: string;
  label: string;
  variant: NutritionVariant;
  phaseClass: NutritionPhaseClass;
  ageMinDays?: number;
  ageMaxDays?: number;
  periodLabel?: string;
  parity?: string;
  litterWeightGainKgDay?: number;
  femaleWeightLossKgDay?: number;
  dailyFeedIntakeKg?: number;
  dailyMetabolizableEnergyKcal?: number;
  sourceTable: string;
  sourcePage: number;
  sourceMinWeightKg: number;
  sourceMaxWeightKg: number;
  /** Display label for the source population/body-weight basis. */
  sourceWeightRange: string;
  lookupMinWeightKg: number;
  lookupMaxWeightKg: number;
  requirements: NutritionRequirements;
};

export type NutritionProgramme = {
  id: string;
  name: string;
  source: string;
  sourceVersion: string;
  sourceSections: readonly string[];
  performance: NutritionPerformance;
  phases: readonly NutritionPhase[];
};

type BrazilianProgramme = (typeof BRAZILIAN_2024_GROWING_SWINE.programmes)[number];
type BrazilianPhase = BrazilianProgramme["phases"][number];
type BrazilianBreederPhase =
  | (typeof BRAZILIAN_2024_BREEDER_SWINE.gestation.phases)[number]
  | (typeof BRAZILIAN_2024_BREEDER_SWINE.lactation.phases)[number];

const PRESTARTER_PROGRAMME_ID = "prestarter-high-genetic-potential";
const HIGH_PERFORMANCE_PROGRAMME_ID = "high-performance-mixed-sex";
const STANDARD_PERFORMANCE_PROGRAMME_ID = "standard-performance-mixed-sex";
const HIGH_PERFORMANCE_GILT_PROGRAMME_ID = "high-performance-gilts";
const STANDARD_PERFORMANCE_GILT_PROGRAMME_ID = "standard-performance-gilts";

function programmeById(id: string): BrazilianProgramme {
  const programme = BRAZILIAN_2024_GROWING_SWINE.programmes.find(
    (candidate) => candidate.id === id,
  );
  if (!programme) throw new Error(`Brazilian 2024 programme not found: ${id}.`);
  return programme;
}

function phaseRatioKey(
  phase: BrazilianPhase["phase"],
): keyof typeof BRAZILIAN_2024_GROWING_SWINE.aminoAcidRatios.phases {
  switch (phase) {
    case "pre-starter":
      return "preStarter";
    case "starter":
      return "starter";
    case "grower":
      return "grower";
    case "finisher":
      return "finisher";
  }
}

function requireBoundary(value: number | undefined, label: string): number {
  if (value === undefined) {
    throw new Error(`Brazilian 2024 phase is missing ${label}.`);
  }
  return value;
}

function normalizeBrazilianPhase(
  sourceProgramme: BrazilianProgramme,
  phase: BrazilianPhase,
  lookupMinWeightKg: number,
  lookupMaxWeightKg: number,
): NutritionPhase {
  const sourceMinWeightKg = requireBoundary(phase.weightKg.min, "minimum liveweight");
  const sourceMaxWeightKg = requireBoundary(phase.weightKg.max, "maximum liveweight");
  const ratios =
    BRAZILIAN_2024_GROWING_SWINE.aminoAcidRatios.phases[phaseRatioKey(phase.phase)].sid;
  const sid = phase.sidAminoAcidsPct;
  const nutrients = phase.nutrientsPct;

  return {
    id: `br2024-${sourceProgramme.sourceTable.replace(".", "-")}-${phase.id}`,
    label: `${phase.phase.replace("-", " ")}: ${sourceMinWeightKg}–${sourceMaxWeightKg} kg`,
    variant: "default",
    phaseClass: phase.phase,
    ageMinDays: phase.ageDays.min,
    ageMaxDays: phase.ageDays.max,
    periodLabel:
      phase.ageDays.min !== undefined && phase.ageDays.max !== undefined
        ? `Age ${phase.ageDays.min}–${phase.ageDays.max} days`
        : undefined,
    sourceTable: sourceProgramme.sourceTable,
    sourcePage: sourceProgramme.printedPage,
    sourceMinWeightKg,
    sourceMaxWeightKg,
    sourceWeightRange: `${sourceMinWeightKg}–${sourceMaxWeightKg} kg`,
    lookupMinWeightKg,
    lookupMaxWeightKg,
    requirements: {
      metabolizableEnergyKcalKg: phase.diet.metabolizableEnergyKcalKg,
      netEnergyKcalKg: phase.diet.netEnergyKcalKg,
      sidLysinePct: sid.lysine,
      sidAminoAcidsPct: {
        lysine: sid.lysine,
        methionineCysteine: sid.methionineCysteine,
        threonine: sid.threonine,
        tryptophan: sid.tryptophan,
        valine: sid.valine,
        isoleucine: sid.isoleucine,
        leucine: sid.leucine,
        histidine: sid.histidine,
        phenylalanineTyrosine: sid.phenylalanineTyrosine,
      },
      aminoAcids: {
        methionineCysteineToLysPct: ratios.methionineCysteine,
        threonineToLysPct: ratios.threonine,
        tryptophanToLysPct: ratios.tryptophan,
        valineToLysPct: ratios.valine,
        isoleucineToLysPct: ratios.isoleucine,
        leucineToLysPct: ratios.leucine,
        histidineToLysPct: ratios.histidine,
        phenylalanineTyrosineToLysPct: ratios.phenylalanineTyrosine,
      },
      crudeProteinPct: nutrients.crudeProtein,
      digestibleProteinPct: nutrients.digestibleProtein,
      potassiumPct: nutrients.potassium,
      linoleicAcidPct: nutrients.linoleicAcid,
      minerals: {
        calciumPct: nutrients.calcium,
        availablePhosphorusPct: nutrients.availablePhosphorus,
        sttdPhosphorusPct: nutrients.digestiblePhosphorus,
        sodiumPct: nutrients.sodium,
        chloridePct: nutrients.chloride,
      },
      practical: {},
    },
  };
}

function normalizeGrowingSourcePhases(
  sourcePhases: readonly BrazilianPhase[],
  sourceProgrammeFor: (index: number) => BrazilianProgramme,
): NutritionPhase[] {
  return sourcePhases.map((phase, index) => {
    const sourceMin = requireBoundary(phase.weightKg.min, "minimum liveweight");
    const sourceMax = requireBoundary(phase.weightKg.max, "maximum liveweight");
    const previous = sourcePhases[index - 1];
    const next = sourcePhases[index + 1];

    const lookupMin =
      index === 0
        ? sourceMin
        : Math.max(
            requireBoundary(previous!.weightKg.max, "previous maximum liveweight"),
            sourceMin,
          );
    const lookupMax =
      next === undefined
        ? sourceMax
        : Math.max(
            sourceMax,
            requireBoundary(next.weightKg.min, "next minimum liveweight"),
          );

    return normalizeBrazilianPhase(sourceProgrammeFor(index), phase, lookupMin, lookupMax);
  });
}

function buildGrowingProgramme(
  performance: GrowingPerformance,
  growthProgrammeId: string,
): NutritionProgramme {
  const prestarter = programmeById(PRESTARTER_PROGRAMME_ID);
  const growth = programmeById(growthProgrammeId);
  const sourcePhases = [...prestarter.phases, ...growth.phases];

  const phases = normalizeGrowingSourcePhases(
    sourcePhases,
    (index) => (index < prestarter.phases.length ? prestarter : growth),
  );

  // Preserve the original operational behaviour below the first published
  // pre-starter liveweight: the first lookup phase starts at 0 kg.
  phases[0] = { ...phases[0], lookupMinWeightKg: 0 };

  return {
    id: `brazilian-2024-growing-swine-${performance}-performance-mixed-sex`,
    name: `Brazilian Tables 2024 — ${performance === "high" ? "High" : "Standard"} performance mixed-sex pigs`,
    source: BRAZILIAN_2024_SOURCE.title,
    sourceVersion: `5th edition (${BRAZILIAN_2024_SOURCE.year})`,
    sourceSections: [
      "Chapter 5 — Nutritional Requirements of Growing Swine",
      `Table ${prestarter.sourceTable}`,
      `Table ${growth.sourceTable}`,
      `Table ${BRAZILIAN_2024_GROWING_SWINE.aminoAcidRatios.sourceTable}`,
    ],
    performance,
    phases,
  };
}

function buildGiltProgramme(
  performance: GrowingPerformance,
  sourceProgrammeId: string,
): NutritionProgramme {
  const sourceProgramme = programmeById(sourceProgrammeId);
  const phases = normalizeGrowingSourcePhases(
    sourceProgramme.phases,
    () => sourceProgramme,
  );

  return {
    id: `brazilian-2024-growing-gilts-${performance}-performance`,
    name: `Brazilian Tables 2024 — ${performance === "high" ? "High" : "Standard"} performance gilts`,
    source: BRAZILIAN_2024_SOURCE.title,
    sourceVersion: `5th edition (${BRAZILIAN_2024_SOURCE.year})`,
    sourceSections: [
      "Chapter 5 — Nutritional Requirements of Growing Swine",
      `Table ${sourceProgramme.sourceTable}`,
      `Table ${BRAZILIAN_2024_GROWING_SWINE.aminoAcidRatios.sourceTable}`,
    ],
    performance,
    phases,
  };
}

function breederRatios(
  phase: BrazilianBreederPhase,
): (typeof BRAZILIAN_2024_BREEDER_SWINE.lactation.aminoAcidRatios.sid) {
  if (phase.stage === "lactation") {
    return BRAZILIAN_2024_BREEDER_SWINE.lactation.aminoAcidRatios.sid;
  }
  const gestationDays = phase.gestationDays;
  if (!gestationDays?.max) {
    throw new Error(`Gestation phase ${phase.id} is missing its day range.`);
  }
  return gestationDays.max <= 85
    ? BRAZILIAN_2024_BREEDER_SWINE.gestation.aminoAcidRatios.phases.early.sid
    : BRAZILIAN_2024_BREEDER_SWINE.gestation.aminoAcidRatios.phases.late.sid;
}

function normalizeBreederPhase(
  sourceTable: string,
  phase: BrazilianBreederPhase,
): NutritionPhase {
  const sid = phase.sidAminoAcidsPct;
  const nutrients = phase.nutrientsPct;
  const ratios = breederRatios(phase);
  const isGestation = phase.stage === "gestation";
  const bodyWeightKg = isGestation
    ? phase.averageBodyWeightKg
    : phase.femaleWeightPostpartumKg;

  if (bodyWeightKg === undefined) {
    throw new Error(`Breeder phase ${phase.id} is missing its body-weight basis.`);
  }

  const label = isGestation
    ? `${phase.parity} · gestation days ${phase.gestationDays?.min}–${phase.gestationDays?.max}`
    : `${phase.parity} · litter gain ${phase.litterWeightGainKgDay} kg/day`;

  return {
    id: `br2024-${sourceTable.replace(".", "-")}-${phase.id}`,
    label,
    variant: "default",
    phaseClass: phase.stage,
    periodLabel: isGestation
      ? `Gestation days ${phase.gestationDays?.min}–${phase.gestationDays?.max}`
      : `Litter weight gain ${phase.litterWeightGainKgDay} kg/day`,
    parity: phase.parity,
    litterWeightGainKgDay: phase.litterWeightGainKgDay,
    femaleWeightLossKgDay: phase.femaleWeightLossKgDay,
    dailyFeedIntakeKg: phase.daily.feedIntakeKgDay,
    dailyMetabolizableEnergyKcal: phase.daily.metabolizableEnergyKcal,
    sourceTable,
    sourcePage: phase.sourcePage,
    sourceMinWeightKg: bodyWeightKg,
    sourceMaxWeightKg: bodyWeightKg,
    sourceWeightRange: isGestation
      ? `${bodyWeightKg} kg average body weight`
      : `${bodyWeightKg} kg postpartum body weight`,
    lookupMinWeightKg: bodyWeightKg,
    lookupMaxWeightKg: bodyWeightKg,
    requirements: {
      metabolizableEnergyKcalKg: phase.diet.metabolizableEnergyKcalKg,
      netEnergyKcalKg: phase.diet.netEnergyKcalKg,
      sidLysinePct: sid.lysine,
      sidAminoAcidsPct: {
        lysine: sid.lysine,
        methionineCysteine: sid.methionineCysteine,
        threonine: sid.threonine,
        tryptophan: sid.tryptophan,
        valine: sid.valine,
        isoleucine: sid.isoleucine,
        leucine: sid.leucine,
        histidine: sid.histidine,
        phenylalanineTyrosine: sid.phenylalanineTyrosine,
      },
      aminoAcids: {
        methionineCysteineToLysPct: ratios.methionineCysteine,
        threonineToLysPct: ratios.threonine,
        tryptophanToLysPct: ratios.tryptophan,
        valineToLysPct: ratios.valine,
        isoleucineToLysPct: ratios.isoleucine,
        leucineToLysPct: ratios.leucine,
        histidineToLysPct: ratios.histidine,
        phenylalanineTyrosineToLysPct: ratios.phenylalanineTyrosine,
      },
      crudeProteinPct: nutrients.crudeProtein,
      digestibleProteinPct: nutrients.digestibleProtein,
      potassiumPct: nutrients.potassium,
      minerals: {
        calciumPct: nutrients.calcium,
        availablePhosphorusPct: nutrients.availablePhosphorus,
        sttdPhosphorusPct: nutrients.digestiblePhosphorus,
        sodiumPct: nutrients.sodium,
        chloridePct: nutrients.chloride,
      },
      practical: {},
    },
  };
}

function buildBreederProgramme(stage: "gestation" | "lactation"): NutritionProgramme {
  const source =
    stage === "gestation"
      ? BRAZILIAN_2024_BREEDER_SWINE.gestation
      : BRAZILIAN_2024_BREEDER_SWINE.lactation;
  const ratioTable =
    stage === "gestation"
      ? BRAZILIAN_2024_BREEDER_SWINE.gestation.aminoAcidRatios.sourceTable
      : BRAZILIAN_2024_BREEDER_SWINE.lactation.aminoAcidRatios.sourceTable;

  return {
    id: `brazilian-2024-breeder-${stage}`,
    name:
      stage === "gestation"
        ? "Brazilian Tables 2024 — Gestating gilts and sows"
        : "Brazilian Tables 2024 — Lactating gilts and sows",
    source: BRAZILIAN_2024_SOURCE.title,
    sourceVersion: `5th edition (${BRAZILIAN_2024_SOURCE.year})`,
    sourceSections: [
      "Chapter 6 — Nutritional Requirements of Swine Breeders",
      `Table ${source.sourceTable}`,
      `Table ${ratioTable}`,
    ],
    performance: "breeder",
    phases: source.phases.map((phase) => normalizeBreederPhase(source.sourceTable, phase)),
  };
}

export const BRAZILIAN_2024_STANDARD_GROWTH_NUTRITION = buildGrowingProgramme(
  "standard",
  STANDARD_PERFORMANCE_PROGRAMME_ID,
);

export const BRAZILIAN_2024_HIGH_GROWTH_NUTRITION = buildGrowingProgramme(
  "high",
  HIGH_PERFORMANCE_PROGRAMME_ID,
);

export const BRAZILIAN_2024_STANDARD_GILT_NUTRITION = buildGiltProgramme(
  "standard",
  STANDARD_PERFORMANCE_GILT_PROGRAMME_ID,
);

export const BRAZILIAN_2024_HIGH_GILT_NUTRITION = buildGiltProgramme(
  "high",
  HIGH_PERFORMANCE_GILT_PROGRAMME_ID,
);

export const BRAZILIAN_2024_GESTATION_NUTRITION = buildBreederProgramme("gestation");
export const BRAZILIAN_2024_LACTATION_NUTRITION = buildBreederProgramme("lactation");

/**
 * Until PigFlow exposes a project-level performance-programme selector, the
 * standard-performance mixed-sex table is the default. Callers can pass the
 * high-performance programme explicitly.
 */
export const DEFAULT_GROWTH_NUTRITION_PROGRAMME =
  BRAZILIAN_2024_STANDARD_GROWTH_NUTRITION;

export function nutritionPhasesAtSourceWeight(
  weightKg: number,
  programme: NutritionProgramme = DEFAULT_GROWTH_NUTRITION_PROGRAMME,
): readonly NutritionPhase[] {
  assertWeight(weightKg);
  return programme.phases.filter(
    ({ sourceMinWeightKg, sourceMaxWeightKg }) =>
      weightKg >= sourceMinWeightKg && weightKg <= sourceMaxWeightKg,
  );
}

export function nutritionPhaseAtWeight(
  weightKg: number,
  programme: NutritionProgramme = DEFAULT_GROWTH_NUTRITION_PROGRAMME,
): NutritionPhase {
  assertWeight(weightKg);
  const phase = programme.phases.find(
    ({ lookupMinWeightKg, lookupMaxWeightKg }, index) =>
      weightKg >= lookupMinWeightKg &&
      (weightKg < lookupMaxWeightKg ||
        (index === programme.phases.length - 1 && weightKg <= lookupMaxWeightKg)),
  );
  if (!phase) {
    throw new Error(
      `No Brazilian 2024 nutrition phase covers ${weightKg} kg in ${programme.id}.`,
    );
  }
  return phase;
}

export function nutritionPhaseForVariant(
  weightKg: number,
  variant: NutritionVariant,
  programme: NutritionProgramme = DEFAULT_GROWTH_NUTRITION_PROGRAMME,
): NutritionPhase {
  if (variant !== "default") {
    throw new Error(`Unsupported nutrition variant: ${variant}.`);
  }
  return nutritionPhaseAtWeight(weightKg, programme);
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
