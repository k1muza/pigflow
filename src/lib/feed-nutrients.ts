import type { NutritionPhase } from "./nutrition";
import {
  INGREDIENT_LIBRARY,
  sidAminoAcidPct,
  sttdPhosphorusPctOf,
  type IngredientNutrientRecord,
} from "./ingredient-nutrients";

export type NutrientGroup =
  | "Energy & protein"
  | "Amino acids"
  | "Macro minerals"
  | "Trace minerals"
  | "Vitamins";

export type FeedNutrient = {
  id: string;
  name: string;
  shortName: string;
  group: NutrientGroup;
  units: readonly string[];
  description: string;
  formulationRole: string;
};

export const FEED_NUTRIENTS: readonly FeedNutrient[] = [
  {
    id: "metabolizable-energy",
    name: "Metabolizable Energy",
    shortName: "ME",
    group: "Energy & protein",
    units: ["kcal/kg"],
    description: "Digestible energy less urinary and gaseous energy losses.",
    formulationRole: "Energy concentration used to evaluate a formulated diet against the selected requirement phase.",
  },
  {
    id: "net-energy",
    name: "Net Energy",
    shortName: "NE",
    group: "Energy & protein",
    units: ["kcal/kg"],
    description: "Metabolizable energy less the heat increment of feeding.",
    formulationRole: "Useful when ingredient heat increment differs, especially with high-fiber diets.",
  },
  {
    id: "crude-protein",
    name: "Crude Protein",
    shortName: "CP",
    group: "Energy & protein",
    units: ["%"],
    description: "Conventional estimate of total dietary protein from nitrogen content.",
    formulationRole: "Used to evaluate dietary protein concentration and amino-acid balance.",
  },
  {
    id: "sid-lysine",
    name: "SID Lysine",
    shortName: "SID Lys",
    group: "Amino acids",
    units: ["%", "g/Mcal ME", "g/Mcal NE"],
    description: "Standardized ileal digestible lysine.",
    formulationRole: "The Brazilian Tables use SID lysine as the reference amino acid for ideal-protein ratios.",
  },
  {
    id: "sid-methionine-cysteine",
    name: "SID Methionine + Cysteine",
    shortName: "SID Met+Cys",
    group: "Amino acids",
    units: ["% of SID Lys"],
    description: "Combined standardized ileal digestible sulfur amino acids.",
    formulationRole: "Ideal-protein ratio relative to SID lysine.",
  },
  {
    id: "sid-threonine",
    name: "SID Threonine",
    shortName: "SID Thr",
    group: "Amino acids",
    units: ["% of SID Lys"],
    description: "Standardized ileal digestible threonine.",
    formulationRole: "Ideal-protein ratio relative to SID lysine.",
  },
  {
    id: "sid-tryptophan",
    name: "SID Tryptophan",
    shortName: "SID Trp",
    group: "Amino acids",
    units: ["% of SID Lys"],
    description: "Standardized ileal digestible tryptophan.",
    formulationRole: "Ideal-protein ratio relative to SID lysine; can materially affect growth rate.",
  },
  {
    id: "sid-valine",
    name: "SID Valine",
    shortName: "SID Val",
    group: "Amino acids",
    units: ["% of SID Lys"],
    description: "Standardized ileal digestible valine.",
    formulationRole: "Ideal-protein ratio relative to SID lysine.",
  },
  {
    id: "sid-isoleucine",
    name: "SID Isoleucine",
    shortName: "SID Ile",
    group: "Amino acids",
    units: ["% of SID Lys"],
    description: "Standardized ileal digestible isoleucine.",
    formulationRole: "Ideal-protein ratio relative to SID lysine.",
  },
  {
    id: "sid-leucine",
    name: "SID Leucine",
    shortName: "SID Leu",
    group: "Amino acids",
    units: ["% of SID Lys"],
    description: "Standardized ileal digestible leucine.",
    formulationRole: "Ideal-protein ratio; excessive leucine can disturb branched-chain amino-acid balance.",
  },
  {
    id: "sid-histidine",
    name: "SID Histidine",
    shortName: "SID His",
    group: "Amino acids",
    units: ["% of SID Lys"],
    description: "Standardized ileal digestible histidine.",
    formulationRole: "Ideal-protein ratio relative to SID lysine.",
  },
  {
    id: "sid-phenylalanine-tyrosine",
    name: "SID Phenylalanine + Tyrosine",
    shortName: "SID Phe+Tyr",
    group: "Amino acids",
    units: ["% of SID Lys"],
    description: "Combined standardized ileal digestible aromatic amino acids.",
    formulationRole: "Ideal-protein ratio relative to SID lysine.",
  },
  {
    id: "calcium",
    name: "Calcium",
    shortName: "Ca",
    group: "Macro minerals",
    units: ["%"],
    description: "Dietary calcium concentration.",
    formulationRole: "Balanced with phosphorus to support bone mineralization and performance.",
  },
  {
    id: "total-phosphorus",
    name: "Total Phosphorus",
    shortName: "P",
    group: "Macro minerals",
    units: ["%"],
    description: "Total phosphorus present in the diet before digestibility adjustment.",
    formulationRole: "Used with calcium for analyzed Ca:P ratio checks.",
  },
  {
    id: "sttd-phosphorus",
    name: "STTD Phosphorus",
    shortName: "STTD P",
    group: "Macro minerals",
    units: ["%", "g/Mcal ME", "g/Mcal NE"],
    description: "Standardized total tract digestible phosphorus.",
    formulationRole: "Standardized digestible phosphorus used in the Brazilian Tables for growing-swine requirements.",
  },
  {
    id: "available-phosphorus",
    name: "Available Phosphorus",
    shortName: "Avail. P",
    group: "Macro minerals",
    units: ["%", "g/Mcal ME", "g/Mcal NE"],
    description: "Estimate of phosphorus biologically available to the pig.",
    formulationRole: "Available-phosphorus requirement retained alongside standardized digestible phosphorus.",
  },
  {
    id: "sodium",
    name: "Sodium",
    shortName: "Na",
    group: "Macro minerals",
    units: ["%"],
    description: "Dietary sodium concentration.",
    formulationRole: "Electrolyte requirement commonly supplied with salt and ingredient sodium.",
  },
  {
    id: "chloride",
    name: "Chloride",
    shortName: "Cl",
    group: "Macro minerals",
    units: ["%"],
    description: "Dietary chloride concentration.",
    formulationRole: "Electrolyte requirement commonly supplied with sodium chloride.",
  },
  ...[
    ["zinc", "Zinc", "Zn"],
    ["iron", "Iron", "Fe"],
    ["manganese", "Manganese", "Mn"],
    ["copper", "Copper", "Cu"],
    ["iodine", "Iodine", "I"],
    ["selenium", "Selenium", "Se"],
  ].map(([id, name, shortName]) => ({
    id,
    name,
    shortName,
    group: "Trace minerals" as const,
    units: ["ppm"],
    description: `${name} trace-mineral concentration.`,
    formulationRole: "Micronutrient target normally supplied through ingredients and/or premix.",
  })),
  ...[
    ["vitamin-a", "Vitamin A", "Vit A", "IU/kg"],
    ["vitamin-d", "Vitamin D", "Vit D", "IU/kg"],
    ["vitamin-e", "Vitamin E", "Vit E", "IU/kg"],
    ["vitamin-k", "Vitamin K", "Vit K", "mg/kg"],
    ["niacin", "Niacin", "Niacin", "mg/kg"],
    ["riboflavin", "Riboflavin", "B2", "mg/kg"],
    ["pantothenic-acid", "Pantothenic Acid", "B5", "mg/kg"],
    ["vitamin-b12", "Vitamin B12", "B12", "mcg/kg"],
    ["choline", "Total Choline", "Choline", "mg/kg"],
  ].map(([id, name, shortName, unit]) => ({
    id,
    name,
    shortName,
    group: "Vitamins" as const,
    units: [unit],
    description: `${name} dietary specification.`,
    formulationRole: "Vitamin target normally delivered through a vitamin-mineral premix and ingredient contribution.",
  })),
];

