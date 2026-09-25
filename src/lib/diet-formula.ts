import {
  INGREDIENT_LIBRARY,
  sidAminoAcidPct,
  sttdPhosphorusPctOf,
  type IngredientLibrary,
  type IngredientNutrientRecord,
} from "./ingredient-nutrients";
import { resolveNutritionTargets, type EnergySystem } from "./nutrition-targets";
import type { NutritionPhase } from "./nutrition";

export type DietIngredient = {
  ingredientId: string;
  inclusionPct: number;
};

export type IngredientPrice = {
  ingredientId: string;
  pricePerKg: number;
};

export type DietFormula = {
  ingredients: readonly DietIngredient[];
};

export type DietAnalysis = {
  inclusionPct: number;
  energy: {
    digestibleKcalKg: number;
    metabolizableKcalKg: number;
    netKcalKg: number;
  };
  crudeProteinPct: number;
  sidAminoAcidsPct: {
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
  minerals: {
    calciumPct: number;
    totalPhosphorusPct: number;
    sttdPhosphorusPct: number;
    sodiumPct: number;
    chloridePct: number;
  };
  soybeanMealPct: number;
  lLysineHclPct: number;
  costPerKg?: number;
  missingPriceIngredientIds: string[];
};

export type DietConstraintCheck = {
  id: string;
  label: string;
  actual: number;
  bound: number | { min: number; max: number };
  relation: "min" | "max" | "range";
  passes: boolean;
  unit: "%" | "ratio";
};

export type DietPhaseEvaluation = {
  phaseId: string;
  energySystem: EnergySystem;
  energyKcalKg: number;
  analysis: DietAnalysis;
  checks: DietConstraintCheck[];
  passes: boolean;
  unsupportedConstraints: string[];
};

export function analyzeDiet(
  formula: DietFormula,
  prices: readonly IngredientPrice[] = [],
  library: IngredientLibrary = INGREDIENT_LIBRARY,
): DietAnalysis {
  const total = formula.ingredients.reduce((sum, row) => sum + row.inclusionPct, 0);
  if (!Number.isFinite(total) || Math.abs(total - 100) > 1e-6) {
    throw new Error(`Diet inclusions must sum to 100%; received ${total}.`);
  }

  const priceById = new Map(prices.map((price) => [price.ingredientId, price.pricePerKg]));
  const missingPriceIngredientIds: string[] = [];
  let costPerKg = 0;

  const result: DietAnalysis = {
    inclusionPct: total,
    energy: { digestibleKcalKg: 0, metabolizableKcalKg: 0, netKcalKg: 0 },
    crudeProteinPct: 0,
    sidAminoAcidsPct: {
      lysine: 0,
      methionineCysteine: 0,
      threonine: 0,
      tryptophan: 0,
      valine: 0,
      isoleucine: 0,
      leucine: 0,
      histidine: 0,
      phenylalanineTyrosine: 0,
    },
    minerals: {
      calciumPct: 0,
      totalPhosphorusPct: 0,
      sttdPhosphorusPct: 0,
      sodiumPct: 0,
      chloridePct: 0,
    },
    soybeanMealPct: 0,
    lLysineHclPct: 0,
    missingPriceIngredientIds,
  };

  for (const row of formula.ingredients) {
    if (!Number.isFinite(row.inclusionPct) || row.inclusionPct < 0 || row.inclusionPct > 100) {
      throw new Error(`Invalid inclusion for ${row.ingredientId}: ${row.inclusionPct}%.`);
    }
    const ingredient = library.ingredients.find((candidate) => candidate.id === row.ingredientId);
    if (!ingredient) throw new Error(`Unknown ingredient: ${row.ingredientId}.`);

    const share = row.inclusionPct / 100;
    result.energy.digestibleKcalKg += share * (ingredient.energy.digestibleKcalKg ?? 0);
    result.energy.metabolizableKcalKg += share * (ingredient.energy.metabolizableKcalKg ?? 0);
    result.energy.netKcalKg += share * (ingredient.energy.netKcalKg ?? 0);
    result.crudeProteinPct += share * (ingredient.composition.crudeProteinPct ?? 0);

    result.sidAminoAcidsPct.lysine += share * sid(ingredient, "lysine");
    result.sidAminoAcidsPct.methionineCysteine +=
      share * (sid(ingredient, "methionine") + sid(ingredient, "cysteine"));
    result.sidAminoAcidsPct.threonine += share * sid(ingredient, "threonine");
    result.sidAminoAcidsPct.tryptophan += share * sid(ingredient, "tryptophan");
    result.sidAminoAcidsPct.valine += share * sid(ingredient, "valine");
    result.sidAminoAcidsPct.isoleucine += share * sid(ingredient, "isoleucine");
    result.sidAminoAcidsPct.leucine += share * sid(ingredient, "leucine");
    result.sidAminoAcidsPct.histidine += share * sid(ingredient, "histidine");
    result.sidAminoAcidsPct.phenylalanineTyrosine +=
      share * (sid(ingredient, "phenylalanine") + sid(ingredient, "tyrosine"));

    result.minerals.calciumPct += share * (ingredient.macroMinerals.calciumPct ?? 0);
    result.minerals.totalPhosphorusPct +=
      share * (ingredient.macroMinerals.totalPhosphorusPct ?? 0);
    result.minerals.sttdPhosphorusPct += share * (sttdPhosphorusPctOf(ingredient) ?? 0);
    result.minerals.sodiumPct += share * (ingredient.macroMinerals.sodiumPct ?? 0);
    result.minerals.chloridePct += share * (ingredient.macroMinerals.chloridePct ?? 0);

    if (ingredient.id.startsWith("soybean-meal-")) result.soybeanMealPct += row.inclusionPct;
    if (ingredient.id === "l-lysine-hcl") result.lLysineHclPct += row.inclusionPct;

    const price = priceById.get(row.ingredientId);
    if (price === undefined) {
      missingPriceIngredientIds.push(row.ingredientId);
    } else {
      if (!Number.isFinite(price) || price < 0) {
        throw new Error(`Invalid price for ${row.ingredientId}: ${price}.`);
      }
      costPerKg += share * price;
    }
  }

  if (missingPriceIngredientIds.length === 0) result.costPerKg = costPerKg;
  return result;
}

export function evaluateDietForPhase(
  formula: DietFormula,
  phase: NutritionPhase,
  energySystem: EnergySystem,
  prices: readonly IngredientPrice[] = [],
  library: IngredientLibrary = INGREDIENT_LIBRARY,
): DietPhaseEvaluation {
  const analysis = analyzeDiet(formula, prices, library);
  const energyKcalKg =
    energySystem === "ME"
      ? analysis.energy.metabolizableKcalKg
      : analysis.energy.netKcalKg;

  if (energyKcalKg <= 0) {
    throw new Error(`Diet has no ${energySystem} value to resolve PIC targets.`);
  }

  const targets = resolveNutritionTargets(phase, { system: energySystem, kcalKg: energyKcalKg });
  const checks: DietConstraintCheck[] = [];
  const min = (id: string, label: string, actual: number, bound: number) =>
    checks.push({ id, label, actual, bound, relation: "min", passes: actual >= bound, unit: "%" });
  const max = (id: string, label: string, actual: number, bound: number) =>
    checks.push({ id, label, actual, bound, relation: "max", passes: actual <= bound, unit: "%" });
  const range = (
    id: string,
    label: string,
    actual: number,
    bound: { min: number; max: number },
    unit: "%" | "ratio" = "%",
  ) =>
    checks.push({
      id,
      label,
      actual,
      bound,
      relation: "range",
      passes: actual >= bound.min && actual <= bound.max,
      unit,
    });

  const aa = targets.aminoAcids;
  min("sid-lysine", "SID lysine", analysis.sidAminoAcidsPct.lysine, aa.sidLysinePct);
  min(
    "sid-met-cys",
    "SID methionine + cysteine",
    analysis.sidAminoAcidsPct.methionineCysteine,
    aa.sidMethionineCysteinePct,
  );
  min("sid-threonine", "SID threonine", analysis.sidAminoAcidsPct.threonine, aa.sidThreoninePct);
  min("sid-tryptophan", "SID tryptophan", analysis.sidAminoAcidsPct.tryptophan, aa.sidTryptophanPct);
  min("sid-valine", "SID valine", analysis.sidAminoAcidsPct.valine, aa.sidValinePct);
  min("sid-isoleucine", "SID isoleucine", analysis.sidAminoAcidsPct.isoleucine, aa.sidIsoleucinePct);
  min("sid-leucine", "SID leucine", analysis.sidAminoAcidsPct.leucine, aa.sidLeucinePct);
  min("sid-histidine", "SID histidine", analysis.sidAminoAcidsPct.histidine, aa.sidHistidinePct);
  min(
    "sid-phe-tyr",
    "SID phenylalanine + tyrosine",
    analysis.sidAminoAcidsPct.phenylalanineTyrosine,
    aa.sidPhenylalanineTyrosinePct,
  );

  if (targets.minerals.calciumPct !== undefined) {
    min("calcium", "Calcium", analysis.minerals.calciumPct, targets.minerals.calciumPct);
  }
  if (targets.minerals.sttdPhosphorusPct !== undefined) {
    min(
      "sttd-phosphorus",
      "STTD phosphorus",
      analysis.minerals.sttdPhosphorusPct,
      targets.minerals.sttdPhosphorusPct,
    );
  }
  min("sodium", "Sodium", analysis.minerals.sodiumPct, targets.minerals.sodiumPct);

  if (targets.minerals.chloridePct !== undefined) {
    min("chloride", "Chloride", analysis.minerals.chloridePct, targets.minerals.chloridePct);
  }
  if (targets.minerals.chloridePctRange) {
    range(
      "chloride",
      "Chloride",
      analysis.minerals.chloridePct,
      targets.minerals.chloridePctRange,
    );
  }

  const practical = phase.requirements.practical;
  if (practical.crudeProteinMinPct !== undefined) {
    min("crude-protein", "Crude protein", analysis.crudeProteinPct, practical.crudeProteinMinPct);
  }
  if (practical.soybeanMealMaxPct !== undefined) {
    max(
      "soybean-meal",
      "Soybean meal inclusion",
      analysis.soybeanMealPct,
      practical.soybeanMealMaxPct,
    );
  }
  if (practical.lLysineHclMaxPct !== undefined) {
    max(
      "l-lysine-hcl",
      "L-lysine HCl inclusion",
      analysis.lLysineHclPct,
      practical.lLysineHclMaxPct,
    );
  }
  if (practical.sidLysineToCrudeProteinMaxPct !== undefined && analysis.crudeProteinPct > 0) {
    max(
      "sid-lysine-cp",
      "SID lysine : crude protein",
      (analysis.sidAminoAcidsPct.lysine / analysis.crudeProteinPct) * 100,
      practical.sidLysineToCrudeProteinMaxPct,
    );
  }

  if (
    targets.minerals.analyzedCalciumToPhosphorus &&
    analysis.minerals.totalPhosphorusPct > 0
  ) {
    range(
      "calcium-phosphorus-ratio",
      "Analyzed calcium : phosphorus",
      analysis.minerals.calciumPct / analysis.minerals.totalPhosphorusPct,
      targets.minerals.analyzedCalciumToPhosphorus,
      "ratio",
    );
  }

  const unsupportedConstraints: string[] = [];
  if (practical.highlyDigestibleProteinPct) unsupportedConstraints.push("highlyDigestibleProteinPct");
  if (practical.highlyDigestibleCarbohydratePct !== undefined) {
    unsupportedConstraints.push("highlyDigestibleCarbohydratePct");
  }

  return {
    phaseId: phase.id,
    energySystem,
    energyKcalKg,
    analysis,
    checks,
    passes: checks.every((check) => check.passes) && unsupportedConstraints.length === 0,
    unsupportedConstraints,
  };
}

function sid(ingredient: IngredientNutrientRecord, aminoAcid: string): number {
  return sidAminoAcidPct(ingredient, aminoAcid) ?? 0;
}
