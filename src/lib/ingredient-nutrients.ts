import { z } from "zod";

import canonicalFeedstuffs01 from "@/data/nutrition/brazilian-2024/ingredients/canonical-feedstuffs-01.json";
import canonicalFeedstuffs02 from "@/data/nutrition/brazilian-2024/ingredients/canonical-feedstuffs-02.json";
import crystallineAminoAcids from "@/data/nutrition/brazilian-2024/supplements/crystalline-amino-acids.json";
import mineralSources from "@/data/nutrition/brazilian-2024/supplements/mineral-sources.json";

const BRAZILIAN_SOURCE = {
  publisher: "Federal University of Viçosa, Department of Animal Science",
  title:
    "Brazilian Tables for Poultry and Swine — Composition of Feedstuffs and Nutritional Requirements",
  edition: "5th Edition",
  year: 2024,
  chapter: "1 — Feedstuff Composition and Nutritional Value",
  doi: "10.26626/978-85-8179-212-5.2024.C001.p.1-230",
  url: "http://dx.doi.org/10.26626/978-85-8179-212-5.2024.C001.p.1-230",
} as const;

const nutrientSourceSchema = z.object({
  publisher: z.string(),
  title: z.string(),
  year: z.number().int().optional(),
  url: z.string().url(),
  basis: z.string().optional(),
  priority: z.enum(["primary", "fallback", "supplier"]).optional(),
  note: z.string().optional(),
});

const ingredientSchema = z.object({
  id: z.string(),
  name: z.string(),
  aliases: z.array(z.string()).default([]),
  category: z.enum([
    "cereal",
    "protein_meal",
    "byproduct",
    "oil_fat",
    "mineral",
    "amino_acid",
    "vitamin_mineral_premix",
    "other",
  ]),
  composition: z.object({
    dryMatterPct: z.number().optional(),
    crudeProteinPct: z.number().optional(),
    digestibleProteinPct: z.number().optional(),
    crudeFatPct: z.number().optional(),
    linoleicAcidPct: z.number().optional(),
    crudeFibrePct: z.number().optional(),
    ashPct: z.number().optional(),
    starchPct: z.number().optional(),
    sugarPct: z.number().optional(),
    neutralDetergentFibrePct: z.number().optional(),
    acidDetergentFibrePct: z.number().optional(),
  }),
  energy: z.object({
    digestibleKcalKg: z.number().optional(),
    metabolizableKcalKg: z.number().optional(),
    /**
     * Table 1.09 publishes standardized metabolizable energy (MESn35) for
     * crystalline amino acids rather than the ordinary ME used in Table 1.01.
     */
    standardizedMetabolizableKcalKg: z.number().optional(),
    netKcalKg: z.number().optional(),
  }),
  aminoAcids: z
    .object({
      /** Source concentration on the ingredient's published basis. */
      totalPct: z.record(z.string(), z.number()).default({}),
      /** Brazilian Tables standardized ileal digestibility coefficient. */
      sidDigestibilityPct: z.record(z.string(), z.number()).default({}),
      /** Explicit source/derived SID concentration used by formulation. */
      sidPct: z.record(z.string(), z.number()).default({}),
    })
    .default({ totalPct: {}, sidDigestibilityPct: {}, sidPct: {} }),
  macroMinerals: z
    .object({
      calciumPct: z.number().optional(),
      totalPhosphorusPct: z.number().optional(),
      availablePhosphorusPct: z.number().optional(),
      sttdPhosphorusDigestibilityPct: z.number().optional(),
      /** Brazilian source concentration (called standardized digestible P / Dig. P). */
      sttdPhosphorusPct: z.number().optional(),
      sodiumPct: z.number().optional(),
      chloridePct: z.number().optional(),
      potassiumPct: z.number().optional(),
      magnesiumPct: z.number().optional(),
    })
    .default({}),
  traceMineralsPpm: z.record(z.string(), z.number()).default({}),
  vitamins: z
    .object({
      vitaminAIuKg: z.number().optional(),
      vitaminDIuKg: z.number().optional(),
      vitaminEIuKg: z.number().optional(),
      vitaminKMgKg: z.number().optional(),
      niacinMgKg: z.number().optional(),
      riboflavinMgKg: z.number().optional(),
      pantothenicAcidMgKg: z.number().optional(),
      vitaminB12McgKg: z.number().optional(),
      totalCholineMgKg: z.number().optional(),
    })
    .default({}),
  constraints: z
    .object({
      minInclusionPct: z.number().optional(),
      maxInclusionPct: z.number().optional(),
      notes: z.array(z.string()).default([]),
    })
    .default({ notes: [] }),
  provenance: z
    .object({
      sourceIngredientName: z.string().optional(),
      sourcePage: z.number().optional(),
      sourceTable: z.string().optional(),
      source: nutrientSourceSchema.optional(),
      nutrientSources: z.record(z.string(), nutrientSourceSchema).default({}),
      notes: z.array(z.string()).default([]),
    })
    .default({ notes: [] }),
});

const ingredientLibrarySchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string(),
  name: z.string(),
  basis: z.object({
    nutrientComposition: z.string(),
    energy: z.string(),
    aminoAcids: z.string(),
    macroMinerals: z.string(),
    traceMinerals: z.string(),
  }),
  source: z.object({
    publisher: z.string(),
    title: z.string(),
    edition: z.string(),
    year: z.number().int(),
    chapter: z.string(),
    doi: z.string(),
    url: z.string().url(),
    companionModel: z
      .object({
        title: z.string(),
        url: z.string().url(),
      })
      .optional(),
  }),
  notes: z.array(z.string()).default([]),
  ingredients: z.array(ingredientSchema),
});

const rawFeedstuffSchema = z.object({
  id: z.string(),
  name: z.string(),
  aliases: z.array(z.string()).default([]),
  category: ingredientSchema.shape.category,
  printedPage: z.number().int(),
  compositionPct: z
    .object({
      dryMatter: z.number().optional(),
      crudeProtein: z.number().optional(),
      starch: z.number().optional(),
      crudeFibre: z.number().optional(),
      etherExtract: z.number().optional(),
      ndf: z.number().optional(),
      adf: z.number().optional(),
      ash: z.number().optional(),
      linoleicAcid: z.number().optional(),
      linolenicAcid: z.number().optional(),
    })
    .default({}),
  swineEnergyKcalKg: z
    .object({
      digestible: z.number().optional(),
      metabolizable: z.number().optional(),
      net: z.number().optional(),
    })
    .default({}),
  macroMineralsPct: z
    .object({
      potassium: z.number().optional(),
      sodium: z.number().optional(),
      chloride: z.number().optional(),
      sulfur: z.number().optional(),
      magnesium: z.number().optional(),
      calcium: z.number().optional(),
      totalPhosphorus: z.number().optional(),
      phytatePhosphorus: z.number().optional(),
      availablePhosphorus: z.number().optional(),
      standardizedDigestiblePhosphorusSwine: z.number().optional(),
    })
    .default({}),
  traceMineralsMgKg: z.record(z.string(), z.number()).default({}),
  digestibleProteinPct: z.number().optional(),
  aminoAcids: z
    .object({
      totalPct: z.record(z.string(), z.number()).default({}),
      sidSwinePct: z.record(z.string(), z.number()).default({}),
      sidSwineDigestibilityPct: z.record(z.string(), z.number()).default({}),
    })
    .default({ totalPct: {}, sidSwinePct: {}, sidSwineDigestibilityPct: {} }),
});

const feedstuffShardSchema = z.object({
  schemaVersion: z.literal(1),
  sourceId: z.literal("brazilian-tables-2024"),
  sourceTable: z.literal("1.01"),
  basis: z.literal("as-fed"),
  ingredients: z.array(rawFeedstuffSchema),
});

export type NutrientValueSource = z.infer<typeof nutrientSourceSchema>;
export type IngredientNutrientRecord = z.infer<typeof ingredientSchema>;
export type IngredientLibrary = z.infer<typeof ingredientLibrarySchema>;

export function loadIngredientLibrary(input: unknown): IngredientLibrary {
  return ingredientLibrarySchema.parse(input);
}

function sourceRecord(table: string, basis: string): NutrientValueSource {
  return {
    publisher: BRAZILIAN_SOURCE.publisher,
    title: BRAZILIAN_SOURCE.title,
    year: BRAZILIAN_SOURCE.year,
    url: BRAZILIAN_SOURCE.url,
    basis,
    priority: "primary",
    note: `Brazilian Tables 2024 ${table}.`,
  };
}

