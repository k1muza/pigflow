import type { NutritionPhase } from "./nutrition";

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
};

export type ResolvedNutritionTargets = {
  phaseId: string;
  energy: DietEnergy;
  crudeProteinPct: number;
  digestibleProteinPct: number;
  potassiumPct: number;
  linoleicAcidPct?: number;
  aminoAcids: ResolvedAminoAcidTargets;
  minerals: ResolvedMineralTargets;
};

/**
 * Normalize one Brazilian Tables phase into the target shape consumed by the
 * formulation evaluator.
 *
 * Chapter 5 publishes diet energy and SID amino-acid concentrations directly,
 * so no PIC-style nutrient-per-Mcal conversion is performed here.
 */
export function resolveNutritionTargets(
  phase: NutritionPhase,
  energy?: DietEnergy,
): ResolvedNutritionTargets {
  const publishedEnergy: DietEnergy =
    energy ?? {
      system: "ME",
      kcalKg: phase.requirements.metabolizableEnergyKcalKg,
    };
  assertEnergy(publishedEnergy);

  const sid = phase.requirements.sidAminoAcidsPct;

  return {
    phaseId: phase.id,
    energy: publishedEnergy,
    crudeProteinPct: phase.requirements.crudeProteinPct,
    digestibleProteinPct: phase.requirements.digestibleProteinPct,
    potassiumPct: phase.requirements.potassiumPct,
    linoleicAcidPct: phase.requirements.linoleicAcidPct,
    aminoAcids: {
      sidLysinePct: sid.lysine,
      sidMethionineCysteinePct: sid.methionineCysteine,
      sidThreoninePct: sid.threonine,
      sidTryptophanPct: sid.tryptophan,
      sidValinePct: sid.valine,
      sidIsoleucinePct: sid.isoleucine,
      sidLeucinePct: sid.leucine,
      sidHistidinePct: sid.histidine,
      sidPhenylalanineTyrosinePct: sid.phenylalanineTyrosine,
    },
    minerals: {
      calciumPct: phase.requirements.minerals.calciumPct,
      sttdPhosphorusPct: phase.requirements.minerals.sttdPhosphorusPct,
      availablePhosphorusPct: phase.requirements.minerals.availablePhosphorusPct,
      sodiumPct: phase.requirements.minerals.sodiumPct,
      chloridePct: phase.requirements.minerals.chloridePct,
    },
  };
}

function assertEnergy(energy: DietEnergy): void {
  if (!Number.isFinite(energy.kcalKg) || energy.kcalKg <= 0) {
    throw new Error("Diet energy must be a positive finite number.");
  }
}
