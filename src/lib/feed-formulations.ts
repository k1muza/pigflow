export type FormulationIngredient = {
  ingredientId: string;
  sourceName: string;
  inclusionPct: number;
};

export type FormulationNutrientProfile = {
  basis: string;
  metabolizableEnergyKcalKg: number;
  netEnergyKcalKg: number;
  sidLysinePct: number;
};

export type FormulationRequirementTarget = {
  programmeId: string;
  phaseId: string;
  provenance: "source" | "pigflow";
  note?: string;
};

export type FeedFormulation = {
  id: string;
  name: string;
  description: string;
  sourceTable: string;
  sourcePage: number;
  sourceUrl: string;
  ingredientDatabase: string;
  reportedTotalPct: number;
  ingredients: readonly FormulationIngredient[];
  nutrientProfiles: readonly FormulationNutrientProfile[];
  requirementTarget?: FormulationRequirementTarget;
  featured: boolean;
};

const PIC_MANUAL_URL =
  "https://www.pic.com/wp-content/uploads/sites/3/2021/03/PIC_Nutrition-Guidelines_English-Metric.pdf";

const CORN_SOY_INGREDIENTS: readonly FormulationIngredient[] = [
  { ingredientId: "corn-yellow-dent", sourceName: "Corn, yellow", inclusionPct: 70.99 },
  {
    ingredientId: "soybean-meal-dehulled-solvent-extracted",
    sourceName: "Soybean meal, solvent extracted, crude fibre <4%, crude protein <48%",
    inclusionPct: 25.19,
  },
  { ingredientId: "corn-oil", sourceName: "Corn oil", inclusionPct: 1.0 },
  { ingredientId: "calcium-carbonate", sourceName: "Calcium carbonate", inclusionPct: 0.95 },
  { ingredientId: "monocalcium-phosphate", sourceName: "Monocalcium phosphate", inclusionPct: 0.78 },
  { ingredientId: "sodium-chloride", sourceName: "Salt (NaCl)", inclusionPct: 0.37 },
  { ingredientId: "l-lysine-hcl", sourceName: "L-Lys HCl", inclusionPct: 0.17 },
  { ingredientId: "dl-methionine", sourceName: "DL-Methionine", inclusionPct: 0.04 },
  { ingredientId: "l-threonine", sourceName: "L-Threonine", inclusionPct: 0.02 },
  {
    ingredientId: "vitamin-trace-mineral-premix",
    sourceName: "Vitamin and trace mineral premix",
    inclusionPct: 0.5,
  },
];

export const PIC_EXAMPLE_FORMULATIONS: readonly FeedFormulation[] = [
  {
    id: "pic-corn-soybean-meal",
    name: "PIC Corn–Soybean Meal Diet",
    description:
      "PIC reference corn-soybean meal formulation used to demonstrate ingredient-database and energy-system effects.",
    sourceTable: "Tables B1 and B2",
    sourcePage: 14,
    sourceUrl: PIC_MANUAL_URL,
    ingredientDatabase: "NRC 2012",
    reportedTotalPct: 100,
    ingredients: CORN_SOY_INGREDIENTS,
    nutrientProfiles: [
      {
        basis: "NRC 2012",
        metabolizableEnergyKcalKg: 3342,
        netEnergyKcalKg: 2515,
        sidLysinePct: 0.93,
      },
      {
        basis: "CVB 2008 — same ingredient ratios",
        metabolizableEnergyKcalKg: 3232,
        netEnergyKcalKg: 2414,
        sidLysinePct: 0.91,
      },
    ],
    featured: true,
  },
  {
    id: "pic-high-fiber",
    name: "PIC High-Fiber Ingredient Diet",
    description:
      "PIC high-fiber example formulated to the same ME and SID lysine as the corn-soy diet while producing lower NE.",
    sourceTable: "Table B2",
    sourcePage: 15,
    sourceUrl: PIC_MANUAL_URL,
    ingredientDatabase: "NRC 2012",
    reportedTotalPct: 100,
    ingredients: [
      { ingredientId: "corn-yellow-dent", sourceName: "Corn, yellow", inclusionPct: 37.48 },
      { ingredientId: "corn-ddgs-low-oil", sourceName: "Corn DDGS, <4% oil", inclusionPct: 30.0 },
      { ingredientId: "wheat-middlings", sourceName: "Wheat middlings", inclusionPct: 19.0 },
      {
        ingredientId: "soybean-meal-dehulled-solvent-extracted",
        sourceName: "Soybean meal, solvent extracted, crude fibre <4%, crude protein <48%",
        inclusionPct: 7.11,
      },
      { ingredientId: "corn-oil", sourceName: "Corn oil", inclusionPct: 3.52 },
      { ingredientId: "calcium-carbonate", sourceName: "Calcium carbonate", inclusionPct: 1.28 },
      { ingredientId: "sodium-chloride", sourceName: "Salt (NaCl)", inclusionPct: 0.39 },
      { ingredientId: "l-lysine-hcl", sourceName: "L-Lys HCl", inclusionPct: 0.57 },
      { ingredientId: "l-threonine", sourceName: "L-Threonine", inclusionPct: 0.1 },
      { ingredientId: "l-tryptophan", sourceName: "L-Tryptophan", inclusionPct: 0.04 },
      { ingredientId: "dl-methionine", sourceName: "DL-Methionine", inclusionPct: 0.03 },
      {
        ingredientId: "vitamin-trace-mineral-premix",
        sourceName: "Vitamin and trace mineral premix",
        inclusionPct: 0.5,
      },
    ],
    nutrientProfiles: [
      {
        basis: "NRC 2012",
        metabolizableEnergyKcalKg: 3342,
        netEnergyKcalKg: 2452,
        sidLysinePct: 0.93,
      },
    ],
    featured: true,
  },
];

export function feedFormulationById(id: string): FeedFormulation | undefined {
  return PIC_EXAMPLE_FORMULATIONS.find((formulation) => formulation.id === id);
}
