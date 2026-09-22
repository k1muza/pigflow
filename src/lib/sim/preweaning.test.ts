import { describe, expect, it } from "vitest";

import {
  BIRTH_WEIGHT_KG,
  cloneDefaultConfig,
  withConfigDefaults,
  type PlannerConfig,
} from "../config";
import { simulatePlan } from "../simulation";
import { lactationDemandOf, pigletSupportFactor, potentialPigletGainKg } from "./lactation";

/**
 * What a heavier weaner costs.
 *
 * The model used to give one away. A suckler's daily gain was the configured
 * weaning weight divided by the weaning age, so typing a bigger number into the
 * box produced a bigger pig, and the sow's ration and the creep feeder never
 * heard about it. A farm could type its way to 2.5 kg a head of extra
 * liveweight, sell it, and bank the proceeds against no feed at all.
 *
 * So the property this file is here to hold is one sentence: extra pre-weaning
 * liveweight has to come from extra nutrition or extra time. Everything below
 * is that sentence asked in a different way — of the arithmetic on its own, of
 * a farm run day by day, and of the two engines separately, because a farm that
 * obeyed it in one and not the other would be two models again.
 */

function plan(edit: (config: PlannerConfig) => void = () => {}): PlannerConfig {
  const config = cloneDefaultConfig();
  config.project.months = 12;
  config.project.variation = "settled";
  edit(config);
  return config;
}

type Outcome = {
  weaned: number;
  weaningWeightKg: number;
  sowFeedKg: number;
  creepFeedKg: number;
  pigsSold: number;
  closingCash: number;
};

/** One run, read for what it weaned and what that took. */
function run(config: PlannerConfig): Outcome {
  const simulation = simulatePlan(config, { snapshots: false });
  let weaned = 0;
  let weanedKg = 0;
  let sowFeedKg = 0;
  let creepFeedKg = 0;
  for (const day of simulation.history) {
    weaned += day.weaned;
    weanedKg += day.weanedLiveweightKg;
    sowFeedKg += day.feedByRation?.sow ?? 0;
    creepFeedKg += day.feedByRation?.creep ?? 0;
  }
  return {
    weaned,
    weaningWeightKg: weaned > 0 ? weanedKg / weaned : 0,
    sowFeedKg,
    creepFeedKg,
    pigsSold: simulation.projection.summary.totalPigsSold,
    closingCash: simulation.projection.summary.closingCash,
  };
}

// --------------------------------------------------------------- the arithmetic

describe("what a litter asks of its dam", () => {
  it("asks for more when there are more of them", () => {
    const config = plan();
    const gain = potentialPigletGainKg(config);
    const six = lactationDemandOf(
      { weightKg: 210, sucklers: 6, potentialGainKg: 6 * gain, creepOfferedKg: 0 },
      config,
    );
    const fourteen = lactationDemandOf(
      { weightKg: 210, sucklers: 14, potentialGainKg: 14 * gain, creepOfferedKg: 0 },
      config,
    );

    // The whole reason this calculation exists: a sow suckling fourteen is not
    // the same animal to feed as a sow suckling six, and the old flat ration
    // said she was.
    expect(fourteen.requiredKg).toBeGreaterThan(six.requiredKg);
    expect(six.maintenanceKg).toBe(fourteen.maintenanceKg);
    expect(fourteen.milkFeedKg / six.milkFeedKg).toBeCloseTo(14 / 6, 5);
  });

  it("asks for less when the creep feeder is doing some of the work", () => {
    const config = plan();
    const litter = { weightKg: 210, sucklers: 10, potentialGainKg: 10 * potentialPigletGainKg(config) };
    const dry = lactationDemandOf({ ...litter, creepOfferedKg: 0 }, config);
    const creeped = lactationDemandOf({ ...litter, creepOfferedKg: 0.6 }, config);

    expect(creeped.requiredKg).toBeLessThan(dry.requiredKg);
    // And the shift is the creep's own conversion, not a fudge: 0.6 kg of creep
    // is 0.4 kg of gain the sow does not have to milk.
    const gainMoved = 0.6 / config.feed.creepFeedKgPerKgGain;
    expect(dry.milkFeedKg - creeped.milkFeedKg).toBeCloseTo(
      gainMoved * config.feed.lactationFeedKgPerKgGain,
      6,
    );
  });

  it("stops at the ration however much the litter wants", () => {
    const config = plan((c) => (c.feed.lactationKgDay = 5));
    const demand = lactationDemandOf(
      { weightKg: 210, sucklers: 16, potentialGainKg: 16 * 0.25, creepOfferedKg: 0 },
      config,
    );
    expect(demand.rationed).toBe(true);
    expect(demand.offeredKg).toBeLessThan(demand.requiredKg);
    // A litter that is not fully milked does not grow as if it were.
    expect(pigletSupportFactor(demand, demand.offeredKg, 0, config)).toBeLessThan(1);
  });

  it("gives the litter only what was actually served", () => {
    const config = plan();
    const demand = lactationDemandOf(
      { weightKg: 210, sucklers: 10, potentialGainKg: 10 * 0.2, creepOfferedKg: 0.4 },
      config,
    );
    const full = pigletSupportFactor(demand, demand.offeredKg, demand.creepOfferedKg, config);
    const shortSow = pigletSupportFactor(demand, demand.offeredKg * 0.8, demand.creepOfferedKg, config);
    const shortCreep = pigletSupportFactor(demand, demand.offeredKg, 0, config);

    expect(full).toBeCloseTo(1, 6);
    // A store that ran dry reaches the piglet: the sow milks less and the creep
    // feeder is empty, and both come off the litter's day.
    expect(shortSow).toBeLessThan(full);
    expect(shortCreep).toBeLessThan(full);
  });

  it("reads the configured weaning weight as a rate and nothing else", () => {
    const light = plan((c) => (c.growth.referenceWeaningWeightKg = 7));
    const heavy = plan((c) => (c.growth.referenceWeaningWeightKg = 12));
    expect(potentialPigletGainKg(heavy)).toBeGreaterThan(potentialPigletGainKg(light));
    expect(potentialPigletGainKg(light)).toBeCloseTo(
      (7 - BIRTH_WEIGHT_KG) / light.reproduction.weaningAgeDays,
      9,
    );
  });
});

