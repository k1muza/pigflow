import { describe, expect, it } from "vitest";

import { cloneDefaultConfig, type PlannerConfig } from "../config";
import { runEngine } from "../engine/engine";
import {
  achievedGainKg,
  explainGrowth,
  gainFeedKgPerKg,
  growthAccount,
  growthAccountOf,
  MAX_DAILY_LOSS_KG,
  upkeepFeedKgDay,
} from "../growth-curve";
import { getModelMetrics } from "../model";
import { GrowingPig } from "./animals";
import { expectedWeaningWeightKg } from "./lactation";

/**
 * Where a kilogram of pork comes from.
 *
 * The rule the whole model hangs off is that liveweight is bought with feed: a
 * pig eats, some of what it eats keeps the body it already has, and what is
 * left over is the only thing that can show up on the scales. Nothing in here
 * is allowed to grow because a number was typed into the plan.
 *
 * The suckling half of that rule lives in `preweaning.test.ts`, because a
 * piglet is fed by its dam and the arithmetic is hers. This file is the pigs
 * that eat for themselves, plus the two joins: that the 1.x farm and the 2.0
 * engine grow a pig the same way, and that a farm which cannot get the loads in
 * finishes later than one that can.
 */

function plan(edit: (config: PlannerConfig) => void = () => {}): PlannerConfig {
  const config = cloneDefaultConfig();
  config.project.months = 12;
  config.project.variation = "settled";
  edit(config);
  return config;
}

function pigAt(weightKg: number, stage: "weaner" | "grower" | "finisher"): GrowingPig {
  return new GrowingPig({
    id: "p",
    tag: "p",
    sex: "female",
    birthDay: 0,
    weightKg,
    stage,
  });
}

// ------------------------------------------------------------- the arithmetic

describe("what a pig does with a day's feed", () => {
  const growth = cloneDefaultConfig().growth;

  it("keeps itself first and grows on what is left", () => {
    const account = growthAccount(60, 0.8, 0.8, growth);
    expect(account.intakeKg).toBeCloseTo(0.8 * account.offeredKg, 9);
    expect(account.upkeepKg).toBeCloseTo(upkeepFeedKgDay(60, growth), 9);
    expect(account.growthFeedKg).toBeCloseTo(account.intakeKg - account.upkeepKg, 9);
    expect(account.gainKg).toBeCloseTo(account.growthFeedKg / account.feedKgPerKgGain, 9);
    expect(account.feedKgPerKgGain).toBeCloseTo(gainFeedKgPerKg(60, growth), 9);
  });

  it("does not grow four fifths as fast on four fifths of the ration", () => {
    // The whole reason upkeep is modelled at all. A fifth off the ration is a
    // fifth off the feed that was going to end up as pig plus the whole of the
    // upkeep it still has to find, so short feeding bites harder than it looks.
    const full = growthAccount(60, 0.8, 1, growth);
    const short = growthAccount(60, 0.8, 0.8, growth);
    expect(short.gainKg).toBeLessThan(0.8 * full.gainKg);
    expect(short.gainKg).toBeGreaterThan(0);
  });

  it("loses condition on nothing, but no faster than an animal does", () => {
    const starved = growthAccount(60, 0.8, 0, growth);
    expect(starved.intakeKg).toBe(0);
    expect(starved.fedGainKg).toBeLessThan(-MAX_DAILY_LOSS_KG);
    expect(starved.gainKg).toBe(-MAX_DAILY_LOSS_KG);
  });

  it("grows faster the more it gets, and stops at what a pig can do", () => {
    const at = (share: number) => growthAccount(60, 0.8, share, growth).gainKg;
    expect(at(0.5)).toBeLessThan(at(0.75));
    expect(at(0.75)).toBeLessThan(at(1));
    // Feeding a pig more than its day of growth costs does not make it grow
    // faster. It makes it a fat pig, and this model stops rather than pretend to
    // know the difference.
    expect(at(1)).toBeCloseTo(0.8, 9);
    expect(at(1.5)).toBeCloseTo(0.8, 9);
    expect(achievedGainKg(60, 0.8, 1.5, growth)).toBeCloseTo(0.8, 9);
  });

  it("can say where the day's gain came from", () => {
    // The sentence the farm is owed: what went in, what it cost to stand still,
    // and what the rest bought.
    const account = growthAccount(60, 0.8, 0.8, growth);
    const said = explainGrowth(account);
    expect(said).toContain(account.intakeKg.toFixed(2));
    expect(said).toContain(account.upkeepKg.toFixed(2));
    expect(said).toContain(account.growthFeedKg.toFixed(2));
    expect(said).toContain(account.gainKg.toFixed(2));
    // And it adds up in the direction it is read.
    expect(account.upkeepKg + account.growthFeedKg).toBeCloseTo(account.intakeKg, 9);
  });
});

// ---------------------------------------------------------------- the animals

