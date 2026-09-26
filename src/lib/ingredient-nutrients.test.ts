import { describe, expect, it } from "vitest";

import {
  INGREDIENT_LIBRARY,
  loadIngredientLibrary,
  sidAminoAcidPct,
  sttdPhosphorusPctOf,
  nutrientValueSource,
} from "./ingredient-nutrients";

describe("ingredient nutrient JSON library", () => {
  it("loads the checked-in NRC 2012 ingredient library", () => {
    expect(INGREDIENT_LIBRARY.schemaVersion).toBe(1);
    expect(INGREDIENT_LIBRARY.basis.nutrientComposition).toBe("as-fed");
    expect(INGREDIENT_LIBRARY.source.title).toBe("Nutrient Requirements of Swine");
    expect(INGREDIENT_LIBRARY.source.edition).toBe("11th Revised Edition");
    expect(INGREDIENT_LIBRARY.source.year).toBe(2012);
    expect(INGREDIENT_LIBRARY.source.chapter).toBe("17 — Feed Ingredient Composition");
    expect(INGREDIENT_LIBRARY.ingredients).toHaveLength(48);
  });

  it("has unique ingredient ids and includes every ingredient used by the PIC example diets", () => {
    const ids = INGREDIENT_LIBRARY.ingredients.map((ingredient) => ingredient.id);
    expect(new Set(ids).size).toBe(ids.length);

    expect(ids).toEqual(
      expect.arrayContaining([
        "corn-yellow-dent",
        "soybean-meal-dehulled-solvent-extracted",
        "corn-oil",
        "calcium-carbonate",
        "monocalcium-phosphate",
        "sodium-chloride",
        "l-lysine-hcl",
        "dl-methionine",
        "l-threonine",
        "l-tryptophan",
        "vitamin-trace-mineral-premix",
        "corn-ddgs-low-oil",
        "wheat-middlings",
      ]),
    );
  });

  it("keeps supplemental ingredient sources explicit rather than relabelling them NRC 2012", () => {
    const barley = INGREDIENT_LIBRARY.ingredients.find(
      (ingredient) => ingredient.id === "barley-two-row",
    );
    expect(barley?.provenance.source?.publisher).toBe("Pork Information Gateway");
    expect(barley?.provenance.source?.basis).toMatch(/distinct from NRC 2012/i);
    expect(barley?.energy.metabolizableKcalKg).toBeGreaterThan(2900);
  });

  it("tracks nutrient-specific fallback provenance", () => {
    const ddgs = INGREDIENT_LIBRARY.ingredients.find(
      (ingredient) => ingredient.id === "corn-ddgs-low-oil",
    );
    const lysine = INGREDIENT_LIBRARY.ingredients.find(
      (ingredient) => ingredient.id === "l-lysine-hcl",
    );

    expect(ddgs?.energy.metabolizableKcalKg).toBe(2760);
    expect(nutrientValueSource(ddgs!, "energy.metabolizableKcalKg")).toMatchObject({
      publisher: "INRAE–CIRAD–AFZ",
      priority: "fallback",
    });

    expect(lysine?.macroMinerals.chloridePct).toBe(19.1);
    expect(nutrientValueSource(lysine!, "macroMinerals.chloridePct")).toMatchObject({
      publisher: "INRAE–CIRAD–AFZ",
      priority: "fallback",
    });
  });

  it("preserves NRC total lysine and SID digestibility separately", () => {
    const maize = INGREDIENT_LIBRARY.ingredients.find(
      (ingredient) => ingredient.id === "corn-yellow-dent",
    );
    expect(maize).toBeDefined();
    expect(maize?.aminoAcids.totalPct.lysine).toBe(0.25);
    expect(maize?.aminoAcids.sidDigestibilityPct.lysine).toBe(74);
    expect(sidAminoAcidPct(maize!, "lysine")).toBeCloseTo(0.185, 6);
  });

  it("derives STTD phosphorus concentration from NRC total P and digestibility", () => {
    const soybeanMeal = INGREDIENT_LIBRARY.ingredients.find(
      (ingredient) => ingredient.id === "soybean-meal-dehulled-solvent-extracted",
    );
    expect(soybeanMeal).toBeDefined();
    expect(sttdPhosphorusPctOf(soybeanMeal!)).toBeCloseTo(0.3408, 6);
  });

  it("uses explicit SID concentration for crystalline lysine", () => {
    const lysine = INGREDIENT_LIBRARY.ingredients.find(
      (ingredient) => ingredient.id === "l-lysine-hcl",
    );
    expect(lysine).toBeDefined();
    expect(sidAminoAcidPct(lysine!, "lysine")).toBe(78.8);
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
