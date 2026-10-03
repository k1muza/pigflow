import { describe, expect, it } from "vitest";

import {
  BRAZILIAN_2024_HIGH_GROWTH_NUTRITION,
  PIC_MATURE_BOAR_NUTRITION,
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

  it("derives PIC mature-boar targets from the selected energy basis", () => {
    const phase = PIC_MATURE_BOAR_NUTRITION.phases[0];

    const me = resolveNutritionTargets(phase, { system: "ME", kcalKg: 3175 });
    expect(me.aminoAcids.sidLysinePct).toBeCloseTo(0.619125, 6);
    expect(me.aminoAcids.sidThreoninePct).toBeCloseTo(0.4581525, 6);
    expect(me.minerals.sttdPhosphorusPct).toBeCloseTo(0.43815, 6);
    expect(me.minerals.availablePhosphorusPct).toBeCloseTo(0.415925, 6);

    const ne = resolveNutritionTargets(phase, { system: "NE", kcalKg: 2381.25 });
    expect(ne.aminoAcids.sidLysinePct).toBeCloseTo(0.62865, 6);
    expect(ne.aminoAcids.sidThreoninePct).toBeCloseTo(0.465201, 6);
    expect(ne.minerals.sttdPhosphorusPct).toBeCloseTo(0.44529375, 6);
    expect(ne.minerals.availablePhosphorusPct).toBeCloseTo(0.4238625, 6);

    expect(me.crudeProteinPct).toBeUndefined();
    expect(me.potassiumPct).toBeUndefined();
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