describe("a growing pig in a pen", () => {
  it("grows on the ration it was served", () => {
    const config = plan();
    const fed = pigAt(60, "grower");
    const short = pigAt(60, "grower");
    short.intakeFactor = 0.7;

    fed.advanceWeight(config);
    short.advanceWeight(config);

    expect(short.weightKg).toBeLessThan(fed.weightKg);
    expect(short.weightKg - 60).toBeCloseTo(
      achievedGainKg(60, short.dailyGainKg(config), 0.7, config.growth),
      9,
    );
  });

  it("grows the same way in both engines", () => {
    // Two growth rules were two models. The 1.x farm buys feed as it eats it so
    // a growing pig there is never short — but if one ever is, it has to answer
    // for it in the same arithmetic the 2.0 engine uses.
    const config = plan();
    for (const share of [1, 0.8, 0.5]) {
      const legacy = pigAt(55, "grower");
      const engine = pigAt(55, "grower");
      legacy.intakeFactor = share;
      engine.intakeFactor = share;
      legacy.grow(config);
      engine.advanceWeight(config);
      expect(legacy.weightKg).toBeCloseTo(engine.weightKg, 12);
    }
  });

  it("grows on the kilograms the store actually issued it", () => {
    // Not on a share of what it asked for. The ration is priced off the pig's
    // plan rate and the growth off its rate after the room and the vet have had
    // their say, so reconstructing the intake from a percentage of the smaller
    // number grew a crowded, short-fed pig on less feed than the farm had in
    // fact handed it.
    const config = plan();
    const pig = pigAt(60, "grower");
    pig.crowdingFactor = 0.8;
    const issued = 1.6;
    pig.feedEatenKg = issued;

    const ceiling = pig.dailyGainKg(config) * 0.8;
    expect(pig.achievedGainKg(config)).toBeCloseTo(
      growthAccountOf(60, ceiling, issued, config.growth).gainKg,
      12,
    );
    // And the feed it was grown on is the feed it was given.
    expect(growthAccountOf(60, ceiling, issued, config.growth).intakeKg).toBe(issued);
  });

  it("stops at whichever runs out first, the feed or the animal", () => {
    // Two ceilings, not two multipliers. A pig on four fifths of its feed and
    // six tenths of its health does not grow at forty-eight hundredths: the
    // illness has already taken the appetite the missing feed would have fed.
    const config = plan();
    const pig = pigAt(60, "grower");
    const full = pigAt(60, "grower");
    const offered = full.dailyFeed(config).kg;

    pig.treatmentPenaltyDays = 3;
    pig.treatmentGrowthFactor = 0.6;
    pig.feedEatenKg = 0.8 * offered;

    const healthCeiling = pig.dailyGainKg(config) * 0.6;
    const feedCeiling = growthAccountOf(60, Infinity, 0.8 * offered, config.growth).fedGainKg;
    expect(pig.achievedGainKg(config)).toBeCloseTo(Math.min(healthCeiling, feedCeiling), 12);
    expect(pig.achievedGainKg(config)).toBeGreaterThan(healthCeiling * 0.8);
  });

  it("earns its next stage on weight and nothing else", () => {
    const config = plan();
    const pig = pigAt(config.growth.growerStartWeightKg - 0.01, "weaner");
    expect(pig.nextStage(config)).toBeNull();
    pig.advanceWeight(config);
    expect(pig.weightKg).toBeGreaterThanOrEqual(config.growth.growerStartWeightKg);
    expect(pig.nextStage(config)).toBe("grower");
  });
});

// ------------------------------------------------------------------- the farm

describe("a farm that cannot get the loads in", () => {
  /** One run of the 2.0 engine, read for what it sold and what it went short. */
  function sales(config: PlannerConfig) {
    const run = runEngine(config, 360);
    let shortfallKg = 0;
    let sold = 0;
    for (const day of run.history) {
      shortfallKg += day.feedShortfallKg;
      sold += day.sold;
    }
    return { shortfallKg, sold };
  }

  const herd = (config: PlannerConfig) => {
    config.project.engine = "2.0";
    config.stock.sows = 20;
    config.herd.maxSows = 20;
    config.herd.startMode = "staggered";
    config.feed.procurementMode = "operational";
    config.feed.operationalPolicy = "balanced-load";
  };

  it("sells fewer pigs than one that can", () => {
    const thin = sales(
      plan((config) => {
        herd(config);
        // A lorry that cannot carry a day's feed, and one of them a day.
        config.feed.truckCapacityKg = 200;
        config.feed.maxSupplyTripsPerDay = 1;
      }),
    );
    const full = sales(plan(herd));

    // The arm is only worth anything if the farm really did go short.
    expect(thin.shortfallKg).toBeGreaterThan(0);
    expect(full.sold).toBeGreaterThan(0);
    // Feed the herd could not get is growth it did not make, and growth it did
    // not make is pigs that had not reached the weight the lorry comes for.
    expect(thin.sold).toBeLessThan(full.sold);
  }, 300_000);
});

// --------------------------------------------------------------- the read-out

describe("what the plan quotes", () => {
  it("walks the growout from the weaner its own ration produces", () => {
    // A thin farrowing house is a longer finishing job. The quoted days to sale
    // used to start from the weaner the plan hoped for, which hid it.
    const thin = plan((c) => (c.feed.lactationKgDay = 4.5));
    const generous = plan((c) => (c.feed.lactationKgDay = 12));

    expect(expectedWeaningWeightKg(thin)).toBeLessThan(expectedWeaningWeightKg(generous));
    expect(getModelMetrics(thin).daysToSaleWeight).toBeGreaterThan(
      getModelMetrics(generous).daysToSaleWeight,
    );
    expect(getModelMetrics(thin).feedConversion.feedKg).toBeGreaterThan(
      getModelMetrics(generous).feedConversion.feedKg,
    );
  });

  it("does not move when the target weaner moves", () => {
    const modest = plan((c) => (c.growth.referenceWeaningWeightKg = 7));
    const ambitious = plan((c) => (c.growth.referenceWeaningWeightKg = 12));
    expect(getModelMetrics(ambitious).daysToSaleWeight).toBe(
      getModelMetrics(modest).daysToSaleWeight,
    );
    expect(getModelMetrics(ambitious).feedConversion).toEqual(
      getModelMetrics(modest).feedConversion,
    );
  });
});
