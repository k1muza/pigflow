import { describe, expect, it } from "vitest";

import { cloneDefaultConfig } from "../config";
import { GrowingPig } from "../sim/animals";
import { Engine, PHASES } from "./engine";
import { heatersAlight } from "./systems/nutrition";

function operationalEngine(retainHomeBredGilts = false): Engine {
  const config = cloneDefaultConfig();
  config.project.variation = "settled";
  config.feed.procurementMode = "operational";
  config.growth.saleWeightKg = 100;
  config.herd.retainHomeBredGilts = retainHomeBredGilts;
  return new Engine(config, {
    policies: {
      enforceHousing: false,
      realisticHealthAndReproduction: false,
    },
  });
}

function finisher(
  weightKg: number,
  tag: string,
  sex: "male" | "female" = "male",
): GrowingPig {
  return new GrowingPig({
    id: tag,
    tag,
    sex,
    birthDay: -150,
    weightKg,
    stage: "finisher",
    growthFactor: 1,
  });
}

function stockFinisherFeed(engine: Engine, pig: GrowingPig): void {
  engine.world.supplies.openStores(0, {
    finisher: Math.max(1, pig.dailyFeed(engine.config).kg),
  });
}

describe("market timing", () => {
  it("runs the operational market draw before procurement and nutrition", () => {
    expect(PHASES.indexOf("market-sales")).toBeLessThan(PHASES.indexOf("procurement"));
    expect(PHASES.indexOf("market-sales")).toBeLessThan(PHASES.indexOf("nutrition"));
    expect(PHASES.indexOf("market-sales")).toBeLessThan(PHASES.indexOf("selection"));
  });

  it("sells an already-at-weight cohort before nutrition gives it another ration", () => {
    const engine = operationalEngine();
    const pig = finisher(100.2, "MARKET-TIMING-READY");
    engine.world.pigs.push(pig);
    stockFinisherFeed(engine, pig);

    engine.step(0);

    expect(engine.history[0].sold).toBe(1);
    expect(pig.alive).toBe(false);
    expect(pig.exitDay).toBe(0);
    expect(pig.weightKg).toBeCloseTo(100.2, 10);
    // Sold pigs remain in world.pigs until closeBooks filters the array. Nutrition
    // must therefore honor alive=false rather than feeding the object anyway.
    expect(pig.costs.byType.feed).toBe(0);
    expect(engine.history[0].growingFeedKg).toBe(0);
  });

  it("feeds a cohort that opens below target and sells it the next morning", () => {
    const engine = operationalEngine();
    const pig = finisher(99.7, "MARKET-TIMING-NOT-YET");
    engine.world.pigs.push(pig);
    stockFinisherFeed(engine, pig);

    engine.step(0);

    expect(engine.history[0].sold).toBe(0);
    expect(pig.alive).toBe(true);
    expect(pig.weightKg).toBeGreaterThan(100);
    const afterFeedCost = pig.costs.byType.feed;
    const afterGrowthWeight = pig.weightKg;
    expect(afterFeedCost).toBeGreaterThan(0);

    engine.step(1);

    expect(engine.history[1].sold).toBe(1);
    expect(pig.alive).toBe(false);
    expect(pig.exitDay).toBe(1);
    // The sale-day pig is neither fed nor grown again.
    expect(pig.costs.byType.feed).toBeCloseTo(afterFeedCost, 10);
    expect(pig.weightKg).toBeCloseTo(afterGrowthWeight, 10);
  });

  it("does not reopen replacement selection for a female already committed to slaughter", () => {
    // Leave replacement retention on and plenty of room in the pipeline. If
    // selection gets to this pig before the market draw, she will be drafted out
    // of the market cohort and the test will fail.
    const engine = operationalEngine(true);
    const pig = finisher(100.2, "MARKET-TIMING-FEMALE", "female");
    engine.world.pigs.push(pig);

    engine.step(0);

    expect(engine.history[0].sold).toBe(1);
    expect(engine.history[0].giltsSelected).toBe(0);
    expect(pig.alive).toBe(false);
    expect(pig.destination).toBe("market");
    expect(pig.assessedForBreeding).toBe(false);
    expect(pig.exitReason).toBe("sold");
  });

  it("keeps the legacy after-growth sale timing when operational procurement is off", () => {
    const config = cloneDefaultConfig();
    config.project.variation = "settled";
    config.feed.procurementMode = "foresight";
    config.growth.saleWeightKg = 100;
    config.herd.retainHomeBredGilts = false;
    const engine = new Engine(config, {
      policies: {
        enforceHousing: false,
        realisticHealthAndReproduction: false,
      },
    });
    const pig = finisher(99.7, "MARKET-TIMING-LEGACY");
    engine.world.pigs.push(pig);

    engine.step(0);

    expect(engine.history[0].sold).toBe(1);
    expect(pig.alive).toBe(false);
    expect(pig.exitDay).toBe(0);
    expect(pig.weightKg).toBeGreaterThan(100);
    expect(pig.costs.byType.feed).toBeGreaterThan(0);
  });

  it("does not count a pig that has left among the animals needing heat", () => {
    const engine = operationalEngine();
    const live = new GrowingPig({
      id: "LIVE-PIGLET",
      tag: "LIVE-PIGLET",
      sex: "female",
      birthDay: 0,
      weightKg: 2,
      stage: "piglet",
      growthFactor: 1,
    });
    const departed = new GrowingPig({
      id: "DEPARTED-PIGLET",
      tag: "DEPARTED-PIGLET",
      sex: "male",
      birthDay: 0,
      weightKg: 2,
      stage: "piglet",
      growthFactor: 1,
    });
    departed.leave(0, "died");
    engine.world.pigs.push(live, departed);

    expect(heatersAlight(engine.world, 0)).toEqual({ heaters: 1, underHeat: 1 });
  });
});
