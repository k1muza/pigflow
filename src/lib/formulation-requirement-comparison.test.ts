import { describe, expect, it } from "vitest";

import type { FeedFormulation } from "./feed-formulations";
import { feedProgrammeById } from "./feed-programmes";
import { compareFormulationToPhase } from "./formulation-requirement-comparison";

const TEST_FORMULATION: FeedFormulation = {
  id: "comparison-fixture",
  name: "Comparison fixture",
  description: "Synthetic formulation used only for requirement comparison tests.",
  ingredients: [
    { ingredientId: "corn-yellow-dent", sourceName: "Corn", inclusionPct: 65 },
    {
      ingredientId: "soybean-meal-dehulled-solvent-extracted",
      sourceName: "Soybean meal",
      inclusionPct: 32,
    },
    { ingredientId: "corn-oil", sourceName: "Corn oil", inclusionPct: 3 },
  ],
  featured: false,
};

describe("formulation requirement comparison", () => {
  it("uses direct Brazilian requirement concentrations", () => {
    const phase = feedProgrammeById("grow-finish-pig")?.phases[0];
    expect(phase?.sourceTable).toBe("5.43");

    const result = compareFormulationToPhase(TEST_FORMULATION, phase!);
    const lysine = result.rows.find((row) => row.id === "sid-lysine");

    expect(lysine?.requirement).toBe("≥ 1.038 %");
    expect(result.rows.find((row) => row.id === "energy-basis")).toBeUndefined();
    expect(result.profileBasis).toMatch(/calculated from ingredient library/i);
  });

  it("uses the published Brazilian pre-starter energy target", () => {
    const phase = feedProgrammeById("nursery-pig")?.phases[2];
    expect(phase?.sourceTable).toBe("5.32");
    expect(phase?.sourceWeightRange).toBe("8.4–17.9 kg");

    const result = compareFormulationToPhase(TEST_FORMULATION, phase!);
    expect(result.rows.find((row) => row.id === "energy-me")?.requirement).toBe(
      "≥ 3400 kcal/kg",
    );
  });

  it("does not present Chapter 7 supplementation guidance as Chapter 5 requirements", () => {
    const phase = feedProgrammeById("grow-finish-pig")?.phases[0];
    const result = compareFormulationToPhase(TEST_FORMULATION, phase!);

    expect(result.rows.find((row) => row.id === "zinc")).toBeUndefined();
    expect(result.rows.find((row) => row.id === "vitamin-a")).toBeUndefined();
  });
});
