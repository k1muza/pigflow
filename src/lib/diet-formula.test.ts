import { describe, expect, it } from "vitest";

import {
  INGREDIENT_LIBRARY,
  loadIngredientLibrary,
  type IngredientLibrary,
} from "./ingredient-nutrients";
import { nutritionPhaseAtWeight } from "./nutrition";
import { analyzeDiet, evaluateDietForPhase } from "./diet-formula";

const simple = {
  ingredients: [
    { ingredientId: "corn-yellow-dent", inclusionPct: 70 },
    { ingredientId: "soybean-meal-dehulled-solvent-extracted", inclusionPct: 27 },
    { ingredientId: "dicalcium-phosphate", inclusionPct: 1.5 },
    { ingredientId: "limestone-ground", inclusionPct: 0.8 },
    { ingredientId: "sodium-chloride", inclusionPct: 0.5 },
    { ingredientId: "l-lysine-hcl", inclusionPct: 0.2 },
  ],
} as const;

function completeLibrary(): IngredientLibrary {
  return loadIngredientLibrary({
    ...INGREDIENT_LIBRARY,
    ingredients: [
      {
        id: "complete-test-feed",
        name: "Complete Test Feed",
        aliases: [],
        category: "other",
        composition: {
          dryMatterPct: 90,
          crudeProteinPct: 25,
        },
        energy: {
          digestibleKcalKg: 3600,
          metabolizableKcalKg: 3395,
          netKcalKg: 2545,
        },
        aminoAcids: {
          totalPct: {},
          sidDigestibilityPct: {},
          sidPct: {
            lysine: 1.5,
            methionine: 0.5,
            cysteine: 0.5,
            threonine: 1.1,
            tryptophan: 0.4,
            valine: 1.2,
            isoleucine: 1,
            leucine: 1.8,
            histidine: 0.7,
            phenylalanine: 0.8,
            tyrosine: 0.8,
          },
        },
        macroMinerals: {
          calciumPct: 0.7,
          totalPhosphorusPct: 0.5,
          availablePhosphorusPct: 0.45,
          sttdPhosphorusPct: 0.5,
          sodiumPct: 0.4,
          chloridePct: 0.36,
        },
        traceMineralsPpm: {
          zinc: 150,
          iron: 150,
          manganese: 60,
          copper: 20,
          iodine: 0.8,
          selenium: 0.4,
        },
        vitamins: {
          vitaminAIuKg: 6000,
          vitaminDIuKg: 1800,
          vitaminEIuKg: 60,
          vitaminKMgKg: 4,
          niacinMgKg: 60,
          riboflavinMgKg: 10,
          pantothenicAcidMgKg: 30,
          vitaminB12McgKg: 45,
          totalCholineMgKg: 1500,
        },
        constraints: { notes: [] },
        provenance: { notes: [] },
      },
    ],
  });
}

