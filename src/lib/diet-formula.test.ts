import { describe, expect, it } from "vitest";

import { nutritionPhaseAtWeight } from "./nutrition";
import { analyzeDiet, evaluateDietForPhase } from "./diet-formula";

describe("diet formula analysis", () => {
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

  it("calculates energy, digestible amino acids and formula cost from inclusion", () => {
    const result = analyzeDiet(simple, [
      { ingredientId: "corn-yellow-dent", pricePerKg: 0.3 },
      { ingredientId: "soybean-meal-dehulled-solvent-extracted", pricePerKg: 0.6 },
      { ingredientId: "dicalcium-phosphate", pricePerKg: 0.8 },
      { ingredientId: "limestone-ground", pricePerKg: 0.15 },
      { ingredientId: "sodium-chloride", pricePerKg: 0.12 },
      { ingredientId: "l-lysine-hcl", pricePerKg: 2.2 },
    ]);

    expect(result.energy.metabolizableKcalKg).toBeGreaterThan(3000);
    expect(result.sidAminoAcidsPct.lysine).toBeGreaterThan(0.9);
    expect(result.minerals.sttdPhosphorusPct).toBeGreaterThan(0);
    expect(result.costPerKg).toBeCloseTo(0.3902, 4);
    expect(result.missingPriceIngredientIds).toEqual([]);
  });

  it("reports a missing local price instead of silently treating it as free", () => {
    const result = analyzeDiet(simple);
    expect(result.costPerKg).toBeUndefined();
    expect(result.missingPriceIngredientIds).toHaveLength(simple.ingredients.length);
  });

  it("evaluates a formula against PIC requirements at its actual energy density", () => {
    const result = evaluateDietForPhase(
      simple,
      nutritionPhaseAtWeight(30),
      "ME",
    );

    expect(result.energyKcalKg).toBeGreaterThan(3000);
    expect(result.checks.find((check) => check.id === "sid-lysine")).toBeDefined();
    expect(result.checks.find((check) => check.id === "sttd-phosphorus")).toBeDefined();
    expect(result.checks.find((check) => check.id === "calcium-phosphorus-ratio")).toBeDefined();
  });

  it("rejects a formula that is not a complete 100% ration", () => {
    expect(() =>
      analyzeDiet({
        ingredients: [{ ingredientId: "corn-yellow-dent", inclusionPct: 99 }],
      }),
    ).toThrow(/sum to 100/);
  });
});