function feedstuffRecord(
  raw: z.infer<typeof rawFeedstuffSchema>,
): IngredientNutrientRecord {
  return ingredientSchema.parse({
    id: raw.id,
    name: raw.name,
    aliases: raw.aliases,
    category: raw.category,
    composition: {
      dryMatterPct: raw.compositionPct.dryMatter,
      crudeProteinPct: raw.compositionPct.crudeProtein,
      digestibleProteinPct: raw.digestibleProteinPct,
      crudeFatPct: raw.compositionPct.etherExtract,
      linoleicAcidPct: raw.compositionPct.linoleicAcid,
      crudeFibrePct: raw.compositionPct.crudeFibre,
      ashPct: raw.compositionPct.ash,
      starchPct: raw.compositionPct.starch,
      neutralDetergentFibrePct: raw.compositionPct.ndf,
      acidDetergentFibrePct: raw.compositionPct.adf,
    },
    energy: {
      digestibleKcalKg: raw.swineEnergyKcalKg.digestible,
      metabolizableKcalKg: raw.swineEnergyKcalKg.metabolizable,
      netKcalKg: raw.swineEnergyKcalKg.net,
    },
    aminoAcids: {
      totalPct: raw.aminoAcids.totalPct,
      sidDigestibilityPct: raw.aminoAcids.sidSwineDigestibilityPct,
      sidPct: raw.aminoAcids.sidSwinePct,
    },
    macroMinerals: {
      calciumPct: raw.macroMineralsPct.calcium,
      totalPhosphorusPct: raw.macroMineralsPct.totalPhosphorus,
      availablePhosphorusPct: raw.macroMineralsPct.availablePhosphorus,
      sttdPhosphorusPct:
        raw.macroMineralsPct.standardizedDigestiblePhosphorusSwine,
      sodiumPct: raw.macroMineralsPct.sodium,
      chloridePct: raw.macroMineralsPct.chloride,
      potassiumPct: raw.macroMineralsPct.potassium,
      magnesiumPct: raw.macroMineralsPct.magnesium,
    },
    traceMineralsPpm: raw.traceMineralsMgKg,
    vitamins: {},
    constraints: {
      notes: [
        "Source-native Brazilian Tables 2024 ingredient. No NRC nutrient values are mixed into this record.",
      ],
    },
    provenance: {
      sourceIngredientName: raw.name,
      sourcePage: raw.printedPage,
      sourceTable: "Table 1.01",
      source: sourceRecord("Table 1.01", "as-fed"),
      nutrientSources: {},
      notes: ["Canonical nutrient source: Brazilian Tables 2024, Table 1.01."],
    },
  });
}

type MineralSourceRow = (typeof mineralSources.ingredients)[number];

function mineralRecord(raw: MineralSourceRow): IngredientNutrientRecord {
  return ingredientSchema.parse({
    id: raw.pigflowIngredientId,
    name: raw.name,
    aliases: [],
    category: "mineral",
    composition: {},
    energy: {},
    aminoAcids: {},
    macroMinerals: {
      calciumPct: "calciumPct" in raw ? raw.calciumPct : undefined,
      totalPhosphorusPct:
        "totalPhosphorusPct" in raw ? raw.totalPhosphorusPct : undefined,
      availablePhosphorusPct:
        "availablePhosphorusPct" in raw ? raw.availablePhosphorusPct : undefined,
      sttdPhosphorusPct:
        "digestiblePhosphorusSwinePct" in raw
          ? raw.digestiblePhosphorusSwinePct
          : undefined,
      sodiumPct: "sodiumPct" in raw ? raw.sodiumPct : undefined,
      chloridePct: "chloridePct" in raw ? raw.chloridePct : undefined,
      magnesiumPct: "magnesiumPct" in raw ? raw.magnesiumPct : undefined,
    },
    traceMineralsPpm: {},
    vitamins: {},
    constraints: {
      notes: [
        ...("mappingNote" in raw && raw.mappingNote ? [raw.mappingNote] : []),
      ],
    },
    provenance: {
      sourceIngredientName: raw.name,
      sourcePage: mineralSources.printedPage,
      sourceTable: "Table 1.10",
      source: sourceRecord("Table 1.10", "as-fed"),
      nutrientSources: {},
      notes: ["Canonical nutrient source: Brazilian Tables 2024, Table 1.10."],
    },
  });
}

type CrystallineRow = (typeof crystallineAminoAcids.ingredients)[number];

