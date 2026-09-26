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
      "growing-barrows-standard",
      "growing-entire-immunocastrated-males-standard",
      "gestating-gilt-sow",
      "lactating-gilt-sow",
      "lactating-gilt-sow-25c",
      "nursery-pig-high-performance",
      "grow-finish-pig-high-performance",
      "developing-gilt-high-performance",
      "growing-barrows-high-performance",
      "growing-barrows-high-performance-hot",
      "developing-gilt-high-performance-hot",
      "growing-entire-immunocastrated-males-high-performance-hot",
      "grow-finish-pig-high-performance-hot",
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

  it("loads sex-specific Brazilian growing programmes", () => {
    expect(feedProgrammeById("growing-barrows-high-performance")?.phases[0].sourceTable).toBe(
      "5.33",
    );
    expect(feedProgrammeById("growing-barrows-standard")?.phases[0].sourceTable).toBe("5.35");
    expect(feedProgrammeById("developing-gilt-high-performance")?.phases[0].sourceTable).toBe(
      "5.36",
    );
    expect(feedProgrammeById("developing-gilt")?.phases[0].sourceTable).toBe("5.38");
    expect(
      feedProgrammeById("growing-entire-immunocastrated-males-standard")?.phases[0].sourceTable,
    ).toBe("5.39");
  });

  it("loads the Brazilian +5C growing variants without inventing a starter phase", () => {
    const idsAndTables = [
      ["growing-barrows-high-performance-hot", "5.34"],
      ["developing-gilt-high-performance-hot", "5.37"],
      ["growing-entire-immunocastrated-males-high-performance-hot", "5.40"],
      ["grow-finish-pig-high-performance-hot", "5.42"],
    ] as const;

    for (const [id, table] of idsAndTables) {
      const programme = feedProgrammeById(id);
      expect(programme?.phases).toHaveLength(4);
      expect(programme?.phases.every((phase) => phase.sourceTable === table)).toBe(true);
      expect(programme?.phases[0].phaseClass).toBe("grower");
    }
  });

  it("loads Chapter 6 gestation and both lactation temperature programmes", () => {
    const gestation = feedProgrammeById("gestating-gilt-sow");
    const lactation = feedProgrammeById("lactating-gilt-sow");
    const lactation25 = feedProgrammeById("lactating-gilt-sow-25c");

    expect(gestation?.phases).toHaveLength(8);
    expect(gestation?.phases.every((phase) => phase.sourceTable === "6.08")).toBe(true);
    expect(gestation?.phases.every((phase) => phase.phaseClass === "gestation")).toBe(true);

    expect(lactation?.phases).toHaveLength(6);
    expect(lactation?.phases.every((phase) => phase.sourceTable === "6.15")).toBe(true);

    expect(lactation25?.phases).toHaveLength(6);
    expect(lactation25?.phases.every((phase) => phase.sourceTable === "6.16")).toBe(true);
    expect(lactation25?.phases[0].dailyFeedIntakeKg).toBe(5.448);
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
