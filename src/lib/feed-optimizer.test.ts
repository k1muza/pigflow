import { describe, expect, it } from "vitest";

import {
  INGREDIENT_LIBRARY,
  loadIngredientLibrary,
  type IngredientLibrary,
  type IngredientNutrientRecord,
} from "./ingredient-nutrients";
import { formulateLeastCostDiet } from "./feed-optimizer";
import { nutritionPhaseAtWeight } from "./nutrition";

function ingredient(
  id: string,
  name: string,
  crudeProteinPct: number,
  priceMarker = 0,
): IngredientNutrientRecord {
  const phase = nutritionPhaseAtWeight(30);
  const r = phase.requirements;
  const sid = r.sidAminoAcidsPct;

  return {
    id,
    name,
    aliases: [],
    category: "other",
    composition: {
      dryMatterPct: 90,
      crudeProteinPct,
      crudeFatPct: 5 + priceMarker,
    },
    energy: {
      digestibleKcalKg: 3800,
      metabolizableKcalKg: r.metabolizableEnergyKcalKg + 250,
      netKcalKg: r.netEnergyKcalKg + 250,
    },
    aminoAcids: {
      totalPct: {},
      sidDigestibilityPct: {},
      sidPct: {
        lysine: sid.lysine * 2,
        methionine: sid.methionineCysteine,
        cysteine: sid.methionineCysteine,
        threonine: sid.threonine * 2,
        tryptophan: sid.tryptophan * 2,
        valine: sid.valine * 2,
        isoleucine: sid.isoleucine * 2,
        leucine: sid.leucine * 2,
        histidine: sid.histidine * 2,
        phenylalanine: sid.phenylalanineTyrosine,
        tyrosine: sid.phenylalanineTyrosine,
      },
    },
    macroMinerals: {
      calciumPct: (r.minerals.calciumPct ?? 0.5) * 2,
      totalPhosphorusPct: 1,
      availablePhosphorusPct: (r.minerals.availablePhosphorusPct ?? 0.3) * 2,
      sttdPhosphorusPct: (r.minerals.sttdPhosphorusPct ?? 0.3) * 2,
      sodiumPct: r.minerals.sodiumPct * 2,
      chloridePct: (r.minerals.chloridePct ?? 0.2) * 2,
      potassiumPct: r.potassiumPct * 2,
    },
    traceMineralsPpm: {},
    vitamins: {},
    constraints: { notes: [] },
    provenance: { notes: [], nutrientSources: {} },
  };
}

function testLibrary(
  cheapProtein: number,
  expensiveProtein: number,
): IngredientLibrary {
  return loadIngredientLibrary({
    ...INGREDIENT_LIBRARY,
    ingredients: [
      ingredient("cheap", "Cheap energy ingredient", cheapProtein),
      ingredient("protein", "Protein ingredient", expensiveProtein, 1),
    ],
  });
}

describe("least-cost feed optimizer", () => {
  it("minimizes ingredient cost while keeping Brazilian requirements hard", async () => {
    const phase = nutritionPhaseAtWeight(30);
    const target = phase.requirements.crudeProteinPct;
    const library = testLibrary(target - 4, target + 16);

    const result = await formulateLeastCostDiet(
      phase,
      "ME",
      [
        { ingredientId: "cheap", pricePerKg: 0.2 },
        { ingredientId: "protein", pricePerKg: 0.6 },
      ],
      library,
    );

    expect(result.status).toBe("optimal");
    if (result.status !== "optimal") return;

    const protein = result.solution.formula.ingredients.find(
      (row) => row.ingredientId === "protein",
    );
    expect(protein?.inclusionPct).toBeCloseTo(20, 4);
    expect(result.solution.analysis.crudeProteinPct.value).toBeCloseTo(target, 5);
    expect(result.solution.costPerKg).toBeCloseTo(0.28, 5);
  });

  it("does not silently substitute zero for missing nutrient composition", async () => {
    const phase = nutritionPhaseAtWeight(30);
    const target = phase.requirements.crudeProteinPct;
    const library = testLibrary(target, target + 10);
    const cheap = library.ingredients[0];

    const withMissingTryptophan = loadIngredientLibrary({
      ...library,
      ingredients: [
        {
          ...cheap,
          aminoAcids: {
            ...cheap.aminoAcids,
            sidPct: Object.fromEntries(
              Object.entries(cheap.aminoAcids.sidPct).filter(
                ([key]) => key !== "tryptophan",
              ),
            ),
          },
        },
        library.ingredients[1],
      ],
    });

    const result = await formulateLeastCostDiet(
      phase,
      "ME",
      [
        { ingredientId: "cheap", pricePerKg: 0.2 },
        { ingredientId: "protein", pricePerKg: 0.6 },
      ],
      withMissingTryptophan,
    );

    expect(result.status).toBe("missing-data");
    if (result.status !== "missing-data") return;
    expect(result.missingData).toContainEqual({
      ingredientId: "cheap",
      nutrientIds: expect.arrayContaining(["sid-tryptophan"]),
    });
  });

  it("returns a diagnostic diet when hard requirements are infeasible", async () => {
    const phase = nutritionPhaseAtWeight(30);
    const target = phase.requirements.crudeProteinPct;
    const library = testLibrary(target - 8, target - 4);

    const result = await formulateLeastCostDiet(
      phase,
      "ME",
      [
        { ingredientId: "cheap", pricePerKg: 0.2 },
        { ingredientId: "protein", pricePerKg: 0.6 },
      ],
      library,
    );

    expect(result.status).toBe("infeasible");
    if (result.status !== "infeasible") return;

    const proteinGap = result.diagnostics.find(
      (diagnostic) => diagnostic.constraintId === "crude-protein",
    );
    expect(proteinGap?.shortfall).toBeGreaterThan(0);
    expect(result.bestEffort).toBeDefined();
  });

  it("respects ingredient inclusion bounds", async () => {
    const phase = nutritionPhaseAtWeight(30);
    const target = phase.requirements.crudeProteinPct;
    const library = testLibrary(target - 4, target + 16);

    const result = await formulateLeastCostDiet(
      phase,
      "ME",
      [
        { ingredientId: "cheap", pricePerKg: 0.2, maxInclusionPct: 70 },
        { ingredientId: "protein", pricePerKg: 0.6 },
      ],
      library,
    );

    expect(result.status).toBe("optimal");
    if (result.status !== "optimal") return;

    const protein = result.solution.formula.ingredients.find(
      (row) => row.ingredientId === "protein",
    );
    expect(protein?.inclusionPct).toBeCloseTo(30, 4);
  });
});
