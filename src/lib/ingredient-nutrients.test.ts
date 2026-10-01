import { describe, expect, it } from "vitest";

import {
  INGREDIENT_LIBRARY,
  loadIngredientLibrary,
  sidAminoAcidPct,
  sttdPhosphorusPctOf,
} from "./ingredient-nutrients";

describe("Brazilian Tables 2024 ingredient nutrient library", () => {
  it("loads the Brazilian Tables as the canonical ingredient source", () => {
    expect(INGREDIENT_LIBRARY.schemaVersion).toBe(1);
    expect(INGREDIENT_LIBRARY.id).toBe("brazilian-tables-2024-ingredient-library");
    expect(INGREDIENT_LIBRARY.basis.nutrientComposition).toBe("as-fed");
    expect(INGREDIENT_LIBRARY.source.title).toMatch(/Brazilian Tables for Poultry and Swine/);
    expect(INGREDIENT_LIBRARY.source.edition).toBe("5th Edition");
    expect(INGREDIENT_LIBRARY.source.year).toBe(2024);
    expect(INGREDIENT_LIBRARY.source.chapter).toBe(
      "1 — Feedstuff Composition and Nutritional Value",
    );
    expect(INGREDIENT_LIBRARY.ingredients).toHaveLength(40);
  });

  it("keeps every canonical ingredient on Brazilian Tables provenance", () => {
    for (const ingredient of INGREDIENT_LIBRARY.ingredients) {
      expect(
        ingredient.provenance.source?.title,
        ingredient.id,
      ).toMatch(/Brazilian Tables for Poultry and Swine/);
      expect(ingredient.provenance.source?.year, ingredient.id).toBe(2024);
      expect(
        Object.keys(ingredient.provenance.nutrientSources),
        ingredient.id,
      ).toHaveLength(0);
    }
  });

  it("has unique ids and retains the priced formulation ingredient identities", () => {
    const ids = INGREDIENT_LIBRARY.ingredients.map((ingredient) => ingredient.id);
    expect(new Set(ids).size).toBe(ids.length);

    expect(ids).toEqual(
      expect.arrayContaining([
        "corn-yellow-dent",
        "soybean-meal-dehulled-solvent-extracted",
        "soybean-meal-solvent-extracted",
        "sunflower-meal-solvent-extracted",
        "wheat-bran",
        "corn-oil",
        "barley-two-row",
        "wheat-hard-red-winter",
        "sorghum-grain",
        "corn-high-lysine-grain",
        "corn-high-oil-grain",
        "rice-broken",
        "sorghum-grain-high-tannin",
        "limestone-ground",
        "calcium-carbonate",
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
  });

  it("does not retain ingredients without a defensible Brazilian Tables identity", () => {
    const ids = new Set(
      INGREDIENT_LIBRARY.ingredients.map((ingredient) => ingredient.id),
    );

    for (const removed of [
      "wheat-middlings",
      "corn-ddgs-low-oil",
      "vitamin-trace-mineral-premix",
      "peas-field",
      "alfalfa-meal-dehydrated",
      "beet-pulp",
      "soybeans-heat-processed",
      "corn-hominy-feed",
      "fish-meal-menhaden",
      "flaxseed-meal-solvent-extracted",
      "meat-and-bone-meal",
      "meat-meal",
      "blood-meal-spray-dried",
      "plasma-protein-spray-dried",
    ]) {
      expect(ids.has(removed), removed).toBe(false);
    }
  });

  it("loads barley directly from Brazilian Table 1.01", () => {
    const barley = INGREDIENT_LIBRARY.ingredients.find(
      (ingredient) => ingredient.id === "barley-two-row",
    );

    expect(barley?.name).toBe("Barley, Grain");
    expect(barley?.provenance.sourceTable).toBe("Table 1.01");
    expect(barley?.provenance.sourcePage).toBe(23);
    expect(barley?.composition.crudeProteinPct).toBe(10.3);
    expect(barley?.composition.digestibleProteinPct).toBe(8.42);
    expect(barley?.energy.metabolizableKcalKg).toBe(3019);
    expect(sidAminoAcidPct(barley!, "lysine")).toBe(0.3);
  });

  it("loads the priority Brazilian grain alternatives", () => {
    const highLysineCorn = INGREDIENT_LIBRARY.ingredients.find(
      (ingredient) => ingredient.id === "corn-high-lysine-grain",
    );
    const highOilCorn = INGREDIENT_LIBRARY.ingredients.find(
      (ingredient) => ingredient.id === "corn-high-oil-grain",
    );
    const brokenRice = INGREDIENT_LIBRARY.ingredients.find(
      (ingredient) => ingredient.id === "rice-broken",
    );
    const highTanninSorghum = INGREDIENT_LIBRARY.ingredients.find(
      (ingredient) => ingredient.id === "sorghum-grain-high-tannin",
    );

    expect(highLysineCorn).toMatchObject({
      provenance: { sourcePage: 77, sourceTable: "Table 1.01" },
      energy: { metabolizableKcalKg: 3409 },
      composition: { digestibleProteinPct: 7.26 },
    });
    expect(highOilCorn).toMatchObject({
      provenance: { sourcePage: 79 },
      energy: { metabolizableKcalKg: 3582 },
      composition: { linoleicAcidPct: 3.3 },
    });
    expect(brokenRice).toMatchObject({
      provenance: { sourcePage: 139 },
      energy: { metabolizableKcalKg: 3489 },
      composition: { digestibleProteinPct: 7.07 },
    });
    expect(sidAminoAcidPct(brokenRice!, "lysine")).toBe(0.25);
    expect(highTanninSorghum).toMatchObject({
      provenance: { sourcePage: 149 },
      energy: { metabolizableKcalKg: 2984 },
      composition: { digestibleProteinPct: 6.61 },
    });
  });

  it("uses Brazilian Table 1.01 swine SID concentrations directly", () => {
    const maize = INGREDIENT_LIBRARY.ingredients.find(
      (ingredient) => ingredient.id === "corn-yellow-dent",
    );
    const soybeanMeal = INGREDIENT_LIBRARY.ingredients.find(
      (ingredient) => ingredient.id === "soybean-meal-dehulled-solvent-extracted",
    );

    expect(maize?.aminoAcids.totalPct.lysine).toBe(0.25);
    expect(sidAminoAcidPct(maize!, "lysine")).toBe(0.2);
    expect(maize?.composition.digestibleProteinPct).toBe(6.72);
    expect(maize?.macroMinerals.availablePhosphorusPct).toBe(0.05);
    expect(maize?.composition.linoleicAcidPct).toBe(1.91);

    expect(soybeanMeal?.name).toBe("Soybean, Meal 48% CP");
    expect(soybeanMeal?.composition.digestibleProteinPct).toBe(44);
    expect(soybeanMeal?.macroMinerals.potassiumPct).toBe(2.13);
    expect(sttdPhosphorusPctOf(soybeanMeal!)).toBe(0.27);
  });

  it("loads Brazilian hard-constraint values for locally useful grains and meals", () => {
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
    expect(wheat?.energy.metabolizableKcalKg).toBe(3243);
    expect(wheat?.macroMinerals.availablePhosphorusPct).toBe(0.08);
    expect(sttdPhosphorusPctOf(wheat!)).toBe(0.15);
  });

  it("uses Brazilian Table 1.10 for mineral supplements", () => {
    const limestone = INGREDIENT_LIBRARY.ingredients.find(
      (ingredient) => ingredient.id === "limestone-ground",
    );
    const salt = INGREDIENT_LIBRARY.ingredients.find(
      (ingredient) => ingredient.id === "sodium-chloride",
    );
    const mcp = INGREDIENT_LIBRARY.ingredients.find(
      (ingredient) => ingredient.id === "monocalcium-phosphate",
    );
    const dcp = INGREDIENT_LIBRARY.ingredients.find(
      (ingredient) => ingredient.id === "dicalcium-phosphate",
    );

    expect(limestone?.macroMinerals.calciumPct).toBe(37.5);
    expect(limestone?.macroMinerals.magnesiumPct).toBe(0.27);
    expect(salt?.macroMinerals.sodiumPct).toBe(39.7);
    expect(salt?.macroMinerals.chloridePct).toBe(59.6);
    expect(sttdPhosphorusPctOf(mcp!)).toBe(16.4);
    expect(sttdPhosphorusPctOf(dcp!)).toBe(13.9);
  });

  it("uses Brazilian Table 1.09 for crystalline amino acids without external fallbacks", () => {
    const lysine = INGREDIENT_LIBRARY.ingredients.find(
      (ingredient) => ingredient.id === "l-lysine-hcl",
    );
    const methionine = INGREDIENT_LIBRARY.ingredients.find(
      (ingredient) => ingredient.id === "dl-methionine",
    );
    const valine = INGREDIENT_LIBRARY.ingredients.find(
      (ingredient) => ingredient.id === "l-valine",
    );
    const isoleucine = INGREDIENT_LIBRARY.ingredients.find(
      (ingredient) => ingredient.id === "l-isoleucine",
    );

    expect(lysine?.composition.digestibleProteinPct).toBeCloseTo(84.1796, 4);
    expect(sidAminoAcidPct(lysine!, "lysine")).toBeCloseTo(70.298173, 5);

    expect(methionine?.name).toBe("Methionine, crystalline");
    expect(sidAminoAcidPct(methionine!, "methionine")).toBe(99.5);

    expect(sidAminoAcidPct(valine!, "valine")).toBe(95.5);
    expect(sidAminoAcidPct(isoleucine!, "isoleucine")).toBe(97.1);
    expect(valine?.energy.standardizedMetabolizableKcalKg).toBe(5527);
    expect(isoleucine?.energy.standardizedMetabolizableKcalKg).toBe(6210);
    expect(valine?.energy.metabolizableKcalKg).toBeUndefined();
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