// ------------------------------------------------------------------ the farm

describe("a heavier weaner has to be fed for", () => {
  /**
   * The regression this whole change exists for.
   *
   * Two runs of the same farm on the same feed policy, differing only in what
   * the plan says a weaner ought to weigh. The sow is already eating everything
   * her ration allows in both, so there is no more milk to be had — and without
   * more milk there is no more pig.
   */
  it("does not make one out of a bigger number in the box", () => {
    const capped = (reference: number) =>
      run(
        plan((config) => {
          config.growth.referenceWeaningWeightKg = reference;
          // Low enough that her litter is already asking for more than she is
          // allowed, so nothing about the feed changes between the two runs.
          config.feed.lactationKgDay = 5;
        }),
      );

    const modest = capped(8);
    const ambitious = capped(12);

    expect(ambitious.sowFeedKg).toBeCloseTo(modest.sowFeedKg, 0);
    expect(ambitious.weaningWeightKg).toBeCloseTo(modest.weaningWeightKg, 2);
    expect(ambitious.weaningWeightKg).toBeLessThan(12);
  }, 120_000);

  it("gives a heavier one when there is more milk to give", () => {
    const thin = run(plan((config) => (config.feed.lactationKgDay = 5)));
    const generous = run(plan((config) => (config.feed.lactationKgDay = 9)));

    expect(generous.weaningWeightKg).toBeGreaterThan(thin.weaningWeightKg);
    expect(generous.sowFeedKg).toBeGreaterThan(thin.sowFeedKg);
  }, 120_000);

  it("gives a heavier one when the creep feeder is filled", () => {
    const bare = run(plan((config) => (config.feed.creepKgPerPigDay = 0)));
    const fed = run(plan((config) => (config.feed.creepKgPerPigDay = 0.2)));

    expect(fed.creepFeedKg).toBeGreaterThan(bare.creepFeedKg);
    expect(fed.weaningWeightKg).toBeGreaterThan(bare.weaningWeightKg);
  }, 120_000);

  it("weans at the weight the animal reached, not at the one in the plan", () => {
    // A ration this thin cannot make the weaner the plan asks for, and the
    // weaning gate used to hand it over anyway.
    const outcome = run(
      plan((config) => {
        config.feed.lactationKgDay = 4;
        config.feed.creepKgPerPigDay = 0;
        config.growth.referenceWeaningWeightKg = 9;
      }),
    );
    expect(outcome.weaned).toBeGreaterThan(0);
    expect(outcome.weaningWeightKg).toBeLessThan(9);
    expect(outcome.weaningWeightKg).toBeGreaterThan(BIRTH_WEIGHT_KG);
  }, 120_000);

  it("buys seven more days of growth with seven more days of feed", () => {
    const early = run(plan((config) => (config.reproduction.weaningAgeDays = 28)));
    const late = run(plan((config) => (config.reproduction.weaningAgeDays = 35)));

    // More time on the sow is more weight off her.
    expect(late.weaningWeightKg).toBeGreaterThan(early.weaningWeightKg);

    // And a longer lactation costs more to feed. Asked of one litter rather
    // than of the farm: over a fixed horizon a longer cycle is also fewer
    // litters and fewer gilts reared into the herd, and those move the farm's
    // feed bill for reasons that have nothing to do with this rule.
    const lactationFeedKg = (config: PlannerConfig) => {
      const sucklers = Math.round(config.reproduction.bornAlivePerLitter);
      let kg = 0;
      for (let day = 0; day < config.reproduction.weaningAgeDays; day += 1) {
        kg += lactationDemandOf(
          {
            weightKg: 210,
            sucklers,
            potentialGainKg: sucklers * potentialPigletGainKg(config),
            // Creep from the day the feeder goes into the crate, as the farm does.
            creepOfferedKg:
              day >= config.feed.creepStartAgeDays ? sucklers * config.feed.creepKgPerPigDay : 0,
          },
          config,
        ).offeredKg;
      }
      return kg;
    };

    expect(lactationFeedKg(plan((c) => (c.reproduction.weaningAgeDays = 35)))).toBeGreaterThan(
      lactationFeedKg(plan((c) => (c.reproduction.weaningAgeDays = 28))),
    );
  }, 120_000);

  it("comes out the same way twice", () => {
    const config = plan();
    const first = run(config);
    const again = run(config);
    expect(again).toEqual(first);
  }, 120_000);
});