const CRYSTALLINE_TARGET: Record<
  string,
  { ingredientId: string; aminoAcid: string; aliases: string[] }
> = {
  "lysine-hcl": {
    ingredientId: "l-lysine-hcl",
    aminoAcid: "lysine",
    aliases: ["lysine HCl"],
  },
  methionine: {
    ingredientId: "dl-methionine",
    aminoAcid: "methionine",
    aliases: ["methionine"],
  },
  threonine: {
    ingredientId: "l-threonine",
    aminoAcid: "threonine",
    aliases: ["threonine"],
  },
  tryptophan: {
    ingredientId: "l-tryptophan",
    aminoAcid: "tryptophan",
    aliases: ["tryptophan"],
  },
  valine: {
    ingredientId: "l-valine",
    aminoAcid: "valine",
    aliases: ["valine"],
  },
  isoleucine: {
    ingredientId: "l-isoleucine",
    aminoAcid: "isoleucine",
    aliases: ["isoleucine"],
  },
};

function crystallineAminoAcidConcentrationPct(raw: CrystallineRow): number {
  if (raw.id !== "lysine-hcl") return 100;

  // Table 1.09 publishes pure lysine at 19.16% N and Lysine-HCl at 13.73% N.
  // Their ratio gives the lysine-equivalent concentration on the table's
  // dry-matter basis.
  const pureLysineNitrogenPct = 19.16;
  return (raw.nitrogenPct / pureLysineNitrogenPct) * 100;
}

function crystallineRecord(raw: CrystallineRow): IngredientNutrientRecord | null {
  const target = CRYSTALLINE_TARGET[raw.id];
  if (!target) return null;

  const concentration = crystallineAminoAcidConcentrationPct(raw);
  const sidConcentration =
    concentration * (raw.standardizedDigestibilityPct / 100);

  return ingredientSchema.parse({
    id: target.ingredientId,
    name: raw.name,
    aliases: target.aliases,
    category: "amino_acid",
    composition: {
      crudeProteinPct: raw.crudeProteinEquivalentPct,
      digestibleProteinPct:
        raw.crudeProteinEquivalentPct *
        (raw.standardizedDigestibilityPct / 100),
    },
    energy: {
      digestibleKcalKg: raw.energyKcalKg.digestible,
      standardizedMetabolizableKcalKg:
        raw.energyKcalKg.standardizedMetabolizable,
      netKcalKg: raw.energyKcalKg.net,
    },
    aminoAcids: {
      totalPct: { [target.aminoAcid]: concentration },
      sidDigestibilityPct: {
        [target.aminoAcid]: raw.standardizedDigestibilityPct,
      },
      sidPct: { [target.aminoAcid]: sidConcentration },
    },
    macroMinerals: {},
    traceMineralsPpm: {},
    vitamins: {},
    constraints: {
      notes: [
        "Table 1.09 is published on a dry-matter basis.",
        "Table 1.09 publishes standardized metabolizable energy (MESn35) for crystalline amino acids; PigFlow stores it separately from ordinary ME.",
        ...("mappingNote" in raw && raw.mappingNote ? [raw.mappingNote] : []),
      ],
    },
    provenance: {
      sourceIngredientName: raw.name,
      sourcePage: crystallineAminoAcids.printedPage,
      sourceTable: "Table 1.09",
      source: sourceRecord("Table 1.09", "dry-matter"),
      nutrientSources: {},
      notes: [
        "Canonical nutrient source: Brazilian Tables 2024, Table 1.09.",
        ...(raw.id === "lysine-hcl"
          ? [
              "Lysine concentration is derived from the Table 1.09 nitrogen ratio of Lysine-HCl to pure lysine; SID concentration then applies the published standardized digestibility.",
            ]
          : []),
      ],
    },
  });
}

const feedstuffRows = [
  ...feedstuffShardSchema.parse(canonicalFeedstuffs01).ingredients,
  ...feedstuffShardSchema.parse(canonicalFeedstuffs02).ingredients,
];

const canonicalIngredients = [
  ...feedstuffRows.map(feedstuffRecord),
  ...mineralSources.ingredients.map(mineralRecord),
  ...crystallineAminoAcids.ingredients
    .map(crystallineRecord)
    .filter((row): row is IngredientNutrientRecord => row !== null),
];

