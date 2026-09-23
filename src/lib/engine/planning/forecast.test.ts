import { describe, expect, it } from "vitest";

import { cloneDefaultConfig, type PlannerConfig } from "../../config";
import { forecastDemand, type ExpectedFarmState } from "./forecast";

/**
 * What the farm is going to eat, worked out from what is standing on it.
 *
 * These are the tests that say the forecaster is a forecaster and not a
 * rate card. A farrowing three weeks out has to show up as sow feed on the day
 * she farrows, creep a fortnight after that and weaner feed a month after that —
 * on the right days, in the right bins, and from nothing but a due date the farm
 * already has written down.
 *
 * They also pin the boundary. The forecaster is handed an expected picture of
 * the herd and never the world, so there is no route from here to a scheduled
 * death or a random draw the farm has not made yet. The seed is in the
 * configuration and changing it must not move a kilogram.
 */

function plan(tweak: (config: PlannerConfig) => void = () => {}): PlannerConfig {
  const config = cloneDefaultConfig();
  config.housing.enforceCapacity = false;
  config.reproduction.gestationDays = 115;
  config.reproduction.weaningAgeDays = 28;
  config.reproduction.weanToServiceDays = 7;
  config.reproduction.bornAlivePerLitter = 10;
  config.reproduction.preWeanMortalityPct = 0;
  config.reproduction.farrowingSuccessPct = 80;
  config.reproduction.pregnancyLossPct = 0;
  config.reproduction.heatDetectionPct = 100;
  config.reproduction.enforceEstrusWindows = true;
  config.feed.creepStartAgeDays = 14;
  config.feed.creepKgPerPigDay = 0.05;
  config.herd.sowAnnualMortalityPct = 0;
  config.service.useAi = false;
  tweak(config);
  return config;
}

const NOBODY: ExpectedFarmState = { day: 0, growing: [], sows: [], boars: [] };

function withSow(state: Partial<ExpectedFarmState["sows"][number]>): ExpectedFarmState {
  return {
    ...NOBODY,
    sows: [
      {
        head: 1,
        weightKg: 210,
        state: "gestating",
        parity: 1,
        dueDay: null,
        weanDay: null,
        nextServiceDay: 0,
        ...state,
      },
    ],
  };
}

/** The first day in the curve on which a store is asked for anything. */
function firstDrawOn(series: readonly number[]): number {
  return series.findIndex((kg) => kg > 1e-9);
}

describe("A farrowing the farm already knows about", () => {
  it("moves the sow onto the lactation ration on the day she is due", () => {
    const config = plan();
    const farm = withSow({ state: "gestating", dueDay: 10 });
    const forecast = forecastDemand(farm, config, 60);

    // She is on the gestation ration up to the day before, and on lactation
    // from the day itself. A farm that cannot see that coming buys her feed a
    // fortnight late.
    const gestating = forecast.demandKg.sow[9];
    const lactating = forecast.demandKg.sow[10];
    expect(lactating).toBeGreaterThan(gestating * 1.5);
    expect(gestating).toBeCloseTo(
      config.feed.gestationKgDay * Math.pow(210 / 210, 0.75),
      6,
    );
    expect(lactating).toBeCloseTo(config.feed.lactationKgDay, 6);
  });

  it("starts the creep feeder when the litter is old enough to pick at it", () => {
    const config = plan();
    const forecast = forecastDemand(withSow({ dueDay: 10 }), config, 90);

    // Born on day 10, creep from fourteen days old.
    expect(firstDrawOn(forecast.demandKg.creep)).toBe(10 + config.feed.creepStartAgeDays);
    expect(forecast.demandKg.creep[24]).toBeCloseTo(
      config.reproduction.bornAlivePerLitter * config.feed.creepKgPerPigDay,
      6,
    );
  });

  it("opens the weaner bin on the day the litter comes off her", () => {
    const config = plan();
    const forecast = forecastDemand(withSow({ dueDay: 10 }), config, 120);

    expect(firstDrawOn(forecast.demandKg.weaner)).toBe(
      10 + config.reproduction.weaningAgeDays,
    );
    // And the creep feeder closes on the same day, because they are the same pigs.
    expect(forecast.demandKg.creep[37]).toBeGreaterThan(0);
    expect(forecast.demandKg.creep[38]).toBeCloseTo(0, 9);
  });

  it("lights a lamp over the litter from the day it is born", () => {
    const config = plan();
    const forecast = forecastDemand(withSow({ dueDay: 10 }), config, 90);

    // A lamp is lit per crate and not per piglet, so one litter of ten under a
    // lamp that covers twenty is still one lamp burning.
    expect(firstDrawOn(forecast.demandKg.gas)).toBe(10);
    expect(forecast.demandKg.gas[10]).toBeCloseTo(
      Math.ceil(10 / config.health.pigletsPerHeater) * config.health.gasKgPerHeaterDay,
      6,
    );
  });
});

