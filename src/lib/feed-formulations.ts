export type FeedFormulationStrategy = {
  id: string;
  name: string;
  group: "maximum_performance" | "minimum_cost" | "maximum_profit" | "seasonal";
  objective: string;
  description: string;
  exampleSidLysinePct?: number;
  exampleContext?: string;
  sourceSection: string;
  sourceUrl: string;
  featured: boolean;
};

const PIC_MANUAL_URL =
  "https://www.pic.com/wp-content/uploads/sites/3/2021/03/PIC_Nutrition-Guidelines_English-Metric.pdf";

/**
 * PIC publishes formulation strategies and nutrient optimisation examples, not
 * fixed ingredient recipes. The SID lysine values below reproduce Figure A2's
 * 11.5–22.5 kg example and must not be treated as universal specifications.
 */
export const PIC_FORMULATION_STRATEGIES: readonly FeedFormulationStrategy[] = [
  {
    id: "maximum-adg",
    name: "Maximum ADG",
    group: "maximum_performance",
    objective: "Maximize average daily gain",
    description:
      "Select nutrient concentrations for maximum growth rate without using financial return as the objective.",
    exampleSidLysinePct: 1.28,
    exampleContext: "PIC Figure A2 example, 11.5–22.5 kg pigs",
    sourceSection: "Section A — Formulating for Maximum Performance",
    sourceUrl: PIC_MANUAL_URL,
    featured: true,
  },
  {
    id: "best-feed-efficiency",
    name: "Best Feed Efficiency",
    group: "maximum_performance",
    objective: "Optimize feed-to-gain",
    description:
      "Select nutrient concentrations for the best feed efficiency; the optimum may differ from the concentration that maximizes ADG.",
    exampleSidLysinePct: 1.42,
    exampleContext: "PIC Figure A2 example, 11.5–22.5 kg pigs",
    sourceSection: "Section A — Formulating for Maximum Performance",
    sourceUrl: PIC_MANUAL_URL,
    featured: false,
  },
  {
    id: "minimum-feed-cost-per-gain",
    name: "Minimum Feed Cost per Gain",
    group: "minimum_cost",
    objective: "Minimize feed cost per kg of gain",
    description:
      "Minimize feed cost per unit of gain using feed cost and feed conversion, without valuing changes in ADG, pig price, carcass merit, or extra barn days.",
    exampleSidLysinePct: 0.85,
    exampleContext: "PIC Figure A2 example, 11.5–22.5 kg pigs",
    sourceSection: "Section A — Formulating for Minimum Cost",
    sourceUrl: PIC_MANUAL_URL,
    featured: true,
  },
  {
    id: "maximum-iofc",
    name: "Maximum IOFC",
    group: "maximum_profit",
    objective: "Maximize income over feed cost",
    description:
      "Balance diet cost against the market value of weight gain, especially for fixed-time systems.",
    exampleSidLysinePct: 1.34,
    exampleContext: "PIC Figure A2 example, 11.5–22.5 kg pigs",
    sourceSection: "Section A — Formulating for Maximum Profit",
    sourceUrl: PIC_MANUAL_URL,
    featured: true,
  },
  {
    id: "maximum-ioffc",
    name: "Maximum IOFFC",
    group: "maximum_profit",
    objective: "Maximize income over feed and facility cost",
    description:
      "Extend IOFC by charging the diet for pig-space days, making the measure more applicable to fixed-weight systems.",
    exampleSidLysinePct: 1.35,
    exampleContext: "PIC Figure A2 example, 11.5–22.5 kg pigs",
    sourceSection: "Section A — Formulating for Maximum Profit",
    sourceUrl: PIC_MANUAL_URL,
    featured: false,
  },
  {
    id: "maximum-iotc",
    name: "Maximum IOTC",
    group: "maximum_profit",
    objective: "Maximize income over total cost per kg produced",
    description:
      "Evaluate dietary choices against feed and the wider production cost base rather than feed cost alone.",
    exampleSidLysinePct: 1.37,
    exampleContext: "PIC Figure A2 example, 11.5–22.5 kg pigs",
    sourceSection: "Section A — Formulating for Maximum Profit",
    sourceUrl: PIC_MANUAL_URL,
    featured: false,
  },
  {
    id: "seasonal-formulation",
    name: "Seasonal Formulation",
    group: "seasonal",
    objective: "Adjust diets for seasonal performance and market value",
    description:
      "Proactively adjust energy, amino acids and other nutritional strategies when seasonal growth and pig prices change.",
    sourceSection: "Section A — Seasonal Diet Formulation",
    sourceUrl: PIC_MANUAL_URL,
    featured: true,
  },
];

export const PIC_GROW_FINISH_FORMULATION_STEPS = [
  "Determine the optimal SID lysine-to-calorie ratio.",
  "Determine the most economical dietary energy level.",
  "Determine ratios for the other amino acids.",
  "Determine the phosphorus level.",
  "Set calcium, vitamins, trace minerals, salt, and other ingredients.",
] as const;

export function feedFormulationStrategyById(
  id: string,
): FeedFormulationStrategy | undefined {
  return PIC_FORMULATION_STRATEGIES.find((strategy) => strategy.id === id);
}
