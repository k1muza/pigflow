import { describe, expect, it } from "vitest";

import {
  cloneDefaultConfig,
  requiredBoarTeamSize,
  type PlannerConfig,
} from "./config";
import { Engine } from "./engine/engine";
import { Farm } from "./sim/farm";

function fiftySowPlan(engine: "1.x" | "2.0"): PlannerConfig {
  const config = cloneDefaultConfig();
  config.project.engine = engine;
  config.project.variation = "settled";
  config.stock.sows = 50;
  config.stock.boars = 1;
  config.stock.starting = [];
  config.herd.maxSows = 50;
  // AI is available only as overflow; it should not freeze the natural-service
  // team at the one boar the farm happened to open with.
  config.service.useAi = true;
  config.service.aiSharePct = 0;
  return config;
}

describe("boar team scaling", () => {
  it("scales from reproductive workload rather than the opening boar count", () => {
    const config = fiftySowPlan("2.0");

    expect(requiredBoarTeamSize(config, 2)).toBe(1);
    expect(requiredBoarTeamSize(config, 20)).toBe(1);
    expect(requiredBoarTeamSize(config, 50)).toBe(2);
    expect(requiredBoarTeamSize(config, 100)).toBe(3);
  });

  it("reduces natural-service demand when AI is deliberate policy", () => {
    const config = fiftySowPlan("2.0");
    config.service.aiSharePct = 50;

    expect(requiredBoarTeamSize(config, 50)).toBe(1);
  });

  it("never scales below the opening team", () => {
    const config = fiftySowPlan("2.0");
    config.stock.boars = 3;
    config.service.aiSharePct = 100;

    expect(requiredBoarTeamSize(config, 10)).toBe(3);
  });

  for (const engine of ["1.x", "2.0"] as const) {
    it("buys the second boar for a 50-sow herd in engine " + engine, () => {
      const config = fiftySowPlan(engine);

      if (engine === "1.x") {
        const farm = new Farm(config).advanceTo(0);
        expect(farm.boars.filter((boar) => boar.alive)).toHaveLength(2);
      } else {
        const simulation = new Engine(config).advanceTo(0);
        expect(simulation.world.boars.filter((boar) => boar.alive)).toHaveLength(2);
      }
    });
  }
});