export const INGREDIENT_LIBRARY = loadIngredientLibrary({
  schemaVersion: 1,
  id: "brazilian-tables-2024-swine-ingredient-library",
  name: "Brazilian Tables 2024 swine feed ingredient nutrient library",
  basis: {
    nutrientComposition:
      "Table-specific: Table 1.01 and 1.10 as-fed; Table 1.09 dry-matter",
    energy:
      "kcal/kg; Table 1.09 standardized metabolizable energy is stored separately",
    aminoAcids: "percent; standardized ileal digestibility for swine",
    macroMinerals: "percent",
    traceMinerals: "mg/kg (ppm)",
  },
  source: BRAZILIAN_SOURCE,
  notes: [
    "Brazilian Tables 2024 is the canonical nutrient source for formulation.",
    "NRC, FeedSport and other external ingredient matrices are not blended into canonical ingredient records.",
    "Ingredients without a defensible Brazilian Tables identity match are excluded rather than approximated from another source.",
  ],
  ingredients: canonicalIngredients,
});

/** Standardized ileal digestible concentration for one amino acid. */
export function sidAminoAcidPct(
  ingredient: IngredientNutrientRecord,
  aminoAcid: string,
): number | undefined {
  const explicit = ingredient.aminoAcids.sidPct[aminoAcid];
  if (explicit !== undefined) return explicit;

  const total = ingredient.aminoAcids.totalPct[aminoAcid];
  const digestibility = ingredient.aminoAcids.sidDigestibilityPct[aminoAcid];
  if (total === undefined || digestibility === undefined) return undefined;
  return total * (digestibility / 100);
}

/**
 * Energy coefficient used for the diet's metabolizable-energy equation.
 *
 * Table 1.01 feedstuffs publish ordinary swine ME. Table 1.09 crystalline amino
 * acids publish MESn35 instead; that source value is used only when ordinary ME
 * is not published, and remains separately represented in the ingredient record.
 */
export function metabolizableEnergyKcalKgOf(
  ingredient: IngredientNutrientRecord,
): number | undefined {
  return (
    ingredient.energy.metabolizableKcalKg ??
    ingredient.energy.standardizedMetabolizableKcalKg
  );
}

/**
 * Available phosphorus concentration. Explicit Brazilian values win. A total-P
 * value of exactly zero is a defensible structural zero; other missing values
 * remain unknown.
 */
export function availablePhosphorusPctOf(
  ingredient: IngredientNutrientRecord,
): number | undefined {
  if (ingredient.macroMinerals.availablePhosphorusPct !== undefined) {
    return ingredient.macroMinerals.availablePhosphorusPct;
  }
  return ingredient.macroMinerals.totalPhosphorusPct === 0 ? 0 : undefined;
}

/** Brazilian standardized digestible phosphorus concentration. */
export function sttdPhosphorusPctOf(
  ingredient: IngredientNutrientRecord,
): number | undefined {
  if (ingredient.macroMinerals.sttdPhosphorusPct !== undefined) {
    return ingredient.macroMinerals.sttdPhosphorusPct;
  }
  const total = ingredient.macroMinerals.totalPhosphorusPct;
  if (total === 0) return 0;

  const digestibility = ingredient.macroMinerals.sttdPhosphorusDigestibilityPct;
  if (total === undefined || digestibility === undefined) return undefined;
  return total * (digestibility / 100);
}

export function nutrientValueSource(
  ingredient: IngredientNutrientRecord,
  nutrientPath: string,
): NutrientValueSource | undefined {
  return ingredient.provenance.nutrientSources[nutrientPath];
}

export type FormulationPriorityNutrient =
  | "digestible-protein"
  | "available-phosphorus"
  | "potassium"
  | "linoleic-acid";

export function formulationPriorityNutrients(
  ingredient: IngredientNutrientRecord,
): FormulationPriorityNutrient[] {
  const nutrients: FormulationPriorityNutrient[] = [];
  if ((ingredient.composition.digestibleProteinPct ?? 0) > 0) {
    nutrients.push("digestible-protein");
  }
  if ((ingredient.macroMinerals.availablePhosphorusPct ?? 0) > 0) {
    nutrients.push("available-phosphorus");
  }
  if ((ingredient.macroMinerals.potassiumPct ?? 0) > 0) {
    nutrients.push("potassium");
  }
  if ((ingredient.composition.linoleicAcidPct ?? 0) > 0) {
    nutrients.push("linoleic-acid");
  }
  return nutrients;
}
