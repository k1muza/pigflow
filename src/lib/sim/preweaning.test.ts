import { describe, expect, it } from "vitest";

import {
  BIRTH_WEIGHT_KG,
  cloneDefaultConfig,
  withConfigDefaults,
  type PlannerConfig,
} from "../config";
import { runEngine } from "../engine/engine";
import { simulatePlan } from "../simulation";
import {
  expectedWeaningWeightKg,
  explainLitterGrowth,
  lactationDemandOf,
  litterGrowthAccount,
  pigletSupportFactor,
  potentialPigletGainKg,
} from "./lactation";

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

  it("grows at the genotype's rate whatever day the farm weans on", () => {
    // How fast a piglet can grow is a fact about the animal; when it comes off
    // the sow is a decision about the farm. Reading the rate off the weaning age
    // made them one number, and a litter left on a week longer grew a seventh
    // slower and arrived at exactly the same weight for exactly the same feed.
    const early = plan((c) => (c.reproduction.weaningAgeDays = 28));
    const late = plan((c) => (c.reproduction.weaningAgeDays = 35));
    expect(potentialPigletGainKg(late)).toBe(potentialPigletGainKg(early));
  });

  it("gives a fully fed litter more weight for more days on the sow", () => {
    // The test that would have caught it. With milk to spare, nothing is
    // rationed and nothing is short, so the only thing left that can make one
    // litter heavier than the other is the week.
    const fed = (weaningAgeDays: number) => {
      const config = plan((c) => {
        c.reproduction.weaningAgeDays = weaningAgeDays;
        c.feed.lactationKgDay = 14;
      });
      return expectedWeaningWeightKg(config);
    };

    const early = fed(28);
    const late = fed(35);
    expect(late).toBeGreaterThan(early);
    // And by the week's worth of the genotype's own rate, not by some share of
    // a target both of them were walking towards.
    expect(late - early).toBeCloseTo(7 * potentialPigletGainKg(plan()), 6);
  });

  it("reads nothing at all off the weaning weight the plan is aiming at", () => {
    // The target is a line to hold the run up against. It was the thing that
    // drove growth, which is how a farm typed its way to 2.5 kg a head.
    const light = plan((c) => (c.growth.referenceWeaningWeightKg = 7));
    const heavy = plan((c) => (c.growth.referenceWeaningWeightKg = 12));
    expect(potentialPigletGainKg(heavy)).toBe(potentialPigletGainKg(light));
    expect(potentialPigletGainKg(light)).toBe(light.growth.pigletDailyGainKg);
  });

  it("grows a suckler faster when the genotype is faster", () => {
    const steady = plan((c) => (c.growth.pigletDailyGainKg = 0.2));
    const quick = plan((c) => (c.growth.pigletDailyGainKg = 0.3));
    expect(potentialPigletGainKg(quick)).toBeGreaterThan(potentialPigletGainKg(steady));
    // And the dam is asked for the feed to milk it, which is where the extra
    // weight is paid for.
    const askedOf = (config: PlannerConfig) =>
      lactationDemandOf(
        {
          weightKg: 210,
          sucklers: 12,
          potentialGainKg: 12 * potentialPigletGainKg(config),
          creepOfferedKg: 0,
        },
        config,
      ).requiredKg;
    expect(askedOf(quick)).toBeGreaterThan(askedOf(steady));
  });
});

// ------------------------------------------------------------------ the farm

