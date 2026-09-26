import { describe, expect, it } from "vitest";

import { GrowingPig } from "./sim/animals";
import {
  BRAZILIAN_2024_GESTATION_NUTRITION,
  BRAZILIAN_2024_HIGH_GILT_NUTRITION,
  BRAZILIAN_2024_HIGH_GROWTH_NUTRITION,
  BRAZILIAN_2024_LACTATION_NUTRITION,
  BRAZILIAN_2024_STANDARD_GILT_NUTRITION,
  BRAZILIAN_2024_STANDARD_GROWTH_NUTRITION,
  nutritionForGrowthStage,
  nutritionPhaseAtWeight,
  nutritionPhasesAtSourceWeight,
} from "./nutrition";

describe("Brazilian Tables 2024 growing-pig nutrition programmes", () => {
  it("uses the standard-performance mixed-sex programme by default", () => {
    expect(BRAZILIAN_2024_STANDARD_GROWTH_NUTRITION.source).toMatch(
      /Brazilian Tables for Poultry and Swine/,
    );
    expect(BRAZILIAN_2024_STANDARD_GROWTH_NUTRITION.sourceVersion).toBe(
      "5th edition (2024)",
    );
    expect(BRAZILIAN_2024_STANDARD_GROWTH_NUTRITION.phases).toHaveLength(8);
  });

  it("loads the high-performance mixed-sex programme separately", () => {
    expect(BRAZILIAN_2024_HIGH_GROWTH_NUTRITION.performance).toBe("high");
    expect(BRAZILIAN_2024_HIGH_GROWTH_NUTRITION.phases).toHaveLength(8);

    const phase = BRAZILIAN_2024_HIGH_GROWTH_NUTRITION.phases.find(
      (item) => item.sourceTable === "5.41" && item.sourceMinWeightKg === 18,
    );
    expect(phase?.requirements.metabolizableEnergyKcalKg).toBe(3350);
    expect(phase?.requirements.sidLysinePct).toBe(1.232);
  });

  it("loads Brazilian gilt and breeder programmes", () => {
    expect(BRAZILIAN_2024_STANDARD_GILT_NUTRITION.phases).toHaveLength(5);
    expect(BRAZILIAN_2024_STANDARD_GILT_NUTRITION.phases[0]).toMatchObject({
      sourceTable: "5.38",
      sourceWeightRange: "15–25 kg",
      requirements: {
        metabolizableEnergyKcalKg: 3250,
        sidLysinePct: 1.185,
      },
    });

    expect(BRAZILIAN_2024_HIGH_GILT_NUTRITION.phases[0]).toMatchObject({
      sourceTable: "5.36",
      sourceWeightRange: "18–27 kg",
      requirements: {
        metabolizableEnergyKcalKg: 3350,
        sidLysinePct: 1.249,
      },
    });

    expect(BRAZILIAN_2024_GESTATION_NUTRITION.phases).toHaveLength(8);
    expect(BRAZILIAN_2024_GESTATION_NUTRITION.phases[0]).toMatchObject({
      phaseClass: "gestation",
      parity: "nulliparous",
      sourceTable: "6.08",
      sourceWeightRange: "150 kg average body weight",
      requirements: {
        metabolizableEnergyKcalKg: 3100,
        sidLysinePct: 0.583,
      },
    });

    expect(BRAZILIAN_2024_LACTATION_NUTRITION.phases).toHaveLength(6);
    expect(BRAZILIAN_2024_LACTATION_NUTRITION.phases[0]).toMatchObject({
      phaseClass: "lactation",
      parity: "PO1",
      sourceTable: "6.15",
      sourceWeightRange: "185 kg postpartum body weight",
      requirements: {
        metabolizableEnergyKcalKg: 3400,
        sidLysinePct: 1.066,
      },
    });
  });

  it("uses Brazilian pre-starter concentrations directly", () => {
    const phase = nutritionPhaseAtWeight(10);

    expect(phase.sourceTable).toBe("5.32");
    expect(phase.requirements.metabolizableEnergyKcalKg).toBe(3400);
    expect(phase.requirements.netEnergyKcalKg).toBe(2550);
    expect(phase.requirements.sidLysinePct).toBe(1.336);
    expect(phase.requirements.minerals.sttdPhosphorusPct).toBe(0.462);
    expect(phase.requirements.crudeProteinPct).toBe(21.2);
  });

  it("moves through the standard-performance phases by liveweight", () => {
    expect(nutritionPhaseAtWeight(6.1).sourceWeightRange).toBe("4.4–6.2 kg");
    expect(nutritionPhaseAtWeight(8).sourceWeightRange).toBe("6.2–8.4 kg");
    expect(nutritionPhaseAtWeight(17).sourceWeightRange).toBe("8.4–17.9 kg");
    expect(nutritionPhaseAtWeight(18).sourceWeightRange).toBe("16–26 kg");
    expect(nutritionPhaseAtWeight(30).sourceWeightRange).toBe("26–47 kg");
    expect(nutritionPhaseAtWeight(60).sourceWeightRange).toBe("47–74 kg");
    expect(nutritionPhaseAtWeight(90).sourceWeightRange).toBe("74–103 kg");
    expect(nutritionPhaseAtWeight(110).sourceWeightRange).toBe("103–131 kg");
  });

  it("preserves direct SID amino-acid concentrations and ideal-protein ratios", () => {
    const phase = nutritionPhaseAtWeight(30).requirements;

    expect(phase.sidAminoAcidsPct).toMatchObject({
      lysine: 1.038,
      methionineCysteine: 0.623,
      threonine: 0.706,
      tryptophan: 0.208,
      valine: 0.716,
    });
    expect(phase.aminoAcids).toMatchObject({
      methionineCysteineToLysPct: 60,
      threonineToLysPct: 68,
      tryptophanToLysPct: 20,
      valineToLysPct: 69,
    });
  });

  it("keeps published overlap separate from deterministic liveweight lookup", () => {
    const sourceMatches = nutritionPhasesAtSourceWeight(17);
    expect(sourceMatches.map((phase) => phase.sourceTable)).toEqual(["5.32", "5.43"]);

    expect(nutritionPhaseAtWeight(17).sourceTable).toBe("5.32");
    expect(nutritionPhaseAtWeight(17.9).sourceTable).toBe("5.43");
  });

  it("attaches nutrition independently of the farm growth-stage label", () => {
    const attached = nutritionForGrowthStage("weaner", 30);
    expect(attached.growthStage).toBe("weaner");
    expect(attached.phase.sourceTable).toBe("5.43");
    expect(attached.phase.phaseClass).toBe("grower");
  });

  it("is attached directly to a growing pig", () => {
    const pig = new GrowingPig({
      id: "p",
      tag: "p",
      sex: "female",
      birthDay: 0,
      weightKg: 30,
      stage: "grower",
    });

    expect(pig.nutritionRequirements()?.phase.sourceWeightRange).toBe("26–47 kg");
    pig.weightKg = 60;
    expect(pig.nutritionRequirements()?.phase.sourceWeightRange).toBe("47–74 kg");
  });

  it("rejects liveweights outside the loaded Brazilian range", () => {
    expect(() => nutritionPhaseAtWeight(-1)).toThrow(/non-negative finite liveweight/);
    expect(() => nutritionPhaseAtWeight(Number.NaN)).toThrow(/non-negative finite liveweight/);
    expect(() => nutritionPhaseAtWeight(132)).toThrow(/No Brazilian 2024 nutrition phase/);
  });
});
