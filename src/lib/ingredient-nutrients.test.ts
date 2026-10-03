import { describe, expect, it } from "vitest";

import {
  INGREDIENT_LIBRARY,
  availablePhosphorusPctOf,
  formulationPriorityNutrients,
  loadIngredientLibrary,
  metabolizableEnergyKcalKgOf,
  nutrientValueSource,
  sidAminoAcidPct,
  sttdPhosphorusPctOf,
} from "./ingredient-nutrients";

describe("Brazilian Tables ingredient nutrient library", () => {
  it("uses Brazilian Tables 2024 as the canonical source", () => {
    expect(INGREDIENT_LIBRARY.schemaVersion).toBe(1);
    expect(INGREDIENT_LIBRARY.id).toBe("brazilian-tables-2024-swine-ingredient-library");
    expect(INGREDIENT_LIBRARY.source.title).toMatch(/Brazilian Tables for Poultry and Swine/);
    expect(INGREDIENT_LIBRARY.source.edition).toBe("5th Edition");
    expect(INGREDIENT_LIBRARY.source.year).toBe(2024);
    expect(INGREDIENT_LIBRARY.source.chapter).toBe(
      "1 — Feedstuff Composition and Nutritional Value",
    );
    expect(INGREDIENT_LIBRARY.ingredients).toHaveLength(37);
  });

  it("keeps only source-native or explicitly mapped Brazilian ingredient identities", () => {
    const ids = INGREDIENT_LIBRARY.ingredients.map((ingredient) => ingredient.id);
    expect(new Set(ids).size).toBe(ids.length);

    expect(ids).toEqual(
      expect.arrayContaining([
        "corn-yellow-dent",
        "soybean-meal-dehulled-solvent-extracted",
        "soybean-meal-solvent-extracted",
        "soybean-meal-brazilian-45-6-cp-average",
        "wheat-bran",
        "corn-oil",
        "dicalcium-phosphate",
        "monocalcium-phosphate",
        "sodium-chloride",
        "l-lysine-hcl",
        "dl-methionine",
        "l-threonine",
        "l-tryptophan",
        "l-valine",
        "l-isoleucine",
      ]),
    );

    expect(ids).not.toContain("corn-ddgs-low-oil");
    expect(ids).not.toContain("wheat-middlings");
    expect(ids).not.toContain("vitamin-trace-mineral-premix");
  });

  it("uses the Brazilian Corn Grain Average row throughout", () => {
    const maize = INGREDIENT_LIBRARY.ingredients.find(
      (ingredient) => ingredient.id === "corn-yellow-dent",
    );
    expect(maize).toBeDefined();
    expect(maize).toMatchObject({
      name: "Corn, Grain (Average)",
      composition: {
        dryMatterPct: 88.6,
        crudeProteinPct: 7.81,
        digestibleProteinPct: 6.72,
        linoleicAcidPct: 1.91,
      },
      energy: {
        digestibleKcalKg: 3442,
        metabolizableKcalKg: 3360,
        netKcalKg: 2667,
      },
      macroMinerals: {
        potassiumPct: 0.32,
        availablePhosphorusPct: 0.05,
        sttdPhosphorusPct: 0.1,
      },
    });
    expect(maize?.aminoAcids.totalPct.lysine).toBe(0.25);
    expect(maize?.aminoAcids.sidDigestibilityPct.lysine).toBe(78.9);
    expect(sidAminoAcidPct(maize!, "lysine")).toBe(0.2);
    expect(maize?.provenance.sourceTable).toBe("Table 1.01");
    expect(maize?.provenance.source?.priority).toBe("primary");
  });

  it("uses Brazilian soybean and wheat-bran rows rather than NRC rows plus fallbacks", () => {
    const soybean = INGREDIENT_LIBRARY.ingredients.find(
      (ingredient) => ingredient.id === "soybean-meal-dehulled-solvent-extracted",
    );
    const wheatBran = INGREDIENT_LIBRARY.ingredients.find(
      (ingredient) => ingredient.id === "wheat-bran",
    );

    expect(soybean).toMatchObject({
      name: "Soybean, Meal 48% CP",
      composition: {
        crudeProteinPct: 48.2,
        digestibleProteinPct: 44,
        linoleicAcidPct: 0.77,
      },
      energy: { metabolizableKcalKg: 3306, netKcalKg: 2080 },
      macroMinerals: {
        potassiumPct: 2.13,
        availablePhosphorusPct: 0.23,
        sttdPhosphorusPct: 0.27,
      },
    });
    expect(sidAminoAcidPct(soybean!, "lysine")).toBe(2.71);

    expect(wheatBran).toMatchObject({
      name: "Wheat, Bran",
      composition: {
        crudeProteinPct: 15.2,
        digestibleProteinPct: 11.7,
        linoleicAcidPct: 1.54,
      },
      energy: { metabolizableKcalKg: 2370, netKcalKg: 1694 },
      macroMinerals: {
        potassiumPct: 1.1,
        availablePhosphorusPct: 0.49,
        sttdPhosphorusPct: 0.49,
      },
    });

    expect(nutrientValueSource(soybean!, "composition.digestibleProteinPct")).toBeUndefined();
    expect(nutrientValueSource(wheatBran!, "macroMinerals.availablePhosphorusPct")).toBeUndefined();
  });

  it("uses Brazilian Table 1.10 for inorganic mineral sources", () => {
    const dcp = INGREDIENT_LIBRARY.ingredients.find(
      (ingredient) => ingredient.id === "dicalcium-phosphate",
    );
    const salt = INGREDIENT_LIBRARY.ingredients.find(
      (ingredient) => ingredient.id === "sodium-chloride",
    );

    expect(dcp).toMatchObject({
      name: "Dicalcium Phosphate",
      macroMinerals: {
        calciumPct: 24,
        totalPhosphorusPct: 18.5,
        availablePhosphorusPct: 18.5,
        sttdPhosphorusPct: 13.9,
      },
    });
    expect(dcp?.provenance.sourceTable).toBe("Table 1.10");

    expect(salt).toMatchObject({
      name: "Salt",
      macroMinerals: { sodiumPct: 39.7, chloridePct: 59.6 },
    });
  });

  it("uses Brazilian Table 1.09 for crystalline amino acids without relabelling standardized ME", () => {
    const lysine = INGREDIENT_LIBRARY.ingredients.find(
      (ingredient) => ingredient.id === "l-lysine-hcl",
    );
    const methionine = INGREDIENT_LIBRARY.ingredients.find(
      (ingredient) => ingredient.id === "dl-methionine",
    );

    expect(lysine?.energy.metabolizableKcalKg).toBeUndefined();
    expect(lysine?.energy.standardizedMetabolizableKcalKg).toBe(4546);
    expect(metabolizableEnergyKcalKgOf(lysine!)).toBe(4546);
    expect(sidAminoAcidPct(lysine!, "lysine")).toBeCloseTo(70.298173, 5);

    expect(methionine?.energy.standardizedMetabolizableKcalKg).toBe(5477);
    expect(sidAminoAcidPct(methionine!, "methionine")).toBe(99.5);
    expect(methionine?.provenance.sourceTable).toBe("Table 1.09");
  });

  it("surfaces formulation nutrient coverage directly from Brazilian records", () => {
    const corn = INGREDIENT_LIBRARY.ingredients.find(
      (ingredient) => ingredient.id === "corn-yellow-dent",
    );
    const soybean = INGREDIENT_LIBRARY.ingredients.find(
      (ingredient) => ingredient.id === "soybean-meal-brazilian-45-6-cp-average",
    );
    const cornOil = INGREDIENT_LIBRARY.ingredients.find(
      (ingredient) => ingredient.id === "corn-oil",
    );

    expect(formulationPriorityNutrients(corn!)).toEqual([
      "digestible-protein",
      "available-phosphorus",
      "potassium",
      "linoleic-acid",
    ]);
    expect(formulationPriorityNutrients(soybean!)).toHaveLength(4);
    expect(cornOil?.composition.linoleicAcidPct).toBe(51.9);
  });

  it("returns explicit Brazilian phosphorus concentrations", () => {
    const soybeanMeal = INGREDIENT_LIBRARY.ingredients.find(
      (ingredient) => ingredient.id === "soybean-meal-dehulled-solvent-extracted",
    );
    expect(availablePhosphorusPctOf(soybeanMeal!)).toBe(0.23);
    expect(sttdPhosphorusPctOf(soybeanMeal!)).toBe(0.27);
  });

  it("does not carry fallback provenance into canonical records", () => {
    for (const ingredient of INGREDIENT_LIBRARY.ingredients) {
      expect(
        Object.values(ingredient.provenance.nutrientSources).some(
          (source) => source.priority === "fallback",
        ),
      ).toBe(false);
      expect(ingredient.provenance.source?.publisher).toBe(
        "Federal University of Viçosa, Department of Animal Science",
      );
    }
  });

  it("rejects ingredient records without an explicit category and nutrient structure", () => {
    expect(() =>
      loadIngredientLibrary({
        ...INGREDIENT_LIBRARY,
        ingredients: [{ id: "maize", name: "Maize" }],
      }),
    ).toThrow();
  });
});