describe("Services due inside the horizon", () => {
  it("contribute the litters the conception rate says they will", () => {
    const strong = plan((config) => {
      config.reproduction.farrowingSuccessPct = 90;
    });
    const weak = plan((config) => {
      config.reproduction.farrowingSuccessPct = 45;
    });
    const farm = withSow({ state: "open", dueDay: null, nextServiceDay: 5 });

    const bornDay = 5 + 115;
    const creepDay = bornDay + 14;
    const strongForecast = forecastDemand(farm, strong, creepDay + 5);
    const weakForecast = forecastDemand(farm, weak, creepDay + 5);

    // Half the hold rate is half the piglets, and half the creep feed with them.
    expect(strongForecast.demandKg.creep[creepDay]).toBeGreaterThan(0);
    expect(weakForecast.demandKg.creep[creepDay]).toBeCloseTo(
      strongForecast.demandKg.creep[creepDay] / 2,
      6,
    );
  });

  it("shift with heat detection rather than being counted as served", () => {
    const seen = plan((config) => {
      config.reproduction.heatDetectionPct = 100;
    });
    const missed = plan((config) => {
      config.reproduction.heatDetectionPct = 50;
    });
    const farm = withSow({ state: "open", dueDay: null, nextServiceDay: 5 });
    const bornDay = 5 + 115;

    // A heat nobody sees is a cycle of feed with nothing at the end of it, so
    // half the litters expected on the due date rather than a lower hold rate.
    const a = forecastDemand(farm, seen, bornDay + 40).demandKg.creep[bornDay + 14];
    const b = forecastDemand(farm, missed, bornDay + 40).demandKg.creep[bornDay + 14];
    expect(b).toBeCloseTo(a / 2, 6);
  });
});

describe("Growing pigs", () => {
  const grower = (weightKg: number): ExpectedFarmState => ({
    ...NOBODY,
    growing: [
      {
        head: 100,
        stage: "weaner",
        destination: "market",
        sex: "female",
        weightKg,
        ageDays: 70,
        litters: 0,
        weanDay: null,
      },
    ],
  });

  it("move their consumption to the next ration at the stage weight", () => {
    const config = plan((c) => {
      c.growth.growerStartWeightKg = 30;
      c.growth.weanerDailyGainKg = 0.5;
      c.growth.weanerMortalityPct = 0;
      c.growth.growerMortalityPct = 0;
    });
    const forecast = forecastDemand(grower(28), config, 40);

    // Four days at half a kilogram a day carries them over thirty.
    expect(forecast.demandKg.weaner[0]).toBeGreaterThan(0);
    expect(forecast.demandKg.grower[0]).toBeCloseTo(0, 9);
    expect(forecast.demandKg.weaner[6]).toBeCloseTo(0, 9);
    expect(forecast.demandKg.grower[6]).toBeGreaterThan(0);
  });

  it("stop eating on the day their cohort reaches sale weight", () => {
    const config = plan((c) => {
      c.growth.saleWeightKg = 100;
      c.growth.finisherDailyGainKg = 1;
      c.growth.finisherMortalityPct = 0;
    });
    const farm: ExpectedFarmState = {
      ...NOBODY,
      growing: [
        {
          head: 50,
          stage: "finisher",
          destination: "market",
          sex: "female",
          weightKg: 95,
          ageDays: 150,
          litters: 0,
          weanDay: null,
        },
      ],
    };
    const forecast = forecastDemand(farm, config, 30);
    expect(forecast.demandKg.finisher[0]).toBeGreaterThan(0);
    expect(forecast.demandKg.finisher[20]).toBeCloseTo(0, 9);
  });

  it("thin out at the stage's own mortality, which buys less feed later", () => {
    const healthy = plan((c) => {
      c.growth.weanerMortalityPct = 0;
    });
    const sickly = plan((c) => {
      c.growth.weanerMortalityPct = 20;
    });
    const a = forecastDemand(grower(20), healthy, 20).demandKg.weaner[15];
    const b = forecastDemand(grower(20), sickly, 20).demandKg.weaner[15];

    expect(b).toBeLessThan(a);
    // The expectation carries fractional head; the authoritative world does not,
    // and nothing here ever touches it.
    expect(b / a).toBeGreaterThan(0.5);
  });

  it("keeps sale-weight pigs eating upstream while the finisher house is full", () => {
    const config = plan((c) => {
      c.housing.enforceCapacity = true;
      c.housing.finisherPlaces = 1;
      c.growth.growerMortalityPct = 0;
      c.growth.finisherMortalityPct = 0;
      c.growth.saleWeightKg = 100;
    });
    const farm: ExpectedFarmState = {
      ...NOBODY,
      growing: [
        {
          head: 10,
          stage: "grower",
          destination: "market",
          sex: "female",
          weightKg: 100,
          ageDays: 150,
          litters: 0,
          weanDay: null,
        },
        {
          head: 1,
          stage: "finisher",
          destination: "market",
          sex: "female",
          weightKg: 40,
          ageDays: 100,
          litters: 0,
          weanDay: null,
        },
      ],
    };

    const forecast = forecastDemand(farm, config, 3);
    expect(forecast.demandKg.grower[1]).toBeGreaterThan(0);
    expect(forecast.demandKg.finisher[1]).toBeGreaterThan(0);
  });

  it("splits expected cohorts when only part of a batch fits downstream", () => {
    const config = plan((c) => {
      c.housing.enforceCapacity = true;
      c.housing.finisherPlaces = 4;
      c.growth.growerMortalityPct = 0;
      c.growth.finisherMortalityPct = 0;
      c.growth.finisherStartWeightKg = 60;
      c.growth.saleWeightKg = 100;
    });
    const farm: ExpectedFarmState = {
      ...NOBODY,
      growing: [
        {
          head: 10,
          stage: "grower",
          destination: "market",
          sex: "female",
          weightKg: 60,
          ageDays: 120,
          litters: 0,
          weanDay: null,
        },
      ],
    };

    const forecast = forecastDemand(farm, config, 2);
    expect(forecast.demandKg.grower[1]).toBeGreaterThan(0);
    expect(forecast.demandKg.finisher[1]).toBeGreaterThan(0);
  });
});

