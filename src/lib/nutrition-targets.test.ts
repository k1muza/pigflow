import { describe, expect, it } from "vitest";

import { nutritionPhaseAtWeight } from "./nutrition";
import { ratioToDietPct, resolveNutritionTargets } from "./nutrition-targets";

describe("PIC formulation targets", () => {
  it("keeps direct prestarter concentrations direct", () => {
    const phase = nutritionPhaseAtWeight(10);
    const targets = resolveNutritionTargets(phase);

    expect(targets.energy).toEqual({ system: "ME", kcalKg: 3395 });
    expect(targets.aminoAcids.sidLysinePct).toBe(1.42);
    expect(targets.aminoAcids.sidThreoninePct).toBeCloseTo(0.923, 6);
    expect(targets.minerals.sttdPhosphorusPct).toBe(0.45);
  });

  it("converts PIC g/Mcal ME ratios into diet percentages", () => {
    const phase = nutritionPhaseAtWeight(30);
    const targets = resolveNutritionTargets(phase, {
      system: "ME",
      kcalKg: 3300,
    });

    expect(targets.aminoAcids.sidLysinePct).toBeCloseTo(1.1451, 6);
    expect(targets.aminoAcids.sidThreoninePct).toBeCloseTo(
      1.1451 * 0.65,
      6,
    );
    expect(targets.minerals.sttdPhosphorusPct).toBeCloseTo(0.396, 6);
  });

  it("can resolve the same phase on its NE basis", () => {
    const phase = nutritionPhaseAtWeight(30);
    const targets = resolveNutritionTargets(phase, {
      system: "NE",
      kcalKg: 2450,
    });

    expect(targets.aminoAcids.sidLysinePct).toBeCloseTo(1.1613, 6);
    expect(targets.minerals.sttdPhosphorusPct).toBeCloseTo(0.3969, 6);
  });

  it("does not invent energy for ratio-based phases", () => {
    expect(() => resolveNutritionTargets(nutritionPhaseAtWeight(30))).toThrow(
      /provide candidate-diet ME or NE/,
    );
  });

  it("documents the g\/Mcal to percentage conversion", () => {
    expect(ratioToDietPct(3.47, 3300)).toBeCloseTo(1.1451, 6);
  });
});
