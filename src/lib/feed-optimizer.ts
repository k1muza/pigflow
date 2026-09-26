import type { GLPK } from "glpk.js";

import {
  analyzeDiet,
  type AnalyzedNutrient,
  type DietAnalysis,
  type DietFormula,
  type IngredientPrice,
} from "./diet-formula";
import {
  INGREDIENT_LIBRARY,
  type IngredientLibrary,
} from "./ingredient-nutrients";
import { resolveNutritionTargets, type EnergySystem } from "./nutrition-targets";
import type { NutritionPhase } from "./nutrition";

export type FormulationIngredientOption = {
  ingredientId: string;
  pricePerKg: number;
  minInclusionPct?: number;
  maxInclusionPct?: number;
};

export type FormulationUnsupportedRequirement =
  | "digestible-protein"
  | "available-phosphorus"
  | "potassium"
  | "linoleic-acid";

export type FormulationMissingData = {
  ingredientId: string;
  nutrientIds: string[];
};

export type FormulationDiagnostic = {
  constraintId: string;
  label: string;
  unit: string;
  relation: "min" | "max";
  bound: number;
  actual: number;
  shortfall: number;
  excess: number;
};

export type FormulationSolution = {
  formula: DietFormula;
  costPerKg: number;
  analysis: DietAnalysis;
};

export type LeastCostFormulationResult =
  | {
      status: "optimal";
      solution: FormulationSolution;
      unsupportedRequirements: FormulationUnsupportedRequirement[];
    }
  | {
      status: "missing-data";
      missingData: FormulationMissingData[];
      unsupportedRequirements: FormulationUnsupportedRequirement[];
      message: string;
    }
  | {
      status: "infeasible";
      diagnostics: FormulationDiagnostic[];
      bestEffort?: FormulationSolution;
      unsupportedRequirements: FormulationUnsupportedRequirement[];
      message: string;
    }
  | {
      status: "error";
      unsupportedRequirements: FormulationUnsupportedRequirement[];
      message: string;
    };

type ConstraintSpec = {
  id: string;
  label: string;
  unit: string;
  relation: "min" | "max";
  bound: number;
  measure: (analysis: DietAnalysis) => AnalyzedNutrient;
};

type PreparedIngredient = {
  option: FormulationIngredientOption;
  variable: string;
  minFraction: number;
  maxFraction: number;
  coefficients: Map<string, number>;
};

const UNSUPPORTED_REQUIREMENTS: FormulationUnsupportedRequirement[] = [
  // The current checked-in ingredient matrix does not expose these on the same
  // basis required for a hard LP constraint. Keep them explicit rather than
  // silently treating them as zero.
  "digestible-protein",
  "available-phosphorus",
  "potassium",
  "linoleic-acid",
];

/**
 * Least-cost formulation against Brazilian Tables requirements.
 *
 * Primary mode is deliberately strict: modeled nutrient constraints are hard
 * constraints. If no exact formulation exists, a second diagnostic LP adds
 * deviation variables and minimizes relative nutrient shortfall/excess so the
 * caller can explain what prevents feasibility.
 */
