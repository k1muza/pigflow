import type { FeedFormulation } from "./feed-formulations";
import type { NutritionPhase } from "./nutrition";
import { resolveNutritionTargets } from "./nutrition-targets";

export type FormulationComparisonStatus = "pass" | "fail" | "incomplete" | "not_applicable";

export type FormulationRequirementComparisonRow = {
  id: string;
  label: string;
  actual?: string;
  requirement?: string;
  relation?: "min" | "max" | "target" | "range";
  status: FormulationComparisonStatus;
  note?: string;
};

export type FormulationRequirementComparison = {
  phaseId: string;
  profileBasis: string;
  status: "pass" | "fail" | "incomplete";
  rows: readonly FormulationRequirementComparisonRow[];
  quantifiedCount: number;
  incompleteCount: number;
};

function ingredientInclusion(
  formulation: FeedFormulation,
  predicate: (ingredientId: string) => boolean,
): number {
  return formulation.ingredients.reduce(
    (sum, row) => sum + (predicate(row.ingredientId) ? row.inclusionPct : 0),
    0,
  );
}

function fmtPct(value: number): string {
  return `${Number(value.toFixed(4))}%`;
}

function compareMin(
  id: string,
  label: string,
  actual: number,
  minimum: number,
  note?: string,
): FormulationRequirementComparisonRow {
  return {
    id,
    label,
    actual: fmtPct(actual),
    requirement: `≥ ${fmtPct(minimum)}`,
    relation: "min",
    status: actual >= minimum ? "pass" : "fail",
    note,
  };
}

function compareMax(
  id: string,
  label: string,
  actual: number,
  maximum: number,
  note?: string,
): FormulationRequirementComparisonRow {
  return {
    id,
    label,
    actual: fmtPct(actual),
    requirement: `≤ ${fmtPct(maximum)}`,
    relation: "max",
    status: actual <= maximum ? "pass" : "fail",
    note,
  };
}

function incomplete(
  id: string,
  label: string,
  requirement: string,
  note: string,
): FormulationRequirementComparisonRow {
  return {
    id,
    label,
    requirement,
    status: "incomplete",
    note,
  };
}

/**
 * Compare a source-published formulation profile with one PIC requirement phase.
 *
 * This intentionally uses only values explicitly reported for the formulation
 * plus exact ingredient inclusion rates. It does not recompute a complete
 * nutrient profile from mixed ingredient databases.
 */
