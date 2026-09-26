import { describe, expect, it } from "vitest";

import {
  FEED_PROGRAMMES,
  feedProgrammeById,
  feedProgrammePhaseById,
} from "./feed-programmes";

describe("feed programme catalogue", () => {
  it("contains only programmes backed by extracted Brazilian Tables data", () => {
    expect(FEED_PROGRAMMES.map((programme) => programme.id)).toEqual([
      "nursery-pig",
      "grow-finish-pig",
      "developing-gilt",
      "gestating-gilt-sow",
      "lactating-gilt-sow",
      "nursery-pig-high-performance",
      "grow-finish-pig-high-performance",
      "developing-gilt-high-performance",
    ]);
    expect(FEED_PROGRAMMES.every((programme) => programme.status === "loaded")).toBe(true);
    expect(feedProgrammeById("mature-boar")).toBeUndefined();
    expect(feedProgrammeById("weaned-sow")).toBeUndefined();
  });

  it("splits Brazilian growing phases by source stage", () => {
    const nursery = feedProgrammeById("nursery-pig");
    const growFinish = feedProgrammeById("grow-finish-pig");

    expect(nursery?.phases).toHaveLength(4);
    expect(
      nursery?.phases.every(
        (phase) => phase.phaseClass === "pre-starter" || phase.phaseClass === "starter",
      ),
    ).toBe(true);

    expect(growFinish?.phases).toHaveLength(4);
    expect(
      growFinish?.phases.every(
        (phase) => phase.phaseClass === "grower" || phase.phaseClass === "finisher",
      ),
    ).toBe(true);
  });

  it("loads developing gilt requirements from Brazilian Tables 5.38 and 5.36", () => {
    const standard = feedProgrammeById("developing-gilt");
    const high = feedProgrammeById("developing-gilt-high-performance");

    expect(standard?.phases).toHaveLength(5);
    expect(standard?.phases.every((phase) => phase.sourceTable === "5.38")).toBe(true);
    expect(high?.phases).toHaveLength(5);
    expect(high?.phases.every((phase) => phase.sourceTable === "5.36")).toBe(true);
  });

  it("loads Chapter 6 gestation and lactation programmes", () => {
    const gestation = feedProgrammeById("gestating-gilt-sow");
    const lactation = feedProgrammeById("lactating-gilt-sow");

    expect(gestation?.phases).toHaveLength(8);
    expect(gestation?.phases.every((phase) => phase.sourceTable === "6.08")).toBe(true);
    expect(gestation?.phases.every((phase) => phase.phaseClass === "gestation")).toBe(true);

    expect(lactation?.phases).toHaveLength(6);
    expect(lactation?.phases.every((phase) => phase.sourceTable === "6.15")).toBe(true);
    expect(lactation?.phases.every((phase) => phase.phaseClass === "lactation")).toBe(true);
  });

  it("loads high-performance mixed-sex programme URLs separately", () => {
    expect(feedProgrammeById("nursery-pig-high-performance")?.sourceProgramme?.performance).toBe(
      "high",
    );
    expect(
      feedProgrammeById("grow-finish-pig-high-performance")?.sourceProgramme?.performance,
    ).toBe("high");
  });

  it("resolves phases only inside their owning programme URL", () => {
    const nurseryPhase = feedProgrammeById("nursery-pig")?.phases[0];
    expect(nurseryPhase).toBeDefined();
    expect(feedProgrammePhaseById("nursery-pig", nurseryPhase!.id)).toBeDefined();
    expect(feedProgrammePhaseById("grow-finish-pig", nurseryPhase!.id)).toBeUndefined();
  });
});
