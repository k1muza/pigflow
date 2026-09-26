import { describe, expect, it } from "vitest";

import {
  FEEDSPORT_INGREDIENTS,
  FEEDSPORT_INGREDIENT_BY_ID,
  FEEDSPORT_MANIFEST,
  FEEDSPORT_NUTRIENTS,
  feedSportCompositions,
} from "./feedsport-ingredients";

describe("FeedSport ingredient snapshot", () => {
  it("loads the complete pinned catalogue", () => {
    expect(FEEDSPORT_INGREDIENTS).toHaveLength(324);
    expect(FEEDSPORT_NUTRIENTS).toHaveLength(155);
    expect(FEEDSPORT_MANIFEST.ingredientCount).toBe(FEEDSPORT_INGREDIENTS.length);
    expect(FEEDSPORT_MANIFEST.nutrientCount).toBe(FEEDSPORT_NUTRIENTS.length);
    expect(FEEDSPORT_MANIFEST.ingredientsWithSwineData).toBe(53);
    expect(FEEDSPORT_MANIFEST.source.commit).toBe(
      "fde99cd2bbef3c7f0c1a72a16079c4ae60c4b69e",
    );
  });

  it("does not import duplicate ingredient or nutrient IDs", () => {
    const ingredientIds = FEEDSPORT_INGREDIENTS.map((ingredient) => ingredient.id);
    const nutrientIds = FEEDSPORT_NUTRIENTS.map((nutrient) => String(nutrient.id));

    expect(new Set(ingredientIds).size).toBe(ingredientIds.length);
    expect(new Set(nutrientIds).size).toBe(nutrientIds.length);
  });

  it("makes upstream orphan nutrient references explicit", () => {
    const nutrientIds = new Set(FEEDSPORT_NUTRIENTS.map((nutrient) => String(nutrient.id)));
    const missing = FEEDSPORT_INGREDIENTS.flatMap((ingredient) =>
      ingredient.compositions
        .filter((composition) => !nutrientIds.has(String(composition.nutrientId)))
        .map((composition) => String(composition.nutrientId)),
    );

    expect([...new Set(missing)]).toEqual(["118"]);
    expect(missing).toHaveLength(324);
    expect(FEEDSPORT_MANIFEST.unresolvedNutrientIds).toEqual(["118"]);
  });

  it("carries the Brazilian swine enrichment on maize", () => {
    expect(FEEDSPORT_INGREDIENT_BY_ID.get("maize")?.name).toBe("Maize");
    expect(feedSportCompositions("maize", "swine-de-kcal")).toEqual([
      expect.objectContaining({ value: 3442, basis: "as-fed" }),
    ]);
    expect(feedSportCompositions("maize", "swine-me-kcal")).toEqual([
      expect.objectContaining({ value: 3360, basis: "as-fed" }),
    ]);
    expect(feedSportCompositions("maize", "swine-ne-kcal")).toEqual([
      expect.objectContaining({ value: 2667, basis: "as-fed" }),
    ]);
    expect(feedSportCompositions("maize", "swine-sid-lysine")).toEqual([
      expect.objectContaining({ value: 0.2, basis: "as-fed" }),
    ]);
  });

  it("keeps crystalline-amino-acid SID values rather than inventing zeroes", () => {
    expect(feedSportCompositions("l-lysine-hcl", "swine-sid-lysine")).toEqual([
      expect.objectContaining({ value: 78.2838 }),
    ]);
    expect(feedSportCompositions("dl-methionine", "swine-sid-methionine")).toEqual([
      expect.objectContaining({ value: 98.505 }),
    ]);
    expect(feedSportCompositions("l-threonine", "swine-sid-threonine")).toEqual([
      expect.objectContaining({ value: 95.832 }),
    ]);
  });
});