export function feedNutrientById(id: string): FeedNutrient | undefined {
  return FEED_NUTRIENTS.find((nutrient) => nutrient.id === id);
}

export type NutrientRequirementConstraint = {
  /** Human-readable compact form retained for simple consumers. */
  value: string;
  basis: string;
  minimum?: string;
  target?: string;
  maximum?: string;
};

export type NutrientIngredientAbundance = {
  ingredientId: string;
  ingredientName: string;
  category: IngredientNutrientRecord["category"];
  value: number;
  unit: string;
};

function energyRelativeValue(
  me: number | undefined,
  ne: number | undefined,
): string | undefined {
  const values = [
    me === undefined ? undefined : `${me} g/Mcal ME`,
    ne === undefined ? undefined : `${ne} g/Mcal NE`,
  ].filter((value): value is string => value !== undefined);
  return values.length > 0 ? values.join(" · ") : undefined;
}

function minimum(value: string, basis: string, maximum?: string): NutrientRequirementConstraint {
  return { value, basis, minimum: value, maximum };
}

function target(value: string, basis: string): NutrientRequirementConstraint {
  return { value, basis, target: value };
}

function rangeConstraint(
  min: string,
  max: string,
  basis: string,
): NutrientRequirementConstraint {
  return {
    value: `${min}–${max}`,
    basis,
    minimum: min,
    maximum: max,
  };
}

