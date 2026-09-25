import { describe, expect, it } from "vitest";

import {
  PIC_GROWTH_NUTRITION_2021,
  nutritionForGrowthStage,
  nutritionPhaseAtWeight,
} from "./nutrition";

describe("PIC growing-pig nutrition programme", () => {
  it("keeps the source and version with the extracted requirements", () => {
    expect(PIC_GROWTH_NUTRITION_2021.source).toBe("PIC Nutrition and Feeding Guidelines");
    expect(PIC_GROWTH_NUTRITION_2021.sourceVersion).toBe("Metric Version 2021.04.14");
    expect(PIC_GROWTH_NUTRITION_2021.phases).toHaveLength(10);
  });

  it("uses the PIC prestarter specifications through 11.5 kg", () => {
    expect(nutritionPhaseAtWeight(6).id).toBe("pic-prestart-weaning-7.5");
    expect(nutritionPhaseAtWeight(7.5).id).toBe("pic-prestart-7.5-11.5");

    const phase = nutritionPhaseAtWeight(10);
    expect(phase.requirements.netEnergyKcalKg).toBe(2545);
    expect(phase.requirements.metabolizableEnergyKcalKg).toBe(3395);
    expect(phase.requirements.sidLysinePct).toBe(1.42);
    expect(phase.requirements.minerals.sttdPhosphorusPct).toBe(0.45);
  });

  it("moves through late-nursery and grow-finish requirements by liveweight", () => {
    expect(nutritionPhaseAtWeight(11.5).id).toBe("pic-late-nursery-11-23");
    expect(nutritionPhaseAtWeight(23).id).toBe("pic-grow-finish-23-41");
    expect(nutritionPhaseAtWeight(41).id).toBe("pic-grow-finish-41-59");
    expect(nutritionPhaseAtWeight(59).id).toBe("pic-grow-finish-59-82");
    expect(nutritionPhaseAtWeight(82).id).toBe("pic-grow-finish-82-104");
    expect(nutritionPhaseAtWeight(104).id).toBe("pic-grow-finish-104-market");
  });

  it("preserves the full PIC nutrient rows, not only lysine and phosphorus", () => {
    const phase = nutritionPhaseAtWeight(30).requirements;
    expect(phase.sidLysineGPerMcalNE).toBe(4.74);
    expect(phase.sidLysineGPerMcalME).toBe(3.47);
    expect(phase.minerals.sttdPhosphorusGPerMcalNE).toBe(1.62);
    expect(phase.minerals.sttdPhosphorusGPerMcalME).toBe(1.2);
    expect(phase.traceMinerals).toEqual({
      zincPpm: 111,
      ironPpm: 111,
      manganesePpm: 43,
      copperPpm: 15,
      iodinePpm: 0.55,
      seleniumPpm: 0.3,
    });
    expect(phase.vitamins.vitaminAIuKg).toBe(4250);
    expect(phase.vitamins.vitaminB12McgKg).toBe(33);
  });

  it("keeps source-table overlap separate from the operational lookup", () => {
    const sourceMatches = PIC_GROWTH_NUTRITION_2021.phases.filter(
      (phase) =>
        phase.variant === "standard" &&
        11.25 >= phase.sourceMinWeightKg &&
        (phase.sourceMaxWeightKg === null || 11.25 < phase.sourceMaxWeightKg),
    );
    expect(sourceMatches.map((phase) => phase.id)).toEqual([
      "pic-prestart-7.5-11.5",
      "pic-late-nursery-11-23",
    ]);
    expect(nutritionPhaseAtWeight(11.25).id).toBe("pic-prestart-7.5-11.5");
  });

  it("preserves PIC's prestarter practical formulation constraints", () => {
    const phase = nutritionPhaseAtWeight(6).requirements;
    expect(phase.practical.soybeanMealMaxPct).toBe(20);
    expect(phase.practical.highlyDigestibleProteinPct).toEqual({ min: 5, max: 10 });
    expect(phase.practical.highlyDigestibleCarbohydratePct).toBe(15);
    expect(phase.minerals.chloridePctRange).toEqual({ min: 0.35, max: 0.4 });
  });

  it("stores special 104 kg-to-market source variants without selecting them by default", () => {
    const standard = nutritionPhaseAtWeight(110);
    expect(standard.id).toBe("pic-grow-finish-104-market");
    const variants = PIC_GROWTH_NUTRITION_2021.phases.filter(
      (phase) => phase.sourceMinWeightKg === 104,
    );
    expect(variants.map((phase) => phase.variant)).toEqual([
      "standard",
      "ractopamine_lt_21d",
      "ractopamine_gt_21d",
    ]);
  });

  it("attaches a dietary phase without redefining the farm's growth stage", () => {
    // PigFlow currently lets stage thresholds be configured. Nutrition follows
    // liveweight independently, so a pig can still be a weaner while eating a
    // later PIC phase.
    const attached = nutritionForGrowthStage("weaner", 25);
    expect(attached.growthStage).toBe("weaner");
    expect(attached.phase.id).toBe("pic-grow-finish-23-41");
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

    expect(pig.nutritionRequirements()?.phase.id).toBe("pic-grow-finish-23-41");
    pig.weightKg = 60;
    expect(pig.nutritionRequirements()?.phase.id).toBe("pic-grow-finish-59-82");
  });

  it("rejects impossible liveweights instead of silently choosing a phase", () => {
    expect(() => nutritionPhaseAtWeight(-1)).toThrow(/non-negative finite liveweight/);
    expect(() => nutritionPhaseAtWeight(Number.NaN)).toThrow(/non-negative finite liveweight/);
  });
});