export function compareFormulationToPhase(
  formulation: FeedFormulation,
  phase: NutritionPhase,
): FormulationRequirementComparison {
  const profile =
    formulation.nutrientProfiles.find((candidate) =>
      candidate.basis.toLowerCase().includes(formulation.ingredientDatabase.toLowerCase()),
    ) ?? formulation.nutrientProfiles[0];

  if (!profile) {
    return {
      phaseId: phase.id,
      profileBasis: "unknown",
      status: "incomplete",
      rows: [],
      quantifiedCount: 0,
      incompleteCount: 0,
    };
  }

  const meTargets = resolveNutritionTargets(phase, {
    system: "ME",
    kcalKg: profile.metabolizableEnergyKcalKg,
  });
  const neTargets = resolveNutritionTargets(phase, {
    system: "NE",
    kcalKg: profile.netEnergyKcalKg,
  });

  const rows: FormulationRequirementComparisonRow[] = [];

  if (phase.requirements.metabolizableEnergyKcalKg !== undefined) {
    const target = phase.requirements.metabolizableEnergyKcalKg;
    rows.push({
      id: "me",
      label: "Metabolizable energy",
      actual: `${profile.metabolizableEnergyKcalKg.toLocaleString()} kcal/kg`,
      requirement: `${target.toLocaleString()} kcal/kg`,
      relation: "target",
      status: profile.metabolizableEnergyKcalKg >= target ? "pass" : "fail",
      note: "PIC publishes a dietary energy level for this phase.",
    });
  }

  if (phase.requirements.netEnergyKcalKg !== undefined) {
    const target = phase.requirements.netEnergyKcalKg;
    rows.push({
      id: "ne",
      label: "Net energy",
      actual: `${profile.netEnergyKcalKg.toLocaleString()} kcal/kg`,
      requirement: `${target.toLocaleString()} kcal/kg`,
      relation: "target",
      status: profile.netEnergyKcalKg >= target ? "pass" : "fail",
      note: "PIC publishes a dietary energy level for this phase.",
    });
  }

  rows.push(
    compareMin(
      "sid-lys-me",
      "SID lysine — ME basis",
      profile.sidLysinePct,
      meTargets.aminoAcids.sidLysinePct,
      "Requirement resolved from this formulation's reported ME.",
    ),
  );

  rows.push(
    compareMin(
      "sid-lys-ne",
      "SID lysine — NE basis",
      profile.sidLysinePct,
      neTargets.aminoAcids.sidLysinePct,
      "Requirement resolved from this formulation's reported NE.",
    ),
  );

  const soybeanMealPct = ingredientInclusion(formulation, (id) =>
    id.startsWith("soybean-meal-"),
  );
  if (phase.requirements.practical.soybeanMealMaxPct !== undefined) {
    rows.push(
      compareMax(
        "soybean-meal",
        "Soybean meal inclusion",
        soybeanMealPct,
        phase.requirements.practical.soybeanMealMaxPct,
      ),
    );
  }

  const lLysineHclPct = ingredientInclusion(
    formulation,
    (id) => id === "l-lysine-hcl",
  );
  if (phase.requirements.practical.lLysineHclMaxPct !== undefined) {
    rows.push(
      compareMax(
        "l-lysine-hcl",
        "L-Lysine HCl inclusion",
        lLysineHclPct,
        phase.requirements.practical.lLysineHclMaxPct,
        "PIC describes this as a suggested maximum for corn-soybean meal-based diets.",
      ),
    );
  }

  const aaRequirements: Array<[string, string, number]> = [
    ["sid-met-cys", "SID methionine + cysteine", meTargets.aminoAcids.sidMethionineCysteinePct],
    ["sid-threonine", "SID threonine", meTargets.aminoAcids.sidThreoninePct],
    ["sid-tryptophan", "SID tryptophan", meTargets.aminoAcids.sidTryptophanPct],
    ["sid-valine", "SID valine", meTargets.aminoAcids.sidValinePct],
    ["sid-isoleucine", "SID isoleucine", meTargets.aminoAcids.sidIsoleucinePct],
    ["sid-leucine", "SID leucine", meTargets.aminoAcids.sidLeucinePct],
    ["sid-histidine", "SID histidine", meTargets.aminoAcids.sidHistidinePct],
    [
      "sid-phe-tyr",
      "SID phenylalanine + tyrosine",
      meTargets.aminoAcids.sidPhenylalanineTyrosinePct,
    ],
  ];

  for (const [id, label, minimum] of aaRequirements) {
    rows.push(
      incomplete(
        id,
        label,
        `≥ ${fmtPct(minimum)}`,
        "PIC Tables B1/B2 do not report this nutrient in the resulting profile.",
      ),
    );
  }

  if (meTargets.minerals.sttdPhosphorusPct !== undefined) {
    rows.push(
      incomplete(
        "sttd-phosphorus",
        "STTD phosphorus",
        `≥ ${fmtPct(meTargets.minerals.sttdPhosphorusPct)}`,
        "PIC Tables B1/B2 do not report STTD phosphorus for the example diet.",
      ),
    );
  }

  if (meTargets.minerals.availablePhosphorusPct !== undefined) {
    rows.push(
      incomplete(
        "available-phosphorus",
        "Available phosphorus",
        `≥ ${fmtPct(meTargets.minerals.availablePhosphorusPct)}`,
        "PIC Tables B1/B2 do not report available phosphorus for the example diet.",
      ),
    );
  }

  if (meTargets.minerals.calciumPct !== undefined) {
    rows.push(
      incomplete(
        "calcium",
        "Calcium",
        `≥ ${fmtPct(meTargets.minerals.calciumPct)}`,
        "PIC Tables B1/B2 do not report analyzed calcium for the example diet.",
      ),
    );
  }

  rows.push(
    incomplete(
      "sodium",
      "Sodium",
      `≥ ${fmtPct(meTargets.minerals.sodiumPct)}`,
      "PIC Tables B1/B2 do not report sodium for the example diet.",
    ),
  );

  if (meTargets.minerals.chloridePct !== undefined) {
    rows.push(
      incomplete(
        "chloride",
        "Chloride",
        `≥ ${fmtPct(meTargets.minerals.chloridePct)}`,
        "PIC Tables B1/B2 do not report chloride for the example diet.",
      ),
    );
  } else if (meTargets.minerals.chloridePctRange) {
    rows.push(
      incomplete(
        "chloride",
        "Chloride",
        `${fmtPct(meTargets.minerals.chloridePctRange.min)}–${fmtPct(
          meTargets.minerals.chloridePctRange.max,
        )}`,
        "PIC Tables B1/B2 do not report chloride for the example diet.",
      ),
    );
  }

  const anyFail = rows.some((row) => row.status === "fail");
  const incompleteCount = rows.filter((row) => row.status === "incomplete").length;
  const quantifiedCount = rows.filter(
    (row) => row.status === "pass" || row.status === "fail",
  ).length;

  return {
    phaseId: phase.id,
    profileBasis: profile.basis,
    status: anyFail ? "fail" : incompleteCount > 0 ? "incomplete" : "pass",
    rows,
    quantifiedCount,
    incompleteCount,
  };
}
