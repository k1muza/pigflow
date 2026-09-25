import type { NutritionPhase } from "./nutrition";

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
    formulationRole: "Energy basis used by PIC for nutrient-to-calorie ratios and diet comparisons.",
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
    formulationRole: "Used as a practical minimum and as the denominator for PIC's SID Lys:CP limit.",
  },
  {
    id: "sid-lysine",
    name: "SID Lysine",
    shortName: "SID Lys",
    group: "Amino acids",
    units: ["%", "g/Mcal ME", "g/Mcal NE"],
    description: "Standardized ileal digestible lysine.",
    formulationRole: "PIC uses SID lysine as the reference amino acid and sets other amino acids relative to it.",
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
    formulationRole: "PIC's preferred digestible phosphorus expression for formulation.",
  },
  {
    id: "available-phosphorus",
    name: "Available Phosphorus",
    shortName: "Avail. P",
    group: "Macro minerals",
    units: ["%", "g/Mcal ME", "g/Mcal NE"],
    description: "Estimate of phosphorus biologically available to the pig.",
    formulationRole: "Alternative phosphorus expression retained in PIC specification tables.",
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

export function nutrientRequirementValue(
  nutrientId: string,
  phase: NutritionPhase,
): { value: string; basis: string } | undefined {
  const r = phase.requirements;
  const ratio = (value: number) => ({ value: `${value}%`, basis: "ratio to SID Lys" });
  switch (nutrientId) {
    case "metabolizable-energy":
      return r.metabolizableEnergyKcalKg === undefined
        ? undefined
        : { value: `${r.metabolizableEnergyKcalKg} kcal/kg`, basis: "diet" };
    case "net-energy":
      return r.netEnergyKcalKg === undefined
        ? undefined
        : { value: `${r.netEnergyKcalKg} kcal/kg`, basis: "diet" };
    case "crude-protein":
      return r.practical.crudeProteinMinPct === undefined
        ? undefined
        : { value: `${r.practical.crudeProteinMinPct}%`, basis: "minimum" };
    case "sid-lysine":
      if (r.sidLysinePct !== undefined) return { value: `${r.sidLysinePct}%`, basis: "diet" };
      if (r.sidLysineGPerMcalME !== undefined) {
        return { value: `${r.sidLysineGPerMcalME} g/Mcal ME`, basis: "energy-relative" };
      }
      if (r.sidLysineGPerMcalNE !== undefined) {
        return { value: `${r.sidLysineGPerMcalNE} g/Mcal NE`, basis: "energy-relative" };
      }
      return undefined;
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
        : { value: `${r.minerals.calciumPct}%`, basis: "minimum" };
    case "sttd-phosphorus":
      if (r.minerals.sttdPhosphorusPct !== undefined) {
        return { value: `${r.minerals.sttdPhosphorusPct}%`, basis: "diet" };
      }
      if (r.minerals.sttdPhosphorusGPerMcalME !== undefined) {
        return {
          value: `${r.minerals.sttdPhosphorusGPerMcalME} g/Mcal ME`,
          basis: "energy-relative",
        };
      }
      return undefined;
    case "available-phosphorus":
      if (r.minerals.availablePhosphorusPct !== undefined) {
        return { value: `${r.minerals.availablePhosphorusPct}%`, basis: "diet" };
      }
      if (r.minerals.availablePhosphorusGPerMcalME !== undefined) {
        return {
          value: `${r.minerals.availablePhosphorusGPerMcalME} g/Mcal ME`,
          basis: "energy-relative",
        };
      }
      return undefined;
    case "sodium":
      return { value: `${r.minerals.sodiumPct}%`, basis: "diet" };
    case "chloride":
      if (r.minerals.chloridePct !== undefined) {
        return { value: `${r.minerals.chloridePct}%`, basis: "diet" };
      }
      if (r.minerals.chloridePctRange) {
        return {
          value: `${r.minerals.chloridePctRange.min}–${r.minerals.chloridePctRange.max}%`,
          basis: "range",
        };
      }
      return undefined;
    case "zinc":
      return { value: `${r.traceMinerals.zincPpm} ppm`, basis: "diet" };
    case "iron":
      return { value: `${r.traceMinerals.ironPpm} ppm`, basis: "diet" };
    case "manganese":
      return { value: `${r.traceMinerals.manganesePpm} ppm`, basis: "diet" };
    case "copper":
      return { value: `${r.traceMinerals.copperPpm} ppm`, basis: "diet" };
    case "iodine":
      return { value: `${r.traceMinerals.iodinePpm} ppm`, basis: "diet" };
    case "selenium":
      return { value: `${r.traceMinerals.seleniumPpm} ppm`, basis: "diet" };
    case "vitamin-a":
      return { value: `${r.vitamins.vitaminAIuKg} IU/kg`, basis: "diet" };
    case "vitamin-d":
      return { value: `${r.vitamins.vitaminDIuKg} IU/kg`, basis: "diet" };
    case "vitamin-e":
      return { value: `${r.vitamins.vitaminEIuKg} IU/kg`, basis: "diet" };
    case "vitamin-k":
      return { value: `${r.vitamins.vitaminKMgKg} mg/kg`, basis: "diet" };
    case "niacin":
      return { value: `${r.vitamins.niacinMgKg} mg/kg`, basis: "diet" };
    case "riboflavin":
      return { value: `${r.vitamins.riboflavinMgKg} mg/kg`, basis: "diet" };
    case "pantothenic-acid":
      return { value: `${r.vitamins.pantothenicAcidMgKg} mg/kg`, basis: "diet" };
    case "vitamin-b12":
      return { value: `${r.vitamins.vitaminB12McgKg} mcg/kg`, basis: "diet" };
    case "choline":
      return r.vitamins.totalCholineMgKg === undefined
        ? undefined
        : { value: `${r.vitamins.totalCholineMgKg} mg/kg`, basis: "diet" };
    default:
      return undefined;
  }
}
