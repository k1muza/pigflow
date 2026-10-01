import { describe, expect, it } from "vitest";

import {
  INGREDIENT_LIBRARY,
  ingredientLibraryWithCustomPremixes,
  loadIngredientLibrary,
  type IngredientLibrary,
  type IngredientNutrientRecord,
} from "./ingredient-nutrients";
import {
  formulateLeastCostDiet,
  suggestFormulationIngredients,
} from "./feed-optimizer";
import { nutritionPhaseAtWeight } from "./nutrition";
import {
  INGREDIENT_DEFAULT_PRICES,
  ingredientDefaultPricePerKg,
} from "./feed-ingredient-prices";

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
      digestibleProteinPct: r.digestibleProteinPct * 2,
      crudeFatPct: 5 + priceMarker,
      linoleicAcidPct: (r.linoleicAcidPct ?? 0.5) * 2,
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
  it("derives a feasible starter basket from the supplied ingredient library", async () => {
    const phase = nutritionPhaseAtWeight(30);
    const target = phase.requirements.crudeProteinPct;
    const library = testLibrary(target - 4, target + 16);

    const suggestion = await suggestFormulationIngredients(
      phase,
      "ME",
      library,
      (ingredientId) => (ingredientId === "cheap" ? 0.2 : 0.6),
    );

    expect(suggestion.status).toBe("suggested");
    if (suggestion.status !== "suggested") return;

    expect(suggestion.ingredientIds.length).toBeGreaterThan(0);
    expect(
      suggestion.ingredientIds.every((ingredientId) =>
        ["cheap", "protein"].includes(ingredientId),
      ),
    ).toBe(true);

    const validation = await formulateLeastCostDiet(
      phase,
      "ME",
      suggestion.ingredientIds.map((ingredientId) => ({
        ingredientId,
        pricePerKg: 1,
      })),
      library,
    );
    expect(validation.status).toBe("optimal");
  });

  it("retains complete priced alternatives even when the default-price optimum does not use them", async () => {
    const phase = nutritionPhaseAtWeight(30);
    const target = phase.requirements.crudeProteinPct;
    const base = testLibrary(target + 5, target + 10);
    const library = loadIngredientLibrary({
      ...base,
      ingredients: [
        ...base.ingredients,
        ingredient("corrective", "Alternative corrective", target + 8),
      ],
    });

    const suggestion = await suggestFormulationIngredients(
      phase,
      "ME",
      library,
      (ingredientId) =>
        ingredientId === "cheap"
          ? 0.2
          : ingredientId === "protein"
            ? 0.6
            : 10,
    );

    expect(suggestion.status).toBe("suggested");
    if (suggestion.status !== "suggested") return;

    expect(suggestion.ingredientIds).toEqual(
      expect.arrayContaining(["cheap", "protein", "corrective"]),
    );
    expect(suggestion.candidateCount).toBe(3);
  });

  it("keeps priced amino-acid correctives in the real starter pool", async () => {
    const suggestion = await suggestFormulationIngredients(
      nutritionPhaseAtWeight(30),
      "ME",
    );

    expect(suggestion.status).toBe("suggested");
    if (suggestion.status !== "suggested") return;

    expect(suggestion.ingredientIds).toEqual(
      expect.arrayContaining([
        "l-lysine-hcl",
        "dl-methionine",
        "l-threonine",
        "l-tryptophan",
        "l-valine",
        "l-isoleucine",
      ]),
    );
  });

  it("does not silently exclude any priced ingredient from the strict candidate pool", async () => {
    const suggestion = await suggestFormulationIngredients(
      nutritionPhaseAtWeight(30),
      "ME",
    );

    expect(suggestion.status).toBe("suggested");
    if (suggestion.status !== "suggested") return;

    const pricedIngredientIds = INGREDIENT_DEFAULT_PRICES.map(
      (price) => price.ingredientId,
    );

    expect(suggestion.candidateCount).toBe(pricedIngredientIds.length);
    expect(suggestion.ingredientIds).toEqual(
      expect.arrayContaining(pricedIngredientIds),
    );
    expect(suggestion.ingredientIds).toEqual(
      expect.arrayContaining([
        "wheat-bran",
        "sunflower-meal-solvent-extracted",
        "sorghum-grain",
        "wheat-hard-red-winter",
        "soybean-degummed-oil",
        "limestone-ground",
        "calcium-carbonate",
        "monocalcium-phosphate",
      ]),
    );
  });

  it("uses valine to avoid excessive soybean meal in the first pre-starter phase", async () => {
    const phase = nutritionPhaseAtWeight(5);
    const suggestion = await suggestFormulationIngredients(phase, "ME");

    expect(suggestion.status).toBe("suggested");
    if (suggestion.status !== "suggested") return;

    const result = await formulateLeastCostDiet(
      phase,
      "ME",
      suggestion.ingredientIds.map((ingredientId) => ({
        ingredientId,
        pricePerKg: ingredientDefaultPricePerKg(ingredientId)!,
      })),
    );

    expect(result.status).toBe("optimal");
    if (result.status !== "optimal") return;

    const valine = result.solution.formula.ingredients.find(
      (row) => row.ingredientId === "l-valine",
    );
    const soybeanMealPct = result.solution.formula.ingredients
      .filter((row) => row.ingredientId.startsWith("soybean-meal-"))
      .reduce((sum, row) => sum + row.inclusionPct, 0);

    expect(valine?.inclusionPct).toBeGreaterThan(0.1);
    expect(soybeanMealPct).toBeLessThan(50);
  });

  it("reports missing Chapter 7 coverage for the 4.4–6.2 kg phase instead of inventing targets", async () => {
    const phase = nutritionPhaseAtWeight(5);
    expect(phase.supplementation).toBeUndefined();

    const target = phase.requirements.crudeProteinPct;
    const library = testLibrary(target + 5, target + 10);
    const result = await formulateLeastCostDiet(
      phase,
      "ME",
      [
        { ingredientId: "cheap", pricePerKg: 0.2 },
        { ingredientId: "protein", pricePerKg: 0.6 },
      ],
      library,
      { includeSupplementationTargets: true },
    );

    expect(result.unsupportedRequirements).toContain(
      "vitamin-trace-mineral-supplementation",
    );
  });

  it("reserves a fixed premix without requiring a micronutrient profile in mode 1", async () => {
    const phase = nutritionPhaseAtWeight(30);
    const target = phase.requirements.crudeProteinPct;
    const base = testLibrary(target + 5, target + 10);
    const library = ingredientLibraryWithCustomPremixes(
      [{
        id: "fixed-premix",
        name: "Commercial premix",
        vitamins: {},
        traceMineralsPpm: {},
      }],
      base,
    );

    const result = await formulateLeastCostDiet(
      phase,
      "ME",
      [
        { ingredientId: "cheap", pricePerKg: 0.2 },
        { ingredientId: "protein", pricePerKg: 0.6 },
        {
          ingredientId: "fixed-premix",
          pricePerKg: 2,
          minInclusionPct: 1,
          maxInclusionPct: 1,
        },
      ],
      library,
      { includeSupplementationTargets: false },
    );

    expect(result.status).toBe("optimal");
    if (result.status !== "optimal") return;

    expect(
      result.solution.formula.ingredients.find(
        (row) => row.ingredientId === "fixed-premix",
      )?.inclusionPct,
    ).toBeCloseTo(1, 6);
    expect(
      result.solution.formula.ingredients
        .filter((row) => row.ingredientId !== "fixed-premix")
        .reduce((sum, row) => sum + row.inclusionPct, 0),
    ).toBeCloseTo(99, 6);
    expect(result.nutrientProfile.every((row) => row.margin >= -1e-8)).toBe(true);
  });

  it("can hard-constrain Brazilian Chapter 7 supplementation with a fixed custom premix", async () => {
    const phase = nutritionPhaseAtWeight(30);
    const supplementation = phase.supplementation;
    expect(supplementation).toBeDefined();
    if (!supplementation) return;

    const target = phase.requirements.crudeProteinPct;
    const base = testLibrary(target + 5, target + 10);
    const vitamins = Object.fromEntries(
      Object.entries(supplementation.vitamins).map(([key, value]) => [
        key,
        value * 100,
      ]),
    );
    const traceMineralsPpm = Object.fromEntries(
      Object.entries(supplementation.traceMinerals.inorganic).map(([key, value]) => [
        key.replace(/Ppm$/, ""),
        value * 100,
      ]),
    );
    const library = ingredientLibraryWithCustomPremixes(
      [{
        id: "test-premix",
        name: "Test premix",
        vitamins,
        traceMineralsPpm,
      }],
      base,
    );

    const result = await formulateLeastCostDiet(
      phase,
      "ME",
      [
        { ingredientId: "cheap", pricePerKg: 0.2 },
        { ingredientId: "protein", pricePerKg: 0.6 },
        {
          ingredientId: "test-premix",
          pricePerKg: 2,
          minInclusionPct: 1,
          maxInclusionPct: 1,
        },
      ],
      library,
      {
        includeSupplementationTargets: true,
        traceMineralBasis: "inorganic",
      },
    );

    expect(result.status).toBe("optimal");
    if (result.status !== "optimal") return;
    expect(result.nutrientProfile).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "supplement-vitamin-a" }),
        expect.objectContaining({ id: "supplement-vitamin-b12" }),
        expect.objectContaining({ id: "supplement-zinc" }),
        expect.objectContaining({ id: "supplement-selenium" }),
      ]),
    );
  });

  it("reports an unknown premix label nutrient instead of assuming zero", async () => {
    const phase = nutritionPhaseAtWeight(30);
    const supplementation = phase.supplementation;
    expect(supplementation).toBeDefined();
    if (!supplementation) return;

    const target = phase.requirements.crudeProteinPct;
    const base = testLibrary(target + 5, target + 10);
    const vitamins = Object.fromEntries(
      Object.entries(supplementation.vitamins).map(([key, value]) => [
        key,
        value * 100,
      ]),
    );
    const traceMineralsPpm = Object.fromEntries(
      Object.entries(supplementation.traceMinerals.inorganic)
        .filter(([key]) => key !== "seleniumPpm")
        .map(([key, value]) => [key.replace(/Ppm$/, ""), value * 100]),
    );
    const library = ingredientLibraryWithCustomPremixes(
      [{
        id: "incomplete-premix",
        name: "Incomplete premix",
        vitamins,
        traceMineralsPpm,
      }],
      base,
    );

    const result = await formulateLeastCostDiet(
      phase,
      "ME",
      [
        { ingredientId: "cheap", pricePerKg: 0.2 },
        { ingredientId: "protein", pricePerKg: 0.6 },
        {
          ingredientId: "incomplete-premix",
          pricePerKg: 2,
          minInclusionPct: 1,
          maxInclusionPct: 1,
        },
      ],
      library,
      { includeSupplementationTargets: true },
    );

    expect(result.status).toBe("missing-data");
    if (result.status !== "missing-data") return;
    expect(result.missingData).toContainEqual({
      ingredientId: "incomplete-premix",
      nutrientIds: expect.arrayContaining(["supplement-selenium"]),
    });
  });

  it("returns near-optimal alternatives inside the configured cost ceiling", async () => {
    const phase = nutritionPhaseAtWeight(30);
    const target = phase.requirements.crudeProteinPct;
    const library = loadIngredientLibrary({
      ...INGREDIENT_LIBRARY,
      ingredients: [
        ingredient("soybean-meal-test", "Soybean meal test", target + 8),
        ingredient("local-alternative", "Local alternative", target + 8),
      ],
    });

    const result = await formulateLeastCostDiet(
      phase,
      "ME",
      [
        { ingredientId: "soybean-meal-test", pricePerKg: 0.5 },
        { ingredientId: "local-alternative", pricePerKg: 0.51 },
      ],
      library,
    );

    expect(result.status).toBe("optimal");
    if (result.status !== "optimal") return;

    expect(result.alternativeCostTolerancePct).toBe(3);
    expect(result.alternatives.length).toBeGreaterThan(0);
    for (const alternative of result.alternatives) {
      expect(alternative.solution.costPerKg).toBeLessThanOrEqual(
        result.solution.costPerKg * 1.03 + 1e-8,
      );
    }

    const lowSoy = result.alternatives.find(
      (alternative) => alternative.id === "low-soy",
    );
    expect(lowSoy).toBeDefined();
    expect(
      lowSoy?.solution.formula.ingredients.some(
        (row) => row.ingredientId === "soybean-meal-test",
      ),
    ).toBe(false);
    expect(
      lowSoy?.solution.formula.ingredients.find(
        (row) => row.ingredientId === "local-alternative",
      )?.inclusionPct,
    ).toBeCloseTo(100, 5);
    expect(lowSoy?.costIncreasePct).toBeCloseTo(2, 5);

    expect(result.ingredientOpportunityCostTolerancesPct).toEqual([1, 2, 3]);
    const opportunity = result.ingredientOpportunities.find(
      (candidate) => candidate.ingredientId === "local-alternative",
    );
    expect(opportunity).toBeDefined();
    expect(
      opportunity?.points.find((point) => point.costTolerancePct === 1)
        ?.maxInclusionPct,
    ).toBeCloseTo(50, 4);
    expect(
      opportunity?.points.find((point) => point.costTolerancePct === 2)
        ?.maxInclusionPct,
    ).toBeCloseTo(100, 4);
    expect(
      opportunity?.points.find((point) => point.costTolerancePct === 3)
        ?.maxInclusionPct,
    ).toBeCloseTo(100, 4);

    const onePercentPoint = opportunity?.points.find(
      (point) => point.costTolerancePct === 1,
    );
    expect(onePercentPoint?.recipe.costPerKg).toBeCloseTo(
      onePercentPoint?.resultingCostPerKg ?? 0,
      8,
    );
    expect(
      onePercentPoint?.recipe.formula.ingredients.find(
        (row) => row.ingredientId === "local-alternative",
      )?.inclusionPct,
    ).toBeCloseTo(onePercentPoint?.maxInclusionPct ?? 0, 5);
    expect(
      onePercentPoint?.recipe.formula.ingredients.reduce(
        (sum, row) => sum + row.inclusionPct,
        0,
      ),
    ).toBeCloseTo(100, 6);
  });

  it("returns the hard-constraint nutrient profile used by the optimizer", async () => {
    const phase = nutritionPhaseAtWeight(30);
    const suggestion = await suggestFormulationIngredients(phase, "ME");

    expect(suggestion.status).toBe("suggested");
    if (suggestion.status !== "suggested") return;

    const result = await formulateLeastCostDiet(
      phase,
      "ME",
      suggestion.ingredientIds.map((ingredientId) => ({
        ingredientId,
        pricePerKg: ingredientDefaultPricePerKg(ingredientId)!,
      })),
    );

    expect(result.status).toBe("optimal");
    if (result.status !== "optimal") return;

    expect(result.nutrientProfile).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "energy-me", relation: "min" }),
        expect.objectContaining({ id: "crude-protein", relation: "min" }),
        expect.objectContaining({ id: "digestible-protein", relation: "min" }),
        expect.objectContaining({ id: "sid-lysine", relation: "min" }),
        expect.objectContaining({ id: "sid-valine", relation: "min" }),
        expect.objectContaining({ id: "available-phosphorus", relation: "min" }),
        expect.objectContaining({ id: "potassium", relation: "min" }),
      ]),
    );
    expect(
      result.nutrientProfile.every((row) => row.margin >= -1e-6),
    ).toBe(true);
  });

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

  it.each([
    ["digestible-protein", (record: IngredientNutrientRecord) => {
      record.composition.digestibleProteinPct = 0;
    }],
    ["available-phosphorus", (record: IngredientNutrientRecord) => {
      record.macroMinerals.availablePhosphorusPct = 0;
    }],
    ["potassium", (record: IngredientNutrientRecord) => {
      record.macroMinerals.potassiumPct = 0;
    }],
    ["linoleic-acid", (record: IngredientNutrientRecord) => {
      record.composition.linoleicAcidPct = 0;
    }],
  ] as const)("hard-constrains %s", async (constraintId, makeDeficient) => {
    const phase = nutritionPhaseAtWeight(30);
    const target = phase.requirements.crudeProteinPct;
    const base = testLibrary(target + 5, target + 10);
    const ingredients = base.ingredients.map((record) =>
      structuredClone(record),
    );
    ingredients.forEach(makeDeficient);
    const library = loadIngredientLibrary({ ...base, ingredients });

    const result = await formulateLeastCostDiet(
      phase,
      "ME",
      ingredients.map((record) => ({
        ingredientId: record.id,
        pricePerKg: 1,
      })),
      library,
    );

    expect(result.status).toBe("infeasible");
    if (result.status !== "infeasible") return;
    expect(
      result.diagnostics.find((diagnostic) => diagnostic.constraintId === constraintId),
    ).toBeDefined();
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