describe("The information boundary", () => {
  it("is deterministic: the same farm gives the same curve every time", () => {
    const config = plan();
    const farm = withSow({ dueDay: 12 });
    const first = forecastDemand(farm, config, 120);
    const second = forecastDemand(farm, config, 120);
    expect(second.demandKg).toEqual(first.demandKg);
  });

  it("does not move when the plan's hidden draws move", () => {
    const farm = withSow({ dueDay: 12 });
    const one = plan((config) => {
      config.project.seed = 1;
      config.project.variation = "chance";
    });
    const other = plan((config) => {
      config.project.seed = 999_999;
      config.project.variation = "chance";
    });

    // Litter size, gestation length and who dies are all drawn from the seed.
    // None of them is knowable this morning, so none of them may reach a figure
    // the farm orders against today.
    expect(forecastDemand(farm, other, 150).demandKg).toEqual(
      forecastDemand(farm, one, 150).demandKg,
    );
  });

  it("does move when something the farm can observe moves", () => {
    const config = plan();
    const early = forecastDemand(withSow({ dueDay: 10 }), config, 120);
    const late = forecastDemand(withSow({ dueDay: 20 }), config, 120);

    // A due date is present knowledge — it is written on her card — so a change
    // to it is exactly the kind of thing that should change today's order.
    expect(firstDrawOn(late.demandKg.creep) - firstDrawOn(early.demandKg.creep)).toBe(10);
  });

  it("explains itself, store by store and source by source", () => {
    const config = plan();
    const forecast = forecastDemand(withSow({ dueDay: 5 }), config, 90);
    const sources = forecast.explanation.filter((line) => line.store === "sow");
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.every((line) => line.kg > 0 && line.note.length > 0)).toBe(true);
  });
});

/**
 * Where the forecaster and the engine have to agree about a growing pig.
 *
 * A demand forecast is only worth the deliveries it books, and a deliverable is
 * booked against a bin. So every rule the engine uses to decide which bin an
 * animal eats out of — and on which day it stops eating altogether — has to be
 * the rule in here as well. Each of these was a real divergence that starved a
 * store: not by much, and not often, but a herd that goes short at all is one
 * the ordering policy failed.
 */
