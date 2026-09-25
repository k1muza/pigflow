import type { NutritionPhase, Range } from "./nutrition";

export type EnergySystem = "ME" | "NE";

export type DietEnergy = {
  system: EnergySystem;
  kcalKg: number;
};

export type ResolvedAminoAcidTargets = {
  sidLysinePct: number;
  sidMethionineCysteinePct: number;
  sidThreoninePct: number;
  sidTryptophanPct: number;
  sidValinePct: number;
  sidIsoleucinePct: number;
  sidLeucinePct: number;
  sidHistidinePct: number;
  sidPhenylalanineTyrosinePct: number;
};

export type ResolvedMineralTargets = {
  calciumPct?: number;
  sttdPhosphorusPct?: number;
  availablePhosphorusPct?: number;
  sodiumPct: number;
  chloridePct?: number;
  chloridePctRange?: Range;
  analyzedCalciumToPhosphorus?: Range;
};

export type ResolvedNutritionTargets = {
  phaseId: string;
  energy: DietEnergy;
  aminoAcids: ResolvedAminoAcidTargets;
  minerals: ResolvedMineralTargets;
};

/**
 * Turn PIC's source representation into concentrations a formulation solver can
 * constrain against at a particular diet energy density.
 *
 * Prestart phases publish direct percentages. Later phases publish grams of
 * nutrient per Mcal, so the actual percentage depends on the candidate diet's
 * ME or NE density.
 */
export function resolveNutritionTargets(
  phase: NutritionPhase,
  energy?: DietEnergy,
): ResolvedNutritionTargets {
  const resolvedEnergy = energy ?? publishedEnergyOf(phase);
  assertEnergy(resolvedEnergy);

  const sidLysinePct =
    phase.requirements.sidLysinePct ??
    ratioToDietPct(
      nutrientRatioForEnergy(
        resolvedEnergy.system,
        phase.requirements.sidLysineGPerMcalME,
        phase.requirements.sidLysineGPerMcalNE,
        "SID lysine",
      ),
      resolvedEnergy.kcalKg,
    );

  const aa = phase.requirements.aminoAcids;
  const fraction = (ratioPct: number) => sidLysinePct * (ratioPct / 100);

  const minerals = phase.requirements.minerals;
  const sttdPhosphorusPct =
    minerals.sttdPhosphorusPct ??
    optionalRatioToDietPct(
      resolvedEnergy.system === "ME"
        ? minerals.sttdPhosphorusGPerMcalME
        : minerals.sttdPhosphorusGPerMcalNE,
      resolvedEnergy.kcalKg,
    );
  const availablePhosphorusPct =
    minerals.availablePhosphorusPct ??
    optionalRatioToDietPct(
      resolvedEnergy.system === "ME"
        ? minerals.availablePhosphorusGPerMcalME
        : minerals.availablePhosphorusGPerMcalNE,
      resolvedEnergy.kcalKg,
    );

  return {
    phaseId: phase.id,
    energy: resolvedEnergy,
    aminoAcids: {
      sidLysinePct,
      sidMethionineCysteinePct: fraction(aa.methionineCysteineToLysPct),
      sidThreoninePct: fraction(aa.threonineToLysPct),
      sidTryptophanPct: fraction(aa.tryptophanToLysPct),
      sidValinePct: fraction(aa.valineToLysPct),
      sidIsoleucinePct: fraction(aa.isoleucineToLysPct),
      sidLeucinePct: fraction(aa.leucineToLysPct),
      sidHistidinePct: fraction(aa.histidineToLysPct),
      sidPhenylalanineTyrosinePct: fraction(aa.phenylalanineTyrosineToLysPct),
    },
    minerals: {
      calciumPct: minerals.calciumPct,
      sttdPhosphorusPct,
      availablePhosphorusPct,
      sodiumPct: minerals.sodiumPct,
      chloridePct: minerals.chloridePct,
      chloridePctRange: minerals.chloridePctRange,
      analyzedCalciumToPhosphorus: minerals.analyzedCalciumToPhosphorus,
    },
  };
}

function publishedEnergyOf(phase: NutritionPhase): DietEnergy {
  if (phase.requirements.metabolizableEnergyKcalKg !== undefined) {
    return { system: "ME", kcalKg: phase.requirements.metabolizableEnergyKcalKg };
  }
  if (phase.requirements.netEnergyKcalKg !== undefined) {
    return { system: "NE", kcalKg: phase.requirements.netEnergyKcalKg };
  }
  throw new Error(
    `${phase.id} expresses nutrient requirements relative to energy; provide candidate-diet ME or NE.`,
  );
}

function nutrientRatioForEnergy(
  system: EnergySystem,
  me: number | undefined,
  ne: number | undefined,
  nutrient: string,
): number {
  const value = system === "ME" ? me : ne;
  if (value === undefined) {
    throw new Error(`${nutrient} has no ${system} ratio in this phase.`);
  }
  return value;
}

/**
 * g/Mcal × kcal/kg → g/kg, then g/kg ÷ 10 → percent of diet.
 * Algebraically: ratio × kcal/kg ÷ 10,000.
 */
export function ratioToDietPct(gPerMcal: number, kcalKg: number): number {
  if (!Number.isFinite(gPerMcal) || gPerMcal < 0) {
    throw new Error("Nutrient-to-energy ratio must be a non-negative finite number.");
  }
  if (!Number.isFinite(kcalKg) || kcalKg <= 0) {
    throw new Error("Diet energy must be a positive finite number.");
  }
  return (gPerMcal * kcalKg) / 10_000;
}

function optionalRatioToDietPct(
  gPerMcal: number | undefined,
  kcalKg: number,
): number | undefined {
  return gPerMcal === undefined ? undefined : ratioToDietPct(gPerMcal, kcalKg);
}

function assertEnergy(energy: DietEnergy): void {
  if (!Number.isFinite(energy.kcalKg) || energy.kcalKg <= 0) {
    throw new Error("Diet energy must be a positive finite number.");
  }
}
