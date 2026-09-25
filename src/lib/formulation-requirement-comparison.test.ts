import { describe, expect, it } from "vitest";

import { feedFormulationById } from "./feed-formulations";
import { feedProgrammePhaseById } from "./feed-programmes";
import { compareFormulationToPhase } from "./formulation-requirement-comparison";

describe("formulation requirement comparison", () => {
  it("resolves PIC lysine requirements from PigFlow's calculated formulation ME", () => {
    const formulation = feedFormulationById("pic-corn-soybean-meal");
    const phase = feedProgrammePhaseById("grow-finish-pig", "pic-grow-finish-59-82");

    expect(formulation).toBeDefined();
    expect(phase).toBeDefined();

    const result = compareFormulationToPhase(formulation!, phase!);
    const lysine = result.rows.find((row) => row.id === "sid-lysine");

    expect(lysine).toMatchObject({
      status: "pass",
    });
    expect(lysine?.actual).toBe("0.9288 %");
    expect(lysine?.requirement).toBe("≥ 0.8735 %");
    expect(result.profileBasis).toMatch(/calculated from ingredient library/i);
    expect(result.status).toBe("incomplete");
  });

  it("can fail an exact ingredient inclusion constraint even when other nutrients are incomplete", () => {
    const formulation = feedFormulationById("pic-high-fiber");
    const phase = feedProgrammePhaseById("grow-finish-pig", "pic-grow-finish-23-41");

    const result = compareFormulationToPhase(formulation!, phase!);

    expect(result.rows.find((row) => row.id === "energy-basis")?.status).toBe(
      "incomplete",
    );
    expect(result.rows.find((row) => row.id === "l-lysine-hcl")).toMatchObject({
      status: "fail",
    });
    expect(result.rows.find((row) => row.id === "l-lysine-hcl")?.actual).toBeCloseTo
      ? undefined
      : undefined;
    expect(result.status).toBe("fail");
  });

  it("checks prestarter energy against the calculated diet energy", () => {
    const formulation = feedFormulationById("pic-corn-soybean-meal");
    const phase = feedProgrammePhaseById("nursery-pig", "pic-prestart-weaning-7.5");

    const result = compareFormulationToPhase(formulation!, phase!);

    expect(result.rows.find((row) => row.id === "energy-me")).toMatchObject({
      actual: "3334.0784 kcal/kg",
      requirement: "≥ 3395 kcal/kg",
      status: "fail",
    });
    expect(result.rows.find((row) => row.id === "soybean-meal")?.status).toBe("fail");
  });

  it("does not claim a complete pass when ingredient nutrient records are incomplete", () => {
    const formulation = feedFormulationById("pic-corn-soybean-meal");
    const phase = feedProgrammePhaseById("grow-finish-pig", "pic-grow-finish-59-82");

    const result = compareFormulationToPhase(formulation!, phase!);

    expect(result.incompleteCount).toBeGreaterThan(0);
    expect(result.rows.find((row) => row.id === "zinc")).toMatchObject({
      status: "incomplete",
    });
    expect(result.rows.find((row) => row.id === "vitamin-a")).toMatchObject({
      status: "incomplete",
    });
  });
});