describe("what the forecast thinks a growing pig is doing", () => {
  function growing(
    groups: readonly Partial<ExpectedFarmState["growing"][number]>[],
  ): ExpectedFarmState {
    return {
      ...NOBODY,
      growing: groups.map((group) => ({
        head: 1,
        stage: "finisher" as const,
        destination: "market" as const,
        sex: "male" as const,
        weightKg: 90,
        ageDays: 160,
        litters: 0,
        weanDay: null,
        ...group,
      })),
    };
  }

  it("goes on feeding a pen until the pen is ready, not until its best pig is", () => {
    const config = plan();
    // One cohort, one pig over sale weight and one well under it. The farm sells
    // the pair when their average gets there, and feeds both until it does.
    const farm = growing([
      { weightKg: config.growth.saleWeightKg + 8, ageDays: 170 },
      { weightKg: config.growth.saleWeightKg - 20, ageDays: 170 },
    ]);
    const forecast = forecastDemand(farm, config, 10);

    // Read against the same pen with its forward pig on its own: if the walker's
    // own weight decided, that pig would already have gone and taken its feed
    // with it, and today's finisher demand would be the lighter one's alone.
    const alone = forecastDemand(
      growing([{ weightKg: config.growth.saleWeightKg - 20, ageDays: 170 }]),
      config,
      10,
    );
    expect(forecast.demandKg.finisher[0]).toBeGreaterThan(alone.demandKg.finisher[0] * 1.5);
  });

  it("lets a pen go once the average gets there, and stops buying for it", () => {
    const config = plan();
    const ready = growing([
      { weightKg: config.growth.saleWeightKg + 8, ageDays: 170 },
      { weightKg: config.growth.saleWeightKg + 2, ageDays: 170 },
    ]);
    // Nothing else is standing on the farm, so the finisher bin goes quiet.
    expect(forecastDemand(ready, config, 10).demandKg.finisher[0]).toBeCloseTo(0, 9);
  });

  it("feeds a replacement gilt out of the bin she is standing at", () => {
    const config = plan();
    // Picked out to breed, and past the weight that puts a pig in the finishing
    // house but not yet at the weight that takes her out of the growing herd.
    // The engine moves her with the pigs she was picked out of; a forecast that
    // left her on grower feed buys nothing for the farm's first finisher draw.
    const heavy = config.growth.finisherStartWeightKg + 5;
    expect(heavy).toBeLessThan(config.growth.saleWeightKg);
    const farm = growing([
      { stage: "grower", destination: "breeding", sex: "female", weightKg: heavy, ageDays: 120 },
    ]);
    const forecast = forecastDemand(farm, config, 5);

    expect(forecast.demandKg.finisher[0]).toBeGreaterThan(0);
    expect(forecast.demandKg.grower[0]).toBeCloseTo(0, 9);
  });

  it("puts her on the developer ration once she is selected out", () => {
    const config = plan();
    const farm = growing([
      {
        stage: "finisher",
        destination: "breeding",
        sex: "female",
        weightKg: config.growth.saleWeightKg + 1,
        ageDays: 175,
      },
    ]);
    const forecast = forecastDemand(farm, config, 5);

    // Off the growing bins and onto sow feed — and not sold, which is what
    // happens to the market pigs she was standing with.
    expect(forecast.demandKg.finisher[0]).toBeCloseTo(0, 9);
    expect(forecast.demandKg.sow[0]).toBeGreaterThan(0);
  });

  it("grows a suckler at the rate the engine grows it at", () => {
    const config = plan();
    // A litter the farm has already seen is thrifty or it is not, and that shows
    // in what it weighs. It must not also show in what it is forecast to grow:
    // a suckler's gain is its dam's milk, and she is fed for the litter and not
    // for its conversion. A factor here and not in the engine would have the
    // ordering policy buying sow feed for a herd nobody is feeding.
    const litter = (growthFactor: number): ExpectedFarmState => ({
      ...NOBODY,
      sows: [
        {
          head: 1,
          weightKg: 210,
          state: "lactating",
          parity: 2,
          dueDay: null,
          weanDay: 20,
          nextServiceDay: 27,
        },
      ],
      growing: [
        {
          head: 10,
          stage: "piglet",
          destination: "market",
          sex: "male",
          growthFactor,
          weightKg: 4,
          ageDays: 12,
          litters: 1,
          weanDay: 20,
        },
      ],
    });

    const poor = forecastDemand(litter(0.85), config, 40);
    const thrifty = forecastDemand(litter(1.15), config, 40);

    // Her ration is the litter's, to the kilogram, however well they convert.
    expect(thrifty.demandKg.sow).toEqual(poor.demandKg.sow);
    expect(thrifty.demandKg.creep).toEqual(poor.demandKg.creep);

    // And once they are off her and eating for themselves it does count, in the
    // forecast as in the engine. That is where the spread between litter mates
    // starts, and a forecast that flattened it would be wrong the other way.
    expect(thrifty.demandKg.weaner).not.toEqual(poor.demandKg.weaner);
  });
});
