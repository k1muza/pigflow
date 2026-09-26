import { describe, expect, it } from "vitest";

import {
  BRAZILIAN_2024_BREEDER_SWINE,
  BRAZILIAN_2024_CORE_FEEDSTUFFS,
  BRAZILIAN_2024_CRYSTALLINE_AMINO_ACIDS,
  BRAZILIAN_2024_GROWING_SWINE,
  BRAZILIAN_2024_MINERAL_SOURCES,
  BRAZILIAN_2024_SOURCE,
} from "./brazilian-nutrition";

describe("Brazilian Tables 2024 source data", () => {
  it("loads the 5th edition source manifest", () => {
    expect(BRAZILIAN_2024_SOURCE).toMatchObject({
      id: "brazilian-tables-2024",
      edition: 5,
      year: 2024,
      isbn: "9788581792101",
    });
    expect(BRAZILIAN_2024_SOURCE.extraction.status).toBe("in_progress");
  });

  it("preserves the published growing-swine programme boundaries", () => {
    const high = BRAZILIAN_2024_GROWING_SWINE.programmes.find(
      (programme) => programme.id === "high-performance-mixed-sex",
    );
    expect(high?.sourceTable).toBe("5.41");
    expect(high?.phases).toHaveLength(5);
    expect(high?.phases[0]).toMatchObject({
      ageDays: { min: 49, max: 63 },
      weightKg: { min: 18, max: 27 },
      diet: { metabolizableEnergyKcalKg: 3350, netEnergyKcalKg: 2482 },
      sidAminoAcidsPct: { lysine: 1.232 },
    });
    expect(high?.phases[4]).toMatchObject({
      weightKg: { min: 110, max: 141 },
      sidAminoAcidsPct: { lysine: 0.67 },
    });
  });

  it("loads the extracted gilt programmes from Tables 5.36 and 5.38", () => {
    const high = BRAZILIAN_2024_GROWING_SWINE.programmes.find(
      (programme) => programme.id === "high-performance-gilts",
    );
    const standard = BRAZILIAN_2024_GROWING_SWINE.programmes.find(
      (programme) => programme.id === "standard-performance-gilts",
    );

    expect(high?.sourceTable).toBe("5.36");
    expect(high?.phases[0]).toMatchObject({
      weightKg: { min: 18, max: 27 },
      sidAminoAcidsPct: { lysine: 1.249 },
    });
    expect(standard?.sourceTable).toBe("5.38");
    expect(standard?.phases[4]).toMatchObject({
      weightKg: { min: 100, max: 129 },
      sidAminoAcidsPct: { lysine: 0.657 },
    });
  });

  it("loads the remaining sex-specific and hot-environment growing tables", () => {
    const tables = new Map(
      BRAZILIAN_2024_GROWING_SWINE.programmes.map((programme) => [
        programme.sourceTable,
        programme,
      ]),
    );

    expect(tables.get("5.33")?.phases[0]).toMatchObject({
      weightKg: { min: 18, max: 27 },
      sidAminoAcidsPct: { lysine: 1.214 },
    });
    expect(tables.get("5.34")?.population.environment).toBe("+5C-above-thermoneutral");
    expect(tables.get("5.35")?.phases[4]).toMatchObject({
      weightKg: { min: 106, max: 133 },
      nutrientsPct: { crudeProtein: 10.05 },
    });
    expect(tables.get("5.37")?.phases).toHaveLength(4);
    expect(tables.get("5.39")?.phases[0]).toMatchObject({
      weightKg: { min: 17, max: 26 },
      sidAminoAcidsPct: { lysine: 1.279 },
    });
    expect(tables.get("5.40")?.population.environment).toBe("+5C-above-thermoneutral");
    expect(tables.get("5.42")?.phases[0]).toMatchObject({
      weightKg: { min: 27, max: 50 },
      sidAminoAcidsPct: { lysine: 1.142 },
    });
  });

  it("loads Chapter 6 gestation and lactation source tables", () => {
    expect(BRAZILIAN_2024_BREEDER_SWINE.gestation).toMatchObject({
      sourceTable: "6.08",
      aminoAcidRatios: { sourceTable: "6.04" },
    });
    expect(BRAZILIAN_2024_BREEDER_SWINE.gestation.phases).toHaveLength(8);
    expect(BRAZILIAN_2024_BREEDER_SWINE.gestation.phases[0]).toMatchObject({
      parity: "nulliparous",
      gestationDays: { min: 0, max: 85 },
      nutrientsPct: { crudeProtein: 12.29 },
      sidAminoAcidsPct: { lysine: 0.583 },
    });

    expect(BRAZILIAN_2024_BREEDER_SWINE.lactation).toMatchObject({
      sourceTable: "6.15",
      aminoAcidRatios: { sourceTable: "6.11" },
    });
    expect(BRAZILIAN_2024_BREEDER_SWINE.lactation.phases).toHaveLength(6);
    expect(BRAZILIAN_2024_BREEDER_SWINE.lactation.phases[5]).toMatchObject({
      parity: "PO3+",
      litterWeightGainKgDay: 3.1,
      nutrientsPct: { crudeProtein: 21.48 },
      sidAminoAcidsPct: { lysine: 1.09 },
    });

    expect(BRAZILIAN_2024_BREEDER_SWINE.lactation25C).toMatchObject({
      sourceTable: "6.16",
      averageTemperatureC: 25,
      aminoAcidRatios: { sourceTable: "6.11" },
    });
    expect(BRAZILIAN_2024_BREEDER_SWINE.lactation25C.phases[0]).toMatchObject({
      parity: "PO1",
      litterWeightGainKgDay: 2.63,
      daily: { feedIntakeKgDay: 5.448 },
      sidAminoAcidsPct: { lysine: 1.101 },
    });
  });

  it("keeps the Brazilian amino-acid ratios as source-native data", () => {
    expect(BRAZILIAN_2024_GROWING_SWINE.aminoAcidRatios.phases.grower.sid).toMatchObject({
      methionineCysteine: 60,
      threonine: 68,
      tryptophan: 20,
      valine: 69,
      isoleucine: 55,
      leucine: 100,
    });
  });

  it("does not silently map the wrong DDGS or soybean-meal identity", () => {
    const ddgs = BRAZILIAN_2024_CORE_FEEDSTUFFS.ingredients.find(
      (ingredient) => ingredient.id === "corn-ddgs-6-9-ee",
    );
    const soybean = BRAZILIAN_2024_CORE_FEEDSTUFFS.ingredients.find(
      (ingredient) => ingredient.id === "soybean-meal-45.6-cp-average",
    );

    expect(ddgs?.mappingConfidence).toBe("unmapped");
    expect(ddgs?.pigflowIngredientId).toBeUndefined();
    expect(soybean?.mappingConfidence).toBe("unmapped");
  });

  it("preserves swine-specific energy and SID amino acids for feedstuffs", () => {
    const corn = BRAZILIAN_2024_CORE_FEEDSTUFFS.ingredients.find(
      (ingredient) => ingredient.id === "corn-grain-average",
    );
    expect(corn?.swineEnergyKcalKg).toEqual({
      digestible: 3442,
      metabolizable: 3360,
      net: 2667,
    });
    expect(corn?.aminoAcids.sidSwinePct.lysine).toBe(0.2);

    const soy = BRAZILIAN_2024_CORE_FEEDSTUFFS.ingredients.find(
      (ingredient) => ingredient.id === "soybean-meal-45.6-cp-average",
    );
    expect(soy?.aminoAcids.sidSwinePct.lysine).toBe(2.59);
    expect(soy?.macroMineralsPct.standardizedDigestiblePhosphorusSwine).toBe(0.26);
  });

  it("keeps crystalline amino-acid energy semantics explicit", () => {
    const lysine = BRAZILIAN_2024_CRYSTALLINE_AMINO_ACIDS.ingredients.find(
      (ingredient) => ingredient.id === "lysine-hcl",
    );
    expect(lysine?.energyKcalKg).toEqual({
      gross: 4901,
      digestible: 4808,
      standardizedMetabolizable: 4546,
      net: 3523,
    });
  });

  it("loads exact inorganic mineral-source values separately from feedstuffs", () => {
    const salt = BRAZILIAN_2024_MINERAL_SOURCES.ingredients.find(
      (ingredient) => ingredient.id === "salt",
    );
    expect(salt).toMatchObject({
      sodiumPct: 39.7,
      chloridePct: 59.6,
    });

    const mcp = BRAZILIAN_2024_MINERAL_SOURCES.ingredients.find(
      (ingredient) => ingredient.id === "monocalcium-phosphate",
    );
    expect(mcp).toMatchObject({
      calciumPct: 18.9,
      totalPhosphorusPct: 21.4,
      digestiblePhosphorusSwinePct: 16.4,
    });
  });
});
