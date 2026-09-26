import { describe, expect, it } from "vitest";

import {
  rankFormulationCandidates,
  scoreFormulationCandidate,
  type FormulationEconomicsContext,
} from "./nutrition-economics";

const base: FormulationEconomicsContext = {
  objective: "max_profit",
  performanceMetric: "adg",
  facilityCostPerPigDay: 0.2,
  salePricePerCarcassKg: 3.5,
  dressingPct: 70,
  targetGainKg: 20,
};

describe("formulation economics", () => {
  const cheaperSlower = {
    id: "cheap",
    feedCostPerKg: 0.39,
    feedConversionRatio: 2.1,
    averageDailyGainKg: 0.75,
  };
  const dearerFaster = {
    id: "fast",
    feedCostPerKg: 0.43,
    feedConversionRatio: 1.95,
    averageDailyGainKg: 0.8,
  };

  it("separates feed cost, facility cost and marginal revenue", () => {
    const score = scoreFormulationCandidate(dearerFaster, base);
    expect(score.feedCostPerKgGain).toBeCloseTo(0.8385, 6);
    expect(score.daysInPhase).toBeCloseTo(25, 6);
    expect(score.facilityCost).toBeCloseTo(5, 6);
    expect(score.marginalCarcassRevenue).toBeCloseTo(49, 6);
    expect(score.incomeOverFeedAndFacilityCost).toBeCloseTo(
      score.marginalCarcassRevenue - score.feedCost - score.facilityCost,
      9,
    );
  });

  it("minimum feed cost per kg gain can prefer a different diet from maximum performance", () => {
    const leastCost = rankFormulationCandidates([cheaperSlower, dearerFaster], {
      ...base,
      objective: "min_feed_cost_per_kg_gain",
    });
    expect(leastCost[0].candidateId).toBe("cheap");

    const performance = rankFormulationCandidates([cheaperSlower, dearerFaster], {
      ...base,
      objective: "max_performance",
      performanceMetric: "adg",
    });
    expect(performance[0].candidateId).toBe("fast");
  });

  it("facility-day cost is part of the maximum-profit decision", () => {
    const noFacility = rankFormulationCandidates([cheaperSlower, dearerFaster], {
      ...base,
      objective: "max_profit",
      facilityCostPerPigDay: 0,
    });
    expect(noFacility[0].candidateId).toBe("cheap");

    const highFacility = rankFormulationCandidates([cheaperSlower, dearerFaster], {
      ...base,
      objective: "max_profit",
      facilityCostPerPigDay: 1,
    });
    expect(highFacility[0].candidateId).toBe("fast");
  });

  it("rejects impossible biological candidate outputs", () => {
    expect(() =>
      scoreFormulationCandidate(
        { ...cheaperSlower, averageDailyGainKg: 0 },
        base,
      ),
    ).toThrow(/average daily gain/);
  });
});
