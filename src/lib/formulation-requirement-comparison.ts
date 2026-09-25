import { evaluateDietForPhase, type DietConstraintCheck } from "./diet-formula";
import { analyzeFeedFormulation } from "./formulation-analysis";
import type { FeedFormulation } from "./feed-formulations";
import type { NutritionPhase } from "./nutrition";

export type FormulationComparisonStatus = "pass" | "fail" | "incomplete";

export type FormulationRequirementComparisonRow = {
  id: string;
  label: string;
  actual?: string;
  requirement?: string;
  relation: "min" | "max" | "range";
  status: FormulationComparisonStatus;
  note?: string;
};

export type FormulationRequirementComparison = {
  phaseId: string;
  profileBasis: string;
  status: FormulationComparisonStatus;
  rows: readonly FormulationRequirementComparisonRow[];
  quantifiedCount: number;
  incompleteCount: number;
};

function formatNumber(value: number): string {
  return Number(value.toFixed(4)).toString();
}

function formatActual(check: DietConstraintCheck): string | undefined {
  if (check.actual !== null) return `${formatNumber(check.actual)} ${check.unit}`;
  if (check.knownSubtotal !== undefined && check.knownSubtotal > 0) {
    return `known ≥ ${formatNumber(check.knownSubtotal)} ${check.unit}`;
  }
  return undefined;
}

function formatRequirement(check: DietConstraintCheck): string {
  if (typeof check.bound === "number") {
    const operator = check.relation === "max" ? "≤" : "≥";
    return `${operator} ${formatNumber(check.bound)} ${check.unit}`;
  }

  return `${formatNumber(check.bound.min)}–${formatNumber(check.bound.max)} ${check.unit}`;
}

function comparisonNote(check: DietConstraintCheck): string | undefined {
  if (check.status !== "incomplete") return undefined;
  if (check.missingIngredientIds.length === 0) {
    return "The current ingredient dataset does not provide enough information to calculate this check.";
  }
  return `Missing nutrient values for: ${check.missingIngredientIds.join(", ")}.`;
}

/**
 * Compare a formulation against one PIC phase using PigFlow's calculated
 * ingredient-weighted nutrient profile. PIC contributes requirement ratios and
 * limits only; no source-reported formulation output values are used here.
 */
export function compareFormulationToPhase(
  formulation: FeedFormulation,
  phase: NutritionPhase,
): FormulationRequirementComparison {
  const calculated = analyzeFeedFormulation(formulation);
  const evaluation = evaluateDietForPhase(calculated.formula, phase, "ME");

  const rows = evaluation.checks.map(
    (check): FormulationRequirementComparisonRow => ({
      id: check.id,
      label: check.label,
      actual: formatActual(check),
      requirement: formatRequirement(check),
      relation: check.relation,
      status: check.status,
      note: comparisonNote(check),
    }),
  );

  for (const unsupported of evaluation.unsupportedConstraints) {
    rows.push({
      id: `unsupported-${unsupported}`,
      label:
        unsupported === "highlyDigestibleProteinPct"
          ? "Highly digestible protein"
          : unsupported === "highlyDigestibleCarbohydratePct"
            ? "Highly digestible carbohydrate"
            : unsupported,
      relation: "min",
      status: "incomplete",
      note: "This practical PIC constraint is not yet calculable from the ingredient nutrient schema.",
    });
  }

  const incompleteCount = rows.filter((row) => row.status === "incomplete").length;
  const quantifiedCount = rows.filter(
    (row) => row.status === "pass" || row.status === "fail",
  ).length;

  return {
    phaseId: phase.id,
    profileBasis: "Calculated from ingredient library · ME basis",
    status:
      evaluation.status === "valid"
        ? "pass"
        : evaluation.status === "invalid"
          ? "fail"
          : "incomplete",
    rows,
    quantifiedCount,
    incompleteCount,
  };
}