export function nutrientRequirementValue(
  nutrientId: string,
  phase: NutritionPhase,
): NutrientRequirementConstraint | undefined {
  const r = phase.requirements;
  const ratio = (value: number) =>
    minimum(`${value}%`, "minimum ratio to SID Lys");

  switch (nutrientId) {
    case "metabolizable-energy":
      return r.metabolizableEnergyKcalKg === undefined
        ? undefined
        : target(`${r.metabolizableEnergyKcalKg} kcal/kg`, "dietary energy level");
    case "net-energy":
      return r.netEnergyKcalKg === undefined
        ? undefined
        : target(`${r.netEnergyKcalKg} kcal/kg`, "dietary energy level");
    case "crude-protein":
      return r.practical.crudeProteinMinPct === undefined
        ? undefined
        : minimum(`${r.practical.crudeProteinMinPct}%`, "minimum crude protein");
    case "sid-lysine": {
      const maxLysCp =
        r.practical.sidLysineToCrudeProteinMaxPct === undefined
          ? undefined
          : `${r.practical.sidLysineToCrudeProteinMaxPct}% of crude protein (SID Lys:CP)`;
      if (r.sidLysinePct !== undefined) {
        return minimum(`${r.sidLysinePct}%`, "diet", maxLysCp);
      }
      const value = energyRelativeValue(r.sidLysineGPerMcalME, r.sidLysineGPerMcalNE);
      return value === undefined
        ? undefined
        : minimum(value, "energy-relative requirement", maxLysCp);
    }
    case "sid-methionine-cysteine":
      return ratio(r.aminoAcids.methionineCysteineToLysPct);
    case "sid-threonine":
      return ratio(r.aminoAcids.threonineToLysPct);
    case "sid-tryptophan":
      return ratio(r.aminoAcids.tryptophanToLysPct);
    case "sid-valine":
      return ratio(r.aminoAcids.valineToLysPct);
    case "sid-isoleucine":
      return ratio(r.aminoAcids.isoleucineToLysPct);
    case "sid-leucine":
      return ratio(r.aminoAcids.leucineToLysPct);
    case "sid-histidine":
      return ratio(r.aminoAcids.histidineToLysPct);
    case "sid-phenylalanine-tyrosine":
      return ratio(r.aminoAcids.phenylalanineTyrosineToLysPct);
    case "calcium":
      return r.minerals.calciumPct === undefined
        ? undefined
        : minimum(`${r.minerals.calciumPct}%`, "diet");
    case "sttd-phosphorus": {
      if (r.minerals.sttdPhosphorusPct !== undefined) {
        return minimum(`${r.minerals.sttdPhosphorusPct}%`, "diet");
      }
      const value = energyRelativeValue(
        r.minerals.sttdPhosphorusGPerMcalME,
        r.minerals.sttdPhosphorusGPerMcalNE,
      );
      return value === undefined
        ? undefined
        : minimum(value, "energy-relative requirement");
    }
    case "available-phosphorus": {
      if (r.minerals.availablePhosphorusPct !== undefined) {
        return minimum(`${r.minerals.availablePhosphorusPct}%`, "diet");
      }
      const value = energyRelativeValue(
        r.minerals.availablePhosphorusGPerMcalME,
        r.minerals.availablePhosphorusGPerMcalNE,
      );
      return value === undefined
        ? undefined
        : minimum(value, "energy-relative requirement");
    }
    case "sodium":
      return minimum(`${r.minerals.sodiumPct}%`, "diet");
    case "chloride":
      if (r.minerals.chloridePctRange) {
        return rangeConstraint(
          `${r.minerals.chloridePctRange.min}%`,
          `${r.minerals.chloridePctRange.max}%`,
          "diet range",
        );
      }
      return r.minerals.chloridePct === undefined
        ? undefined
        : minimum(`${r.minerals.chloridePct}%`, "diet");
    case "zinc":
      return target(`${r.traceMinerals.zincPpm} ppm`, "added supplementation");
    case "iron":
      return target(`${r.traceMinerals.ironPpm} ppm`, "added supplementation");
    case "manganese":
      return target(`${r.traceMinerals.manganesePpm} ppm`, "added supplementation");
    case "copper":
      return target(`${r.traceMinerals.copperPpm} ppm`, "added supplementation");
    case "iodine":
      return target(`${r.traceMinerals.iodinePpm} ppm`, "added supplementation");
    case "selenium":
      return target(`${r.traceMinerals.seleniumPpm} ppm`, "added supplementation");
    case "vitamin-a":
      return target(`${r.vitamins.vitaminAIuKg} IU/kg`, "added supplementation");
    case "vitamin-d":
      return target(`${r.vitamins.vitaminDIuKg} IU/kg`, "added supplementation");
    case "vitamin-e":
      return target(`${r.vitamins.vitaminEIuKg} IU/kg`, "added supplementation");
    case "vitamin-k":
      return target(`${r.vitamins.vitaminKMgKg} mg/kg`, "added supplementation");
    case "niacin":
      return target(`${r.vitamins.niacinMgKg} mg/kg`, "added supplementation");
    case "riboflavin":
      return target(`${r.vitamins.riboflavinMgKg} mg/kg`, "added supplementation");
    case "pantothenic-acid":
      return target(`${r.vitamins.pantothenicAcidMgKg} mg/kg`, "added supplementation");
    case "vitamin-b12":
      return target(`${r.vitamins.vitaminB12McgKg} mcg/kg`, "added supplementation");
    case "choline":
      return r.vitamins.totalCholineMgKg === undefined
        ? undefined
        : target(`${r.vitamins.totalCholineMgKg} mg/kg`, "total dietary concentration");
    default:
      return undefined;
  }
}

