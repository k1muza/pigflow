import { describe, expect, it } from "vitest";

import {
  PIC_FORMULATION_STRATEGIES,
  PIC_GROW_FINISH_FORMULATION_STEPS,
  feedFormulationStrategyById,
} from "./feed-formulations";

describe("PIC formulation strategy library", () => {
  it("preserves the six Figure A2 optimization outcomes plus seasonal formulation", () => {
    expect(PIC_FORMULATION_STRATEGIES).toHaveLength(7);
    expect(PIC_FORMULATION_STRATEGIES.map((strategy) => strategy.id)).toEqual([
      "maximum-adg",
      "best-feed-efficiency",
      "minimum-feed-cost-per-gain",
      "maximum-iofc",
      "maximum-ioffc",
      "maximum-iotc",
      "seasonal-formulation",
    ]);
  });

  it("stores Figure A2 SID lysine values as example context, not programme requirements", () => {
    expect(feedFormulationStrategyById("maximum-adg")?.exampleSidLysinePct).toBe(1.28);
    expect(feedFormulationStrategyById("best-feed-efficiency")?.exampleSidLysinePct).toBe(1.42);
    expect(feedFormulationStrategyById("minimum-feed-cost-per-gain")?.exampleSidLysinePct).toBe(0.85);
    expect(feedFormulationStrategyById("maximum-iofc")?.exampleSidLysinePct).toBe(1.34);
    expect(feedFormulationStrategyById("maximum-ioffc")?.exampleSidLysinePct).toBe(1.35);
    expect(feedFormulationStrategyById("maximum-iotc")?.exampleSidLysinePct).toBe(1.37);
    expect(feedFormulationStrategyById("seasonal-formulation")?.exampleSidLysinePct).toBeUndefined();
  });

  it("captures PIC's five-step grow-finish formulation workflow", () => {
    expect(PIC_GROW_FINISH_FORMULATION_STEPS).toHaveLength(5);
    expect(PIC_GROW_FINISH_FORMULATION_STEPS[0]).toMatch(/lysine/i);
    expect(PIC_GROW_FINISH_FORMULATION_STEPS[4]).toMatch(/calcium/i);
  });
});
