import { describe, expect, it } from "vitest";

import {
  BRAZILIAN_2024_HIGH_GROWTH_NUTRITION,
  nutritionPhaseAtWeight,
} from "./nutrition";
import { resolveNutritionTargets } from "./nutrition-targets";

describe("Brazilian Tables formulation targets", () => {
  it("keeps direct pre-starter concentrations direct", () => {
    const phase = nutritionPhaseAtWeight(10);
    const targets = resolveNutritionTargets(phase);

    expect(targets.energy).toEqual({ system: "ME", kcalKg: 3400 });
    expect(targets.aminoAcids.sidLysinePct).toBe(1.336);
    expect(targets.aminoAcids.sidThreoninePct).toBe(0.909);
    expect(targets.minerals.sttdPhosphorusPct).toBe(0.462);
    expect(targets.crudeProteinPct).toBe(21.2);
  });

  it("does not recalculate direct nutrient concentrations when diet energy is supplied", () => {
    const phase = nutritionPhaseAtWeight(30);
    const targets = resolveNutritionTargets(phase, {
      system: "ME",
      kcalKg: 3300,
    });

    expect(targets.energy).toEqual({ system: "ME", kcalKg: 3300 });
    expect(targets.aminoAcids.sidLysinePct).toBe(1.038);
    expect(targets.aminoAcids.sidThreoninePct).toBe(0.706);
    expect(targets.minerals.sttdPhosphorusPct).toBe(0.335);
  });

  it("keeps high-performance requirements distinct from standard performance", () => {
    const phase = BRAZILIAN_2024_HIGH_GROWTH_NUTRITION.phases.find(
      (candidate) => candidate.sourceTable === "5.41" && candidate.sourceMinWeightKg === 27,
    );
    expect(phase).toBeDefined();

    const targets = resolveNutritionTargets(phase!);
    expect(targets.aminoAcids.sidLysinePct).toBe(1.101);
    expect(targets.minerals.sttdPhosphorusPct).toBe(0.352);
    expect(targets.crudeProteinPct).toBe(17.72);
  });
});
