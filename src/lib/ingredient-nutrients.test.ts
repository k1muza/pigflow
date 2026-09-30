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
    expect(INGREDIENT_LIBRARY.ingredients).toHaveLength(50);
  });

  it("has unique ingredient ids and includes the core formulation ingredient classes", () => {
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
        "l-valine",
        "l-isoleucine",
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

  it("loads Brazilian hard-constraint nutrients with per-value provenance", () => {
    const maize = INGREDIENT_LIBRARY.ingredients.find(
      (ingredient) => ingredient.id === "corn-yellow-dent",
    );
    const soybeanMeal = INGREDIENT_LIBRARY.ingredients.find(
      (ingredient) => ingredient.id === "soybean-meal-dehulled-solvent-extracted",
    );
    const cornOil = INGREDIENT_LIBRARY.ingredients.find(
      (ingredient) => ingredient.id === "corn-oil",
    );

    expect(maize?.composition.digestibleProteinPct).toBe(6.72);
    expect(maize?.macroMinerals.availablePhosphorusPct).toBe(0.05);
    expect(maize?.composition.linoleicAcidPct).toBe(1.91);
    expect(soybeanMeal?.composition.digestibleProteinPct).toBe(44);
    expect(soybeanMeal?.macroMinerals.potassiumPct).toBe(2.13);
    expect(cornOil?.composition.linoleicAcidPct).toBe(51.9);
    expect(
      nutrientValueSource(maize!, "composition.digestibleProteinPct"),
    ).toMatchObject({
      publisher: "Universidade Federal de Viçosa",
      priority: "primary",
    });

    const lysine = INGREDIENT_LIBRARY.ingredients.find(
      (ingredient) => ingredient.id === "l-lysine-hcl",
    );
    expect(lysine?.composition.digestibleProteinPct).toBeCloseTo(83.7587, 4);
    expect(
      nutrientValueSource(lysine!, "composition.digestibleProteinPct")?.basis,
    ).toMatch(/as-fed/i);
  });

  it("loads crystalline valine and isoleucine on an as-fed SID basis", () => {
    const valine = INGREDIENT_LIBRARY.ingredients.find(
      (ingredient) => ingredient.id === "l-valine",
    );
    const isoleucine = INGREDIENT_LIBRARY.ingredients.find(
      (ingredient) => ingredient.id === "l-isoleucine",
    );

    expect(valine?.composition.digestibleProteinPct).toBeCloseTo(70.2966, 4);
    expect(isoleucine?.composition.digestibleProteinPct).toBeCloseTo(64.6749, 4);
    expect(sidAminoAcidPct(valine!, "valine")).toBe(96.5);
    expect(sidAminoAcidPct(isoleucine!, "isoleucine")).toBe(91.7);
    expect(valine?.energy.metabolizableKcalKg).toBe(5480);
    expect(isoleucine?.energy.metabolizableKcalKg).toBe(6400);
  });

  it("loads Brazilian hard-constraint fallbacks for locally useful ingredients", () => {
    const wheatBran = INGREDIENT_LIBRARY.ingredients.find(
      (ingredient) => ingredient.id === "wheat-bran",
    );
    const sunflowerMeal = INGREDIENT_LIBRARY.ingredients.find(
      (ingredient) => ingredient.id === "sunflower-meal-solvent-extracted",
    );
    const sorghum = INGREDIENT_LIBRARY.ingredients.find(
      (ingredient) => ingredient.id === "sorghum-grain",
    );
    const wheat = INGREDIENT_LIBRARY.ingredients.find(
      (ingredient) => ingredient.id === "wheat-hard-red-winter",
    );
    const limestone = INGREDIENT_LIBRARY.ingredients.find(
      (ingredient) => ingredient.id === "limestone-ground",
    );
    const mcp = INGREDIENT_LIBRARY.ingredients.find(
      (ingredient) => ingredient.id === "monocalcium-phosphate",
    );
    const dcp = INGREDIENT_LIBRARY.ingredients.find(
      (ingredient) => ingredient.id === "dicalcium-phosphate",
    );

    expect(wheatBran?.composition.digestibleProteinPct).toBe(11.7);
    expect(wheatBran?.composition.linoleicAcidPct).toBe(1.54);
    expect(wheatBran?.macroMinerals.availablePhosphorusPct).toBe(0.49);
    expect(sttdPhosphorusPctOf(wheatBran!)).toBe(0.49);

    expect(sunflowerMeal?.composition.digestibleProteinPct).toBe(27.9);
    expect(sunflowerMeal?.macroMinerals.availablePhosphorusPct).toBe(0.32);
    expect(sttdPhosphorusPctOf(sunflowerMeal!)).toBe(0.25);

    expect(sorghum?.composition.digestibleProteinPct).toBe(7.07);
    expect(sorghum?.composition.linoleicAcidPct).toBe(1.05);
    expect(sorghum?.macroMinerals.availablePhosphorusPct).toBe(0.07);
    expect(sttdPhosphorusPctOf(sorghum!)).toBe(0.08);

    expect(wheat?.composition.digestibleProteinPct).toBe(12.3);
    expect(wheat?.macroMinerals.availablePhosphorusPct).toBe(0.08);
    expect(sttdPhosphorusPctOf(wheat!)).toBe(0.15);

    expect(limestone?.macroMinerals.availablePhosphorusPct).toBe(0);
    expect(sttdPhosphorusPctOf(limestone!)).toBe(0);

    expect(sttdPhosphorusPctOf(mcp!)).toBe(16.4);
    expect(sttdPhosphorusPctOf(dcp!)).toBe(13.9);
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
