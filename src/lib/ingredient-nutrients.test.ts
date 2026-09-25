import { describe, expect, it } from "vitest";

import { INGREDIENT_LIBRARY, loadIngredientLibrary } from "./ingredient-nutrients";

describe("ingredient nutrient JSON library", () => {
  it("loads the checked-in JSON structure", () => {
    expect(INGREDIENT_LIBRARY.schemaVersion).toBe(1);
    expect(INGREDIENT_LIBRARY.basis.nutrientComposition).toBe("as-fed");
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