describe("a heavier weaner has to be fed for", () => {
  /**
   * The regression this whole change exists for.
   *
   * Two runs of the same farm on the same feed policy, differing only in what
   * the plan says a weaner ought to weigh. Nothing moves — not the weaner, not
   * the sow feed, not the bank. The target is what the farm is aiming at and the
   * run is what it got, and aiming higher has never fed anything.
   */
  it("does not make one out of a bigger number in the box", () => {
    const aiming = (target: number) =>
      run(plan((config) => (config.growth.referenceWeaningWeightKg = target)));

    const modest = aiming(8);
    const ambitious = aiming(12);

    expect(ambitious).toEqual(modest);
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

// ------------------------------------------------------------ the diagnostic

describe("what the plan says its weaner cost", () => {
  it("counts the feed the sows were handed, not the feed they were owed", () => {
    // A farm that cannot get the loads in. On the days its sow bin runs dry the
    // lactating sows are milked on what was in it, and the weaning summary has
    // to say so — a diagnostic that reported the full ration would explain a
    // light weaner by pointing at feed nobody ever fed.
    const config = plan((c) => {
      c.project.engine = "2.0";
      c.stock.sows = 20;
      c.herd.maxSows = 20;
      c.herd.startMode = "staggered";
      c.feed.procurementMode = "operational";
      c.feed.operationalPolicy = "balanced-load";
      c.feed.truckCapacityKg = 200;
      c.feed.maxSupplyTripsPerDay = 1;
    });
    // Read off the engine rather than the projection, because the shortfall is
    // a 2.0 reading and the shared day record does not carry it.
    const run = runEngine(config, 360);

    let shortfallKg = 0;
    let sowFeedKg = 0;
    for (const day of run.history) {
      shortfallKg += day.feedShortfallKg;
      sowFeedKg += day.feedByRation.sow;
    }

    // The arm is only worth anything if the farm really did go short.
    expect(shortfallKg).toBeGreaterThan(0);
    expect(run.lifetime.lactationFeedKg).toBeGreaterThan(0);
    // Lactation feed comes out of the sow bin, so it cannot be more than what
    // came out of the sow bin. Recorded off the demand rather than the issue,
    // this is exactly the assertion that breaks.
    expect(run.lifetime.lactationFeedKg).toBeLessThanOrEqual(sowFeedKg + 1e-6);
  }, 240_000);

  it("says which of the four numbers made a light weaner", () => {
    // The sentence the farm is owed. A litter's day is its dam's ration, what
    // she kept of it, what the rest milked and what the creep feeder added, and
    // a light weaner is always one of those four — so the model says which.
    const config = plan((c) => {
      c.feed.lactationKgDay = 4.5;
      c.feed.creepKgPerPigDay = 0.05;
    });
    const sucklers = Math.round(config.reproduction.bornAlivePerLitter);
    const demand = lactationDemandOf(
      {
        weightKg: 210,
        sucklers,
        potentialGainKg: sucklers * potentialPigletGainKg(config),
        creepOfferedKg: sucklers * config.feed.creepKgPerPigDay,
      },
      config,
    );
    const account = litterGrowthAccount(
      demand,
      demand.offeredKg,
      demand.creepOfferedKg,
      config,
    );

    // It adds up the way it is read out.
    expect(account.milkGainKg + account.creepGainKg).toBeCloseTo(account.fedGainKg, 9);
    expect(account.maintenanceKg + account.milkFeedKg).toBeCloseTo(account.servedSowKg, 9);
    // A ration this thin is the binding constraint, so the litter grows on what
    // the feed bought rather than on what a piglet could have done.
    expect(account.fedGainKg).toBeLessThan(account.potentialGainKg);
    expect(account.gainKg).toBeCloseTo(account.fedGainKg, 9);
    expect(account.creepGainKg).toBeGreaterThan(0);

    const said = explainLitterGrowth(account);
    expect(said).toContain(account.servedSowKg.toFixed(2));
    expect(said).toContain(account.maintenanceKg.toFixed(2));
    expect(said).toContain(account.milkGainKg.toFixed(2));
    expect(said).toContain(account.creepGainKg.toFixed(2));
  });

  it("puts that sentence in the log when a 2.0 litter goes short", () => {
    const config = plan((c) => {
      c.project.engine = "2.0";
      c.project.months = 12;
      c.feed.lactationKgDay = 4.5;
    });
    const restricted = runEngine(config, 180).events.filter(
      (event) => event.type === "IntakeRestricted" && event.message.includes("litters"),
    );
    expect(restricted.length).toBeGreaterThan(0);
    expect(restricted[0].cause).toContain("The sow was fed");
    expect(restricted[0].cause).toContain("the creep feeder added");
  }, 120_000);

  it("reports the weaner it actually produced, and what went into it", () => {
    const simulation = simulatePlan(plan(), { snapshots: false });
    const { weaning } = simulation.projection.summary;
    const config = plan();

    expect(weaning.ageDays).toBe(config.reproduction.weaningAgeDays);
    expect(weaning.referenceWeightKg).toBe(config.growth.referenceWeaningWeightKg);
    expect(weaning.averageWeightKg).toBeGreaterThan(BIRTH_WEIGHT_KG);
    // The whole point of the field: it is measured, so it is allowed to disagree
    // with the plan — and on the default ration it does.
    expect(weaning.averageWeightKg).toBeLessThan(weaning.referenceWeightKg);
    expect(weaning.dailyGainKg).toBeCloseTo(
      (weaning.averageWeightKg - BIRTH_WEIGHT_KG) / weaning.ageDays,
      9,
    );
    expect(weaning.creepFeedKg).toBeGreaterThan(0);
    expect(weaning.feedKgPerKgWeanedOverHorizon).toBeGreaterThan(0);
  }, 120_000);

  it("expects of a plan what that plan's own ration will carry", () => {
    const config = plan();
    // The planning figure the growout, the days-to-sale and the weaner stage
    // length are drawn on. It is the reference only when the ration can reach
    // it; on the default plan it cannot, and saying otherwise made every one of
    // those figures quote a pig this farm never produces.
    expect(expectedWeaningWeightKg(config)).toBeLessThan(
      config.growth.referenceWeaningWeightKg,
    );
    expect(expectedWeaningWeightKg(config)).toBeGreaterThan(BIRTH_WEIGHT_KG);

    // Fed enough and the expectation is the genotype's own rate over the days
    // the farm leaves them on, which is the most a piglet can do.
    const fed = plan((c) => (c.feed.lactationKgDay = 12));
    expect(expectedWeaningWeightKg(fed)).toBeCloseTo(
      BIRTH_WEIGHT_KG + potentialPigletGainKg(fed) * fed.reproduction.weaningAgeDays,
      6,
    );
  });

  it("lands where the farm lands", () => {
    // The plan-level expectation and what twelve months of farm actually weans
    // are two different calculations of the same thing, so they have to agree.
    const config = plan();
    const outcome = run(config);
    expect(outcome.weaningWeightKg).toBeCloseTo(expectedWeaningWeightKg(config), 0);
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

  it("grows its sucklers at exactly the rate it used to imply", () => {
    // A plan written before any of this had no view on how fast a suckler
    // grows, because nothing asked it: the rate was the weaning weight over the
    // weaning age. That is the rate every figure its owner has seen was built
    // on, so it is what the plan is loaded with — handing it the starter
    // assumption instead would move its weaners overnight for no reason its
    // owner could see.
    const stored = cloneDefaultConfig() as unknown as Record<string, unknown>;
    const growth = { ...(stored.growth as Record<string, unknown>) };
    delete growth.pigletDailyGainKg;
    delete growth.referenceWeaningAgeDays;
    stored.growth = growth;
    stored.reproduction = { ...(stored.reproduction as Record<string, unknown>), weaningAgeDays: 35 };

    const loaded = withConfigDefaults(stored);
    // The old rate was quoted at the age that plan weaned at, because that is
    // the only age it had.
    expect(loaded?.growth.referenceWeaningAgeDays).toBe(35);
    expect(potentialPigletGainKg(loaded!)).toBeCloseTo(
      (loaded!.growth.referenceWeaningWeightKg - BIRTH_WEIGHT_KG) / 35,
      9,
    );
  });

  it("leaves the rate alone on a plan that has one", () => {
    const stored = cloneDefaultConfig() as unknown as Record<string, unknown>;
    stored.growth = { ...(stored.growth as Record<string, unknown>), pigletDailyGainKg: 0.25 };
    expect(withConfigDefaults(stored)?.growth.pigletDailyGainKg).toBe(0.25);
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