function ingredientValueForNutrient(
  nutrientId: string,
  ingredient: IngredientNutrientRecord,
): { value: number; unit: string } | undefined {
  const sid = (aminoAcid: string) => sidAminoAcidPct(ingredient, aminoAcid);
  const combinedSid = (...aminoAcids: string[]) => {
    const values = aminoAcids.map(sid);
    return values.every((value) => value !== undefined)
      ? values.reduce((sum, value) => sum + (value ?? 0), 0)
      : undefined;
  };

  let value: number | undefined;
  let unit = "%";

  switch (nutrientId) {
    case "metabolizable-energy":
      value = ingredient.energy.metabolizableKcalKg;
      unit = "kcal/kg";
      break;
    case "net-energy":
      value = ingredient.energy.netKcalKg;
      unit = "kcal/kg";
      break;
    case "crude-protein":
      value = ingredient.composition.crudeProteinPct;
      break;
    case "sid-lysine":
      value = sid("lysine");
      break;
    case "sid-methionine-cysteine":
      value = combinedSid("methionine", "cysteine");
      break;
    case "sid-threonine":
      value = sid("threonine");
      break;
    case "sid-tryptophan":
      value = sid("tryptophan");
      break;
    case "sid-valine":
      value = sid("valine");
      break;
    case "sid-isoleucine":
      value = sid("isoleucine");
      break;
    case "sid-leucine":
      value = sid("leucine");
      break;
    case "sid-histidine":
      value = sid("histidine");
      break;
    case "sid-phenylalanine-tyrosine":
      value = combinedSid("phenylalanine", "tyrosine");
      break;
    case "calcium":
      value = ingredient.macroMinerals.calciumPct;
      break;
    case "total-phosphorus":
      value = ingredient.macroMinerals.totalPhosphorusPct;
      break;
    case "sttd-phosphorus":
      value = sttdPhosphorusPctOf(ingredient);
      break;
    case "available-phosphorus":
      value = ingredient.macroMinerals.availablePhosphorusPct;
      break;
    case "sodium":
      value = ingredient.macroMinerals.sodiumPct;
      break;
    case "chloride":
      value = ingredient.macroMinerals.chloridePct;
      break;
    case "zinc":
    case "iron":
    case "manganese":
    case "copper":
    case "iodine":
    case "selenium":
      value = ingredient.traceMineralsPpm[nutrientId];
      unit = "ppm";
      break;
    case "vitamin-a":
      value = ingredient.vitamins.vitaminAIuKg;
      unit = "IU/kg";
      break;
    case "vitamin-d":
      value = ingredient.vitamins.vitaminDIuKg;
      unit = "IU/kg";
      break;
    case "vitamin-e":
      value = ingredient.vitamins.vitaminEIuKg;
      unit = "IU/kg";
      break;
    case "vitamin-k":
      value = ingredient.vitamins.vitaminKMgKg;
      unit = "mg/kg";
      break;
    case "niacin":
      value = ingredient.vitamins.niacinMgKg;
      unit = "mg/kg";
      break;
    case "riboflavin":
      value = ingredient.vitamins.riboflavinMgKg;
      unit = "mg/kg";
      break;
    case "pantothenic-acid":
      value = ingredient.vitamins.pantothenicAcidMgKg;
      unit = "mg/kg";
      break;
    case "vitamin-b12":
      value = ingredient.vitamins.vitaminB12McgKg;
      unit = "mcg/kg";
      break;
    case "choline":
      value = ingredient.vitamins.totalCholineMgKg;
      unit = "mg/kg";
      break;
    default:
      return undefined;
  }

  return value === undefined || value <= 0 ? undefined : { value, unit };
}

export function abundantIngredientsForNutrient(
  nutrientId: string,
  limit = 6,
): readonly NutrientIngredientAbundance[] {
  return INGREDIENT_LIBRARY.ingredients
    .flatMap((ingredient) => {
      const nutrient = ingredientValueForNutrient(nutrientId, ingredient);
      return nutrient
        ? [{
            ingredientId: ingredient.id,
            ingredientName: ingredient.name,
            category: ingredient.category,
            value: nutrient.value,
            unit: nutrient.unit,
          }]
        : [];
    })
    .sort((a, b) => b.value - a.value)
    .slice(0, Math.max(0, limit));
}