export async function formulateLeastCostDiet(
  phase: NutritionPhase,
  energySystem: EnergySystem,
  options: readonly FormulationIngredientOption[],
  library: IngredientLibrary = INGREDIENT_LIBRARY,
): Promise<LeastCostFormulationResult> {
  const unsupportedRequirements = [...UNSUPPORTED_REQUIREMENTS];

  if (options.length === 0) {
    return {
      status: "error",
      unsupportedRequirements,
      message: "At least one available ingredient is required.",
    };
  }

  try {
    validateOptions(options, library);

    const constraints = buildConstraintSpecs(phase, energySystem);
    const prepared = prepareIngredients(options, constraints, library);
    const missingData = collectMissingData(prepared, constraints);

    if (missingData.length > 0) {
      return {
        status: "missing-data",
        missingData,
        unsupportedRequirements,
        message:
          "Some selected ingredients are missing nutrient values required by the strict formulation model. PigFlow will not assume those values are zero.",
      };
    }

    const glpk = await loadGlpk();
    const strict = await solveStrict(glpk, prepared, constraints);

    if (strict.status === "optimal") {
      const solution = buildSolution(strict.vars, prepared, library);
      return {
        status: "optimal",
        solution,
        unsupportedRequirements,
      };
    }

    const diagnostic = await solveDiagnostic(glpk, prepared, constraints);
    if (diagnostic.status !== "optimal") {
      return {
        status: "infeasible",
        diagnostics: [],
        unsupportedRequirements,
        message:
          "No feasible diet was found within the ingredient bounds, and the diagnostic model could not produce a best-effort solution.",
      };
    }

    const bestEffort = buildSolution(diagnostic.vars, prepared, library);
    return {
      status: "infeasible",
      diagnostics: describeDiagnostics(bestEffort.analysis, constraints),
      bestEffort,
      unsupportedRequirements,
      message:
        "No exact least-cost diet satisfies all modeled hard constraints. The diagnostic diet minimizes relative nutrient deviations.",
    };
  } catch (error) {
    return {
      status: "error",
      unsupportedRequirements,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

function buildConstraintSpecs(
  phase: NutritionPhase,
  energySystem: EnergySystem,
): ConstraintSpec[] {
  const targets = resolveNutritionTargets(phase);
  const constraints: ConstraintSpec[] = [
    {
      id: `energy-${energySystem.toLowerCase()}`,
      label: energySystem === "ME" ? "Metabolizable energy" : "Net energy",
      unit: "kcal/kg",
      relation: "min",
      bound:
        energySystem === "ME"
          ? phase.requirements.metabolizableEnergyKcalKg
          : phase.requirements.netEnergyKcalKg,
      measure: (analysis) =>
        energySystem === "ME"
          ? analysis.energy.metabolizableKcalKg
          : analysis.energy.netKcalKg,
    },
    {
      id: "crude-protein",
      label: "Crude protein",
      unit: "%",
      relation: "min",
      bound: targets.crudeProteinPct,
      measure: (analysis) => analysis.crudeProteinPct,
    },
    {
      id: "sid-lysine",
      label: "SID lysine",
      unit: "%",
      relation: "min",
      bound: targets.aminoAcids.sidLysinePct,
      measure: (analysis) => analysis.sidAminoAcidsPct.lysine,
    },
    {
      id: "sid-met-cys",
      label: "SID methionine + cysteine",
      unit: "%",
      relation: "min",
      bound: targets.aminoAcids.sidMethionineCysteinePct,
      measure: (analysis) => analysis.sidAminoAcidsPct.methionineCysteine,
    },
    {
      id: "sid-threonine",
      label: "SID threonine",
      unit: "%",
      relation: "min",
      bound: targets.aminoAcids.sidThreoninePct,
      measure: (analysis) => analysis.sidAminoAcidsPct.threonine,
    },
    {
      id: "sid-tryptophan",
      label: "SID tryptophan",
      unit: "%",
      relation: "min",
      bound: targets.aminoAcids.sidTryptophanPct,
      measure: (analysis) => analysis.sidAminoAcidsPct.tryptophan,
    },
    {
      id: "sid-valine",
      label: "SID valine",
      unit: "%",
      relation: "min",
      bound: targets.aminoAcids.sidValinePct,
      measure: (analysis) => analysis.sidAminoAcidsPct.valine,
    },
    {
      id: "sid-isoleucine",
      label: "SID isoleucine",
      unit: "%",
      relation: "min",
      bound: targets.aminoAcids.sidIsoleucinePct,
      measure: (analysis) => analysis.sidAminoAcidsPct.isoleucine,
    },
    {
      id: "sid-leucine",
      label: "SID leucine",
      unit: "%",
      relation: "min",
      bound: targets.aminoAcids.sidLeucinePct,
      measure: (analysis) => analysis.sidAminoAcidsPct.leucine,
    },
    {
      id: "sid-histidine",
      label: "SID histidine",
      unit: "%",
      relation: "min",
      bound: targets.aminoAcids.sidHistidinePct,
      measure: (analysis) => analysis.sidAminoAcidsPct.histidine,
    },
    {
      id: "sid-phe-tyr",
      label: "SID phenylalanine + tyrosine",
      unit: "%",
      relation: "min",
      bound: targets.aminoAcids.sidPhenylalanineTyrosinePct,
      measure: (analysis) => analysis.sidAminoAcidsPct.phenylalanineTyrosine,
    },
    {
      id: "sodium",
      label: "Sodium",
      unit: "%",
      relation: "min",
      bound: targets.minerals.sodiumPct,
      measure: (analysis) => analysis.minerals.sodiumPct,
    },
  ];

  if (targets.minerals.calciumPct !== undefined) {
    constraints.push({
      id: "calcium",
      label: "Calcium",
      unit: "%",
      relation: "min",
      bound: targets.minerals.calciumPct,
      measure: (analysis) => analysis.minerals.calciumPct,
    });
  }

  if (targets.minerals.sttdPhosphorusPct !== undefined) {
    constraints.push({
      id: "sttd-phosphorus",
      label: "Standardized digestible phosphorus",
      unit: "%",
      relation: "min",
      bound: targets.minerals.sttdPhosphorusPct,
      measure: (analysis) => analysis.minerals.sttdPhosphorusPct,
    });
  }

  if (targets.minerals.chloridePct !== undefined) {
    constraints.push({
      id: "chloride",
      label: "Chloride",
      unit: "%",
      relation: "min",
      bound: targets.minerals.chloridePct,
      measure: (analysis) => analysis.minerals.chloridePct,
    });
  }

  return constraints;
}

function prepareIngredients(
  options: readonly FormulationIngredientOption[],
  constraints: readonly ConstraintSpec[],
  library: IngredientLibrary,
): PreparedIngredient[] {
  return options.map((option, index) => {
    const ingredient = library.ingredients.find(
      (candidate) => candidate.id === option.ingredientId,
    );
    if (!ingredient) {
      throw new Error(`Unknown ingredient: ${option.ingredientId}.`);
    }

    const sourceMin = ingredient.constraints.minInclusionPct ?? 0;
    const sourceMax = ingredient.constraints.maxInclusionPct ?? 100;
    const requestedMin = option.minInclusionPct ?? 0;
    const requestedMax = option.maxInclusionPct ?? 100;
    const minPct = Math.max(sourceMin, requestedMin);
    const maxPct = Math.min(sourceMax, requestedMax);

    if (minPct > maxPct) {
      throw new Error(
        `Ingredient ${ingredient.name} has incompatible inclusion bounds: minimum ${minPct}% exceeds maximum ${maxPct}%.`,
      );
    }

    const single = analyzeDiet(
      { ingredients: [{ ingredientId: option.ingredientId, inclusionPct: 100 }] },
      [],
      library,
    );

    const coefficients = new Map<string, number>();
    for (const constraint of constraints) {
      const measure = constraint.measure(single);
      if (measure.complete) {
        coefficients.set(constraint.id, measure.value);
      }
    }

    return {
      option,
      variable: `x_${index}`,
      minFraction: minPct / 100,
      maxFraction: maxPct / 100,
      coefficients,
    };
  });
}

function collectMissingData(
  ingredients: readonly PreparedIngredient[],
  constraints: readonly ConstraintSpec[],
): FormulationMissingData[] {
  return ingredients.flatMap((ingredient) => {
    const nutrientIds = constraints
      .filter((constraint) => !ingredient.coefficients.has(constraint.id))
      .map((constraint) => constraint.id);
    return nutrientIds.length > 0
      ? [{ ingredientId: ingredient.option.ingredientId, nutrientIds }]
      : [];
  });
}

async function solveStrict(
  glpk: GLPK,
  ingredients: readonly PreparedIngredient[],
  constraints: readonly ConstraintSpec[],
): Promise<{ status: "optimal"; vars: Record<string, number> } | { status: "infeasible" }> {
  const {
    GLP_DB,
    GLP_FX,
    GLP_LO,
    GLP_MIN,
    GLP_MSG_OFF,
    GLP_OPT,
  } = glpk;

  const lp = {
    name: "PigFlowLeastCostDiet",
    objective: {
      direction: GLP_MIN,
      name: "cost_per_kg",
      vars: ingredients.map((ingredient) => ({
        name: ingredient.variable,
        coef: ingredient.option.pricePerKg,
      })),
    },
    subjectTo: [
      {
        name: "total_inclusion",
        vars: ingredients.map((ingredient) => ({
          name: ingredient.variable,
          coef: 1,
        })),
        bnds: { type: GLP_FX, lb: 1, ub: 1 },
      },
      ...constraints.map((constraint) => ({
        name: `nutrient_${constraint.id}`,
        vars: ingredients.map((ingredient) => ({
          name: ingredient.variable,
          coef: ingredient.coefficients.get(constraint.id) ?? 0,
        })),
        bnds:
          constraint.relation === "min"
            ? { type: GLP_LO, lb: constraint.bound, ub: 0 }
            : { type: glpk.GLP_UP, lb: 0, ub: constraint.bound },
      })),
    ],
    bounds: ingredients.map((ingredient) => ({
      name: ingredient.variable,
      type:
        Math.abs(ingredient.minFraction - ingredient.maxFraction) <= 1e-12
          ? GLP_FX
          : GLP_DB,
      lb: ingredient.minFraction,
      ub: ingredient.maxFraction,
    })),
  };

  const result = await glpk.solve(lp, {
    msglev: GLP_MSG_OFF,
    presol: true,
  });

  if (result.result.status !== GLP_OPT) {
    return { status: "infeasible" };
  }

  return { status: "optimal", vars: result.result.vars };
}

async function solveDiagnostic(
  glpk: GLPK,
  ingredients: readonly PreparedIngredient[],
  constraints: readonly ConstraintSpec[],
): Promise<{ status: "optimal"; vars: Record<string, number> } | { status: "infeasible" }> {
  const {
    GLP_DB,
    GLP_FX,
    GLP_LO,
    GLP_MIN,
    GLP_MSG_OFF,
    GLP_OPT,
    GLP_UP,
  } = glpk;

  const deviationVars = constraints.map((constraint) => {
    const name = `deviation_${constraint.id}`;
    const scale = Math.max(Math.abs(constraint.bound), 1e-9);
    return { name, coef: 1 / scale };
  });

  const lp = {
    name: "PigFlowFormulationDiagnostic",
    objective: {
      direction: GLP_MIN,
      name: "relative_nutrient_deviation",
      vars: [
        ...deviationVars,
        // Resolve ties between equally deficient diets in favour of lower cost
        // without allowing cost to outweigh nutrient feasibility.
        ...ingredients.map((ingredient) => ({
          name: ingredient.variable,
          coef: ingredient.option.pricePerKg * 1e-9,
        })),
      ],
    },
    subjectTo: [
      {
        name: "total_inclusion",
        vars: ingredients.map((ingredient) => ({
          name: ingredient.variable,
          coef: 1,
        })),
        bnds: { type: GLP_FX, lb: 1, ub: 1 },
      },
      ...constraints.map((constraint) => ({
        name: `nutrient_${constraint.id}`,
        vars: [
          ...ingredients.map((ingredient) => ({
            name: ingredient.variable,
            coef: ingredient.coefficients.get(constraint.id) ?? 0,
          })),
          {
            name: `deviation_${constraint.id}`,
            coef: constraint.relation === "min" ? 1 : -1,
          },
        ],
        bnds:
          constraint.relation === "min"
            ? { type: GLP_LO, lb: constraint.bound, ub: 0 }
            : { type: GLP_UP, lb: 0, ub: constraint.bound },
      })),
    ],
    bounds: [
      ...ingredients.map((ingredient) => ({
        name: ingredient.variable,
        type:
          Math.abs(ingredient.minFraction - ingredient.maxFraction) <= 1e-12
            ? GLP_FX
            : GLP_DB,
        lb: ingredient.minFraction,
        ub: ingredient.maxFraction,
      })),
      ...constraints.map((constraint) => ({
        name: `deviation_${constraint.id}`,
        type: GLP_LO,
        lb: 0,
        ub: 0,
      })),
    ],
  };

  const result = await glpk.solve(lp, {
    msglev: GLP_MSG_OFF,
    presol: true,
  });

  if (result.result.status !== GLP_OPT) {
    return { status: "infeasible" };
  }

  return { status: "optimal", vars: result.result.vars };
}

function buildSolution(
  vars: Record<string, number>,
  ingredients: readonly PreparedIngredient[],
  library: IngredientLibrary,
): FormulationSolution {
  const rows = ingredients
    .map((ingredient) => ({
      ingredientId: ingredient.option.ingredientId,
      inclusionPct: Math.max(0, vars[ingredient.variable] ?? 0) * 100,
    }))
    .filter((row) => row.inclusionPct > 1e-7);

  // GLPK floating-point output can be microscopically off 100. Normalize once,
  // then let analyzeDiet independently recompute every modeled nutrient.
  const total = rows.reduce((sum, row) => sum + row.inclusionPct, 0);
  const formula: DietFormula = {
    ingredients: rows.map((row) => ({
      ...row,
      inclusionPct: (row.inclusionPct / total) * 100,
    })),
  };
  const prices: IngredientPrice[] = ingredients.map((ingredient) => ({
    ingredientId: ingredient.option.ingredientId,
    pricePerKg: ingredient.option.pricePerKg,
  }));
  const analysis = analyzeDiet(formula, prices, library);

  if (analysis.costPerKg === undefined) {
    throw new Error("Optimizer returned a diet with an unresolved ingredient price.");
  }

  return {
    formula,
    costPerKg: analysis.costPerKg,
    analysis,
  };
}

function describeDiagnostics(
  analysis: DietAnalysis,
  constraints: readonly ConstraintSpec[],
): FormulationDiagnostic[] {
  return constraints.flatMap((constraint) => {
    const measure = constraint.measure(analysis);
    if (!measure.complete) return [];

    const actual = measure.value;
    const shortfall =
      constraint.relation === "min"
        ? Math.max(0, constraint.bound - actual)
        : 0;
    const excess =
      constraint.relation === "max"
        ? Math.max(0, actual - constraint.bound)
        : 0;

    if (shortfall <= 1e-7 && excess <= 1e-7) return [];

    return [
      {
        constraintId: constraint.id,
        label: constraint.label,
        unit: constraint.unit,
        relation: constraint.relation,
        bound: constraint.bound,
        actual,
        shortfall,
        excess,
      },
    ];
  });
}

function validateOptions(
  options: readonly FormulationIngredientOption[],
  library: IngredientLibrary,
): void {
  const seen = new Set<string>();
  for (const option of options) {
    if (seen.has(option.ingredientId)) {
      throw new Error(`Duplicate ingredient option: ${option.ingredientId}.`);
    }
    seen.add(option.ingredientId);

    if (!library.ingredients.some((ingredient) => ingredient.id === option.ingredientId)) {
      throw new Error(`Unknown ingredient: ${option.ingredientId}.`);
    }
    if (!Number.isFinite(option.pricePerKg) || option.pricePerKg < 0) {
      throw new Error(
        `Ingredient ${option.ingredientId} must have a non-negative finite price per kg.`,
      );
    }
    for (const [label, value] of [
      ["minimum", option.minInclusionPct],
      ["maximum", option.maxInclusionPct],
    ] as const) {
      if (
        value !== undefined &&
        (!Number.isFinite(value) || value < 0 || value > 100)
      ) {
        throw new Error(
          `Ingredient ${option.ingredientId} has an invalid ${label} inclusion: ${value}%.`,
        );
      }
    }
  }
}

async function loadGlpk(): Promise<GLPK> {
  const module = await import("glpk.js");
  return module.default();
}
