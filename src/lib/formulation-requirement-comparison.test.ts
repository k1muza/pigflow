import { describe, expect, it } from "vitest";

import { feedFormulationById } from "./feed-formulations";
import { feedProgrammePhaseById } from "./feed-programmes";
import { compareFormulationToPhase } from "./formulation-requirement-comparison";

describe("formulation requirement comparison", () => {
  it("uses the formulation's reported ME and NE to resolve energy-relative PIC lysine targets", () => {
    const formulation = feedFormulationById("pic-corn-soybean-meal");
    const phase = feedProgrammePhaseById("grow-finish-pig", "pic-grow-finish-59-82");

    expect(formulation).toBeDefined();
    expect(phase).toBeDefined();

    const result = compareFormulationToPhase(formulation!, phase!);
    const me = result.rows.find((row) => row.id === "sid-lys-me");
    const ne = result.rows.find((row) => row.id === "sid-lys-ne");

    expect(me).toMatchObject({
      actual: "0.93%",
      requirement: "≥ 0.8756%",
      status: "pass",
    });
    expect(ne).toMatchObject({
      actual: "0.93%",
      requirement: "≥ 0.8903%",
      status: "pass",
    });
    expect(result.status).toBe("incomplete");
  });

  it("flags a formulation that does not meet the selected PIC phase", () => {
    const formulation = feedFormulationById("pic-high-fiber");
    const phase = feedProgrammePhaseById("grow-finish-pig", "pic-grow-finish-23-41");

    const result = compareFormulationToPhase(formulation!, phase!);

    expect(result.rows.find((row) => row.id === "sid-lys-me")?.status).toBe("fail");
    expect(result.rows.find((row) => row.id === "sid-lys-ne")?.status).toBe("fail");
    expect(result.rows.find((row) => row.id === "l-lysine-hcl")).toMatchObject({
      actual: "0.57%",
      requirement: "≤ 0.45%",
      status: "fail",
    });
    expect(result.status).toBe("fail");
  });

  it("checks direct prestarter energy targets when comparing to a prestarter phase", () => {
    const formulation = feedFormulationById("pic-corn-soybean-meal");
    const phase = feedProgrammePhaseById("nursery-pig", "pic-prestart-weaning-7.5");

    const result = compareFormulationToPhase(formulation!, phase!);

    expect(result.rows.find((row) => row.id === "me")).toMatchObject({
      actual: "3,342 kcal/kg",
      requirement: "≥ 3,395 kcal/kg",
      status: "fail",
    });
    expect(result.rows.find((row) => row.id === "ne")).toMatchObject({
      actual: "2,515 kcal/kg",
      requirement: "≥ 2,545 kcal/kg",
      status: "fail",
    });
    expect(result.rows.find((row) => row.id === "soybean-meal")?.status).toBe("fail");
  });

  it("does not claim a complete pass when the source profile omits required nutrients", () => {
    const formulation = feedFormulationById("pic-corn-soybean-meal");
    const phase = feedProgrammePhaseById("grow-finish-pig", "pic-grow-finish-59-82");

    const result = compareFormulationToPhase(formulation!, phase!);

    expect(result.incompleteCount).toBeGreaterThan(0);
    expect(result.rows.find((row) => row.id === "sid-threonine")).toMatchObject({
      status: "incomplete",
    });
    expect(result.rows.find((row) => row.id === "zinc")).toMatchObject({
      status: "incomplete",
    });
    expect(result.rows.find((row) => row.id === "vitamin-a")).toMatchObject({
      status: "incomplete",
    });
  });
});
