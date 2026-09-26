import type { PlannerConfig } from "./config";

export type FormulationObjective = PlannerConfig["nutrition"]["formulationObjective"];
export type PerformanceMetric = PlannerConfig["nutrition"]["performanceMetric"];

export type FormulationCandidateEconomics = {
  id: string;
  /** Delivered/manufactured feed cost, not only ingredient cost. */
  feedCostPerKg: number;
  /** Kilograms of feed per kilogram of liveweight gain. */
  feedConversionRatio: number;
  /** Expected liveweight gain per pig per day. */
  averageDailyGainKg: number;
};

export type FormulationCandidateScore = {
  candidateId: string;
  objective: FormulationObjective;
  targetGainKg: number;
  daysInPhase: number;
  feedKg: number;
  feedCost: number;
  feedCostPerKgGain: number;
  facilityCost: number;
  marginalCarcassRevenue: number;
  incomeOverFeedCost: number;
  incomeOverFeedAndFacilityCost: number;
  /**
   * Higher is always better so callers can sort one way regardless of the
   * selected objective. The raw economic measures above remain available for
   * explanation and reporting.
   */
  objectiveScore: number;
};

export type FormulationEconomicsContext = {
  objective: FormulationObjective;
  performanceMetric: PerformanceMetric;
  facilityCostPerPigDay: number;
  salePricePerCarcassKg: number;
  dressingPct: number;
  targetGainKg: number;
};

export function formulationEconomicsContext(
  config: PlannerConfig,
  targetGainKg: number,
): FormulationEconomicsContext {
  return {
    objective: config.nutrition.formulationObjective,
    performanceMetric: config.nutrition.performanceMetric,
    facilityCostPerPigDay: config.nutrition.facilityCostPerPigDay,
    salePricePerCarcassKg: config.finance.salePriceKg,
    dressingPct: config.finance.dressingPct,
    targetGainKg,
  };
}

/**
 * Scores one biologically valid formulation candidate.
 *
 * This does not predict ADG/FCR from nutrient density. That response belongs to
 * a separate, sourced biological response model. This function starts once a candidate has an expected
 * ADG, FCR and feed cost, and puts the farm's economics around those outcomes.
 */
export function scoreFormulationCandidate(
  candidate: FormulationCandidateEconomics,
  context: FormulationEconomicsContext,
): FormulationCandidateScore {
  assertPositive(candidate.feedConversionRatio, "feed conversion ratio");
  assertPositive(candidate.averageDailyGainKg, "average daily gain");
  assertNonNegative(candidate.feedCostPerKg, "feed cost per kg");
  assertNonNegative(context.facilityCostPerPigDay, "facility cost per pig day");
  assertNonNegative(context.salePricePerCarcassKg, "sale price per carcass kg");
  assertNonNegative(context.targetGainKg, "target gain");
  if (context.dressingPct < 0 || context.dressingPct > 100) {
    throw new Error("Dressing percentage must be between 0 and 100.");
  }

  const targetGainKg = context.targetGainKg;
  const daysInPhase = targetGainKg / candidate.averageDailyGainKg;
  const feedKg = targetGainKg * candidate.feedConversionRatio;
  const feedCost = feedKg * candidate.feedCostPerKg;
  const feedCostPerKgGain = candidate.feedCostPerKg * candidate.feedConversionRatio;
  const facilityCost = daysInPhase * context.facilityCostPerPigDay;
  const marginalCarcassRevenue =
    targetGainKg * (context.dressingPct / 100) * context.salePricePerCarcassKg;
  const incomeOverFeedCost = marginalCarcassRevenue - feedCost;
  const incomeOverFeedAndFacilityCost = incomeOverFeedCost - facilityCost;

  let objectiveScore: number;
  switch (context.objective) {
    case "max_performance":
      objectiveScore =
        context.performanceMetric === "adg"
          ? candidate.averageDailyGainKg
          : -candidate.feedConversionRatio;
      break;
    case "min_feed_cost_per_kg_gain":
      objectiveScore = -feedCostPerKgGain;
      break;
    case "max_profit":
      objectiveScore = incomeOverFeedAndFacilityCost;
      break;
  }

  return {
    candidateId: candidate.id,
    objective: context.objective,
    targetGainKg,
    daysInPhase,
    feedKg,
    feedCost,
    feedCostPerKgGain,
    facilityCost,
    marginalCarcassRevenue,
    incomeOverFeedCost,
    incomeOverFeedAndFacilityCost,
    objectiveScore,
  };
}

export function rankFormulationCandidates(
  candidates: readonly FormulationCandidateEconomics[],
  context: FormulationEconomicsContext,
): FormulationCandidateScore[] {
  return candidates
    .map((candidate) => scoreFormulationCandidate(candidate, context))
    .sort((a, b) => b.objectiveScore - a.objectiveScore);
}

function assertPositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive finite number.`);
  }
}

function assertNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative finite number.`);
  }
}