describe("diet formula analysis", () => {
  it("calculates known nutrient subtotals and formula cost from inclusion", () => {
    const result = analyzeDiet(simple, [
      { ingredientId: "corn-yellow-dent", pricePerKg: 0.3 },
      { ingredientId: "soybean-meal-dehulled-solvent-extracted", pricePerKg: 0.6 },
      { ingredientId: "dicalcium-phosphate", pricePerKg: 0.8 },
      { ingredientId: "limestone-ground", pricePerKg: 0.15 },
      { ingredientId: "sodium-chloride", pricePerKg: 0.12 },
      { ingredientId: "l-lysine-hcl", pricePerKg: 2.2 },
    ]);

    expect(result.energy.metabolizableKcalKg.value).toBeGreaterThan(3000);
    expect(result.sidAminoAcidsPct.lysine.value).toBeGreaterThan(0.9);
    expect(result.minerals.sttdPhosphorusPct.value).toBeGreaterThan(0);
    expect(result.costPerKg).toBeCloseTo(0.3902, 4);
    expect(result.missingPriceIngredientIds).toEqual([]);
  });

  it("does not silently turn missing nutrient data into zero", () => {
    const result = analyzeDiet(simple);

    expect(result.energy.metabolizableKcalKg.complete).toBe(false);
    expect(result.energy.metabolizableKcalKg.missingIngredientIds).toContain(
      "l-lysine-hcl",
    );
    expect(result.vitamins.vitaminAIuKg.complete).toBe(false);
    expect(result.vitamins.vitaminAIuKg.value).toBe(0);
  });

  it("reports a missing local price instead of silently treating it as free", () => {
    const result = analyzeDiet(simple);
    expect(result.costPerKg).toBeUndefined();
    expect(result.missingPriceIngredientIds).toHaveLength(simple.ingredients.length);
  });

  it("marks evaluation incomplete when the energy basis or micronutrient data is missing", () => {
    const result = evaluateDietForPhase(
      simple,
      nutritionPhaseAtWeight(30),
      "ME",
    );

    expect(result.status).toBe("incomplete");
    expect(result.passes).toBe(false);
    expect(result.energyKcalKg).toBeNull();
    expect(result.checks.find((check) => check.id === "energy-basis")?.status).toBe(
      "incomplete",
    );
    expect(result.checks.find((check) => check.id === "vitamin-a")?.status).toBe(
      "incomplete",
    );
    expect(result.checks.find((check) => check.id === "iodine")?.status).toBe(
      "incomplete",
    );
  });

  it("checks prestarter published energy and available phosphorus directly", () => {
    const library = completeLibrary();
    const formula = {
      ingredients: [{ ingredientId: "complete-test-feed", inclusionPct: 100 }],
    };

    const result = evaluateDietForPhase(
      formula,
      nutritionPhaseAtWeight(10),
      "ME",
      [],
      library,
    );

    expect(result.checks.find((check) => check.id === "energy-me")).toMatchObject({
      actual: 3395,
      bound: 3395,
      status: "pass",
    });
    expect(
      result.checks.find((check) => check.id === "available-phosphorus"),
    ).toMatchObject({
      actual: 0.45,
      bound: 0.4,
      status: "pass",
    });
  });

  it("checks PIC trace-mineral and vitamin requirements instead of omitting them", () => {
    const library = completeLibrary();
    const formula = {
      ingredients: [{ ingredientId: "complete-test-feed", inclusionPct: 100 }],
    };

    const result = evaluateDietForPhase(
      formula,
      nutritionPhaseAtWeight(30),
      "ME",
      [],
      library,
    );

    expect(result.checks.find((check) => check.id === "zinc")?.status).toBe("pass");
    expect(result.checks.find((check) => check.id === "iodine")?.status).toBe("pass");
    expect(result.checks.find((check) => check.id === "vitamin-a")?.status).toBe(
      "pass",
    );
    expect(result.checks.find((check) => check.id === "vitamin-b12")?.status).toBe(
      "pass",
    );
  });

  it("can return valid when every required grow-finish nutrient is known and passes", () => {
    const library = completeLibrary();
    const formula = {
      ingredients: [{ ingredientId: "complete-test-feed", inclusionPct: 100 }],
    };

    const result = evaluateDietForPhase(
      formula,
      nutritionPhaseAtWeight(30),
      "ME",
      [],
      library,
    );

    expect(result.status).toBe("valid");
    expect(result.passes).toBe(true);
    expect(result.checks.every((check) => check.status === "pass")).toBe(true);
  });

  it("returns invalid, not incomplete, when complete data proves a requirement fails", () => {
    const base = completeLibrary();
    const lowLysine = loadIngredientLibrary({
      ...base,
      ingredients: [
        {
          ...base.ingredients[0],
          aminoAcids: {
            ...base.ingredients[0].aminoAcids,
            sidPct: {
              ...base.ingredients[0].aminoAcids.sidPct,
              lysine: 0.5,
            },
          },
        },
      ],
    });

    const result = evaluateDietForPhase(
      { ingredients: [{ ingredientId: "complete-test-feed", inclusionPct: 100 }] },
      nutritionPhaseAtWeight(30),
      "ME",
      [],
      lowLysine,
    );

    expect(result.status).toBe("invalid");
    expect(result.checks.find((check) => check.id === "sid-lysine")?.status).toBe(
      "fail",
    );
  });

  it("rejects a formula that is not a complete 100% ration", () => {
    expect(() =>
      analyzeDiet({
        ingredients: [{ ingredientId: "corn-yellow-dent", inclusionPct: 99 }],
      }),
    ).toThrow(/sum to 100/);
  });
});
