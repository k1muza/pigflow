import { describe, expect, it } from "vitest";

import {
  FEED_PROGRAMMES,
  feedProgrammeById,
  feedProgrammePhaseById,
} from "./feed-programmes";

describe("feed programme catalogue", () => {
  it("keeps breeder placeholders and exposes both Brazilian growing-pig performance tracks", () => {
    expect(FEED_PROGRAMMES.map((programme) => programme.id)).toEqual([
      "mature-boar",
      "developing-gilt",
      "gestating-gilt-sow",
      "lactating-gilt-sow",
      "weaned-sow",
      "nursery-pig",
      "grow-finish-pig",
      "nursery-pig-high-performance",
      "grow-finish-pig-high-performance",
    ]);
  });

  it("splits Brazilian phases by source stage rather than a PIC liveweight boundary", () => {
    const nursery = feedProgrammeById("nursery-pig");
    const growFinish = feedProgrammeById("grow-finish-pig");

    expect(nursery?.status).toBe("loaded");
    expect(nursery?.phases).toHaveLength(4);
    expect(
      nursery?.phases.every(
        (phase) => phase.phaseClass === "pre-starter" || phase.phaseClass === "starter",
      ),
    ).toBe(true);

    expect(growFinish?.status).toBe("loaded");
    expect(growFinish?.phases).toHaveLength(4);
    expect(
      growFinish?.phases.every(
        (phase) => phase.phaseClass === "grower" || phase.phaseClass === "finisher",
      ),
    ).toBe(true);
  });

  it("loads high-performance programme URLs separately", () => {
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
