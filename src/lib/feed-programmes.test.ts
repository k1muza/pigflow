import { describe, expect, it } from "vitest";

import {
  FEED_PROGRAMMES,
  feedProgrammeById,
  feedProgrammePhaseById,
} from "./feed-programmes";

describe("feed programme catalogue", () => {
  it("exposes all seven PIC source programme families", () => {
    expect(FEED_PROGRAMMES).toHaveLength(7);
    expect(FEED_PROGRAMMES.map((programme) => programme.id)).toEqual([
      "mature-boar",
      "developing-gilt",
      "gestating-gilt-sow",
      "lactating-gilt-sow",
      "weaned-sow",
      "nursery-pig",
      "grow-finish-pig",
    ]);
  });

  it("splits the loaded PIC growth data into nursery and grow-finish programmes", () => {
    const nursery = feedProgrammeById("nursery-pig");
    const growFinish = feedProgrammeById("grow-finish-pig");

    expect(nursery?.status).toBe("loaded");
    expect(nursery?.phases.map((phase) => phase.id)).toEqual([
      "pic-prestart-weaning-7.5",
      "pic-prestart-7.5-11.5",
      "pic-late-nursery-11-23",
    ]);

    expect(growFinish?.status).toBe("loaded");
    expect(growFinish?.phases).toHaveLength(7);
    expect(growFinish?.phases.every((phase) => phase.lookupMinWeightKg >= 23)).toBe(true);
  });

  it("resolves phases only inside their owning programme URL", () => {
    expect(
      feedProgrammePhaseById("nursery-pig", "pic-prestart-7.5-11.5")?.label,
    ).toContain("7.5");
    expect(
      feedProgrammePhaseById("grow-finish-pig", "pic-prestart-7.5-11.5"),
    ).toBeUndefined();
  });
});
