import { describe, expect, it } from "vitest";

import { INGREDIENT_LIBRARY, loadIngredientLibrary } from "./ingredient-nutrients";

describe("ingredient nutrient JSON library", () => {
  it("loads the checked-in JSON structure", () => {
    expect(INGREDIENT_LIBRARY.schemaVersion).toBe(1);
    expect(INGREDIENT_LIBRARY.basis.nutrientComposition).toBe("as-fed");
    expect(INGREDIENT_LIBRARY.source.title).toBe("Nutrient Requirements of Swine");
    expect(INGREDIENT_LIBRARY.source.edition).toBe("11th Revised Edition");
    expect(INGREDIENT_LIBRARY.source.year).toBe(2012);
    expect(INGREDIENT_LIBRARY.source.chapter).toBe("17 — Feed Ingredient Composition");
    expect(INGREDIENT_LIBRARY.ingredients).toEqual([]);
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