// ------------------------------------------------------------ the saved plans

describe("a plan saved before any of this", () => {
  /**
   * The field was renamed, so a plan written last week has the old name in it
   * and none of the new one. What the farmer typed was their expectation of the
   * weaner, which is exactly what the new field means — so it moves across, and
   * the only thing that changes is whether the plan has to pay for it.
   */
  it("keeps the weaning weight its owner typed", () => {
    const stored = cloneDefaultConfig() as unknown as Record<string, unknown>;
    const growth = { ...(stored.growth as Record<string, unknown>) };
    delete growth.referenceWeaningWeightKg;
    growth.weaningWeightKg = 8.2;
    stored.growth = growth;

    const loaded = withConfigDefaults(stored);
    expect(loaded).not.toBeNull();
    expect(loaded?.growth.referenceWeaningWeightKg).toBe(8.2);
  });

  it("leaves a plan that already has the new field alone", () => {
    const stored = cloneDefaultConfig() as unknown as Record<string, unknown>;
    stored.growth = {
      ...(stored.growth as Record<string, unknown>),
      weaningWeightKg: 8.2,
      referenceWeaningWeightKg: 6.5,
    };

    // Both names present means the plan has been saved since the rename, so the
    // stale one is a leftover and not an instruction.
    expect(withConfigDefaults(stored)?.growth.referenceWeaningWeightKg).toBe(6.5);
  });

  it("gives the lactation coefficients to a plan that has never heard of them", () => {
    const stored = cloneDefaultConfig() as unknown as Record<string, unknown>;
    const feed = { ...(stored.feed as Record<string, unknown>) };
    delete feed.lactationMaintenanceKgDay;
    delete feed.lactationFeedKgPerKgGain;
    delete feed.creepFeedKgPerKgGain;
    stored.feed = feed;

    const loaded = withConfigDefaults(stored);
    expect(loaded?.feed.lactationMaintenanceKgDay).toBeGreaterThan(0);
    expect(loaded?.feed.lactationFeedKgPerKgGain).toBeGreaterThan(0);
    expect(loaded?.feed.creepFeedKgPerKgGain).toBeGreaterThan(0);
  });
});

describe("both engines", () => {
  it("make the 2.0 farm answer for its milk as well", () => {
    const thin = run(
      plan((config) => {
        config.project.engine = "2.0";
        config.feed.lactationKgDay = 5;
      }),
    );
    const generous = run(
      plan((config) => {
        config.project.engine = "2.0";
        config.feed.lactationKgDay = 9;
      }),
    );

    expect(generous.weaningWeightKg).toBeGreaterThan(thin.weaningWeightKg);
    expect(generous.sowFeedKg).toBeGreaterThan(thin.sowFeedKg);
  }, 240_000);
});
