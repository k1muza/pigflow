import { describe, expect, it } from "vitest";

import {
  BIRTH_WEIGHT_KG,
  cloneDefaultConfig,
  withConfigDefaults,
  type PlannerConfig,
} from "../config";
import { Engine, runEngine } from "../engine/engine";
import { GrowingPig } from "./animals";
import { weaningTargetLabel } from "../model";
import { simulatePlan } from "../simulation";
import {
  expectedPigletWeightAtAgeKg,
  expectedWeaningWeightKg,
  explainLitterGrowth,
  fullyFedPigletWeightKg,
  lactationDemandOf,
  litterGrowthAccount,
  pigletSupportFactor,
  potentialPigletGainKg,
  referencePigletGainKg,
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
    const gain = potentialPigletGainKg(config, 14);
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
    const litter = {
      weightKg: 210,
      sucklers: 10,
      potentialGainKg: 10 * potentialPigletGainKg(config, 14),
    };
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

  it("uses an age-dependent biological ceiling", () => {
    const config = plan();

    expect(potentialPigletGainKg(config, 5)).toBeLessThan(
      potentialPigletGainKg(config, 14),
    );
    expect(potentialPigletGainKg(config, 14)).toBeLessThan(
      potentialPigletGainKg(config, 21),
    );

    // Published/artificial-rearing anchors used by the reference curve.
    expect(referencePigletGainKg(12.5)).toBeCloseTo(0.432, 6);
    expect(referencePigletGainKg(19)).toBeCloseTo(0.521, 6);
    expect(referencePigletGainKg(22)).toBeCloseTo(0.61, 6);

    // The reported biological potential is about 0.4 kg/day over the first
    // three weeks; the discretised daily curve should land close to that.
    const first21 = Array.from({ length: 21 }, (_, day) =>
      potentialPigletGainKg(config, day),
    );
    expect(first21.reduce((sum, gain) => sum + gain, 0) / first21.length).toBeCloseTo(
      0.4,
      1,
    );
  });

  it("does not let the farm's weaning day change potential at a given age", () => {
    const early = plan((c) => (c.reproduction.weaningAgeDays = 28));
    const late = plan((c) => (c.reproduction.weaningAgeDays = 35));
    expect(potentialPigletGainKg(late, 14)).toBe(
      potentialPigletGainKg(early, 14),
    );
  });

  it("gives a fully nourished piglet more weight for more days on the sow", () => {
    const config = plan();
    const early = fullyFedPigletWeightKg(config, 28);
    const late = fullyFedPigletWeightKg(config, 35);

    expect(late).toBeGreaterThan(early);
    const extraWeek = Array.from({ length: 7 }, (_, offset) =>
      potentialPigletGainKg(config, 28 + offset),
    ).reduce((sum, gain) => sum + gain, 0);
    expect(late - early).toBeCloseTo(extraWeek, 9);
  });

  it("reads nothing at all off the weaning weight the plan is aiming at", () => {
    const light = plan((c) => (c.growth.referenceWeaningWeightKg = 7));
    const heavy = plan((c) => (c.growth.referenceWeaningWeightKg = 12));
    expect(potentialPigletGainKg(heavy, 14)).toBe(
      potentialPigletGainKg(light, 14),
    );
  });

  it("moves the whole curve when the genotype calibration changes", () => {
    const steady = plan((c) => (c.growth.pigletGrowthPotentialPct = 80));
    const quick = plan((c) => (c.growth.pigletGrowthPotentialPct = 120));
    const ageDays = 14;

    expect(potentialPigletGainKg(quick, ageDays)).toBeGreaterThan(
      potentialPigletGainKg(steady, ageDays),
    );

    const askedOf = (config: PlannerConfig) =>
      lactationDemandOf(
        {
          weightKg: 210,
          sucklers: 12,
          potentialGainKg: 12 * potentialPigletGainKg(config, ageDays),
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
            potentialGainKg: sucklers * potentialPigletGainKg(config, day),
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

  it("holds a sick suckler to the lower of its milk and its health", () => {
    // The milk a litter was fed is a ceiling in kilograms, and what an animal
    // under treatment can do is another. Multiplying the two charged a sick
    // piglet for the milk it could not have drunk anyway.
    const config = plan();
    const piglet = new GrowingPig({
      id: "s",
      tag: "s",
      sex: "female",
      birthDay: 0,
      weightKg: 3,
      stage: "piglet",
    });
    const ageDays = 14;
    const ceiling = potentialPigletGainKg(config, ageDays);
    piglet.treatmentPenaltyDays = 4;
    piglet.treatmentGrowthFactor = 0.6;

    // Milk for four fifths of a day's growth, health for six tenths.
    piglet.milkGainKg = 0.8 * ceiling;
    expect(piglet.achievedGainKg(config, ageDays)).toBeCloseTo(0.6 * ceiling, 12);

    // And the other way round, milk is the binding one.
    piglet.milkGainKg = 0.4 * ceiling;
    expect(piglet.achievedGainKg(config, ageDays)).toBeCloseTo(0.4 * ceiling, 12);
  });

  it("opens the plan with the piglets its own ration would have fed", () => {
    // Opening stock is stock this farm is supposed to have produced. Backfilling
    // a suckler's weight at the genotype's rate opened a thin-ration plan on day
    // zero with piglets its own lactation could never have grown.
    const opening = (c: PlannerConfig) => {
      c.stock.sows = 20;
      c.herd.maxSows = 20;
      c.herd.startMode = "staggered";
    };
    const thin = plan((c) => {
      opening(c);
      c.feed.lactationKgDay = 4.5;
    });
    const generous = plan((c) => {
      opening(c);
      c.feed.lactationKgDay = 12;
    });
    const ceilingAt = (config: PlannerConfig, ageDays: number) =>
      fullyFedPigletWeightKg(config, ageDays);

    for (const ageDays of [7, 14, 21]) {
      expect(expectedPigletWeightAtAgeKg(thin, ageDays)).toBeLessThan(ceilingAt(thin, ageDays));
      expect(expectedPigletWeightAtAgeKg(thin, ageDays)).toBeLessThan(
        expectedPigletWeightAtAgeKg(generous, ageDays),
      );
      expect(expectedPigletWeightAtAgeKg(thin, ageDays)).toBeGreaterThan(BIRTH_WEIGHT_KG);
    }
    // A practical sow ration can still bind below biological potential; more
    // feed moves the piglet toward the ceiling but never above it.
    expect(expectedPigletWeightAtAgeKg(generous, 21)).toBeLessThanOrEqual(
      ceilingAt(generous, 21),
    );

    // And a farm actually opens on it. Each litter takes its dam's ration
    // between however many of them there are, so the weights are not one
    // number — but none of them is above what the genotype could have done, and
    // a farm that feeds its sows opens heavier than one that does not.
    const openingWeights = (config: PlannerConfig) => {
      // Read before the first day is run, which is the herd the plan opens
      // with rather than the herd after a day of feeding it.
      const engine = new Engine(config);
      const sucklers = engine.world.pigs.filter((pig) => pig.stage === "piglet");
      expect(sucklers.length).toBeGreaterThan(0);
      let ofAge = 0;
      let kg = 0;
      for (const piglet of sucklers) {
        // The age the herd was opened at: the seed puts a piglet down at the
        // weight its own days on the sow would have made, and the first day of
        // the plan has not been run yet.
        const ageDays = -piglet.birthDay;
        expect(piglet.weightKg).toBeLessThanOrEqual(ceilingAt(config, ageDays) + 1e-9);
        if (ageDays < 7) continue;
        ofAge += 1;
        kg += piglet.weightKg - BIRTH_WEIGHT_KG;
      }
      return kg / Math.max(1, ofAge);
    };
    expect(openingWeights(thin)).toBeLessThan(openingWeights(generous));
  });

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
        potentialGainKg: sucklers * potentialPigletGainKg(config, 21),
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
    // The whole point of the field: it is measured, so it is allowed to
    // disagree with the plan, in either direction. On the starter assumptions
    // it comes in above the target — the ration carries more than the target
    // asks for — and the gap is the farm's to read rather than the model's to
    // close.
    expect(weaning.averageWeightKg).not.toBe(weaning.referenceWeightKg);
    expect(weaning.averageWeightKg).toBeCloseTo(expectedWeaningWeightKg(config), 0);
    expect(weaning.dailyGainKg).toBeCloseTo(
      (weaning.averageWeightKg - BIRTH_WEIGHT_KG) / weaning.ageDays,
      9,
    );
    expect(weaning.creepFeedKg).toBeGreaterThan(0);
    expect(weaning.feedKgPerKgWeanedOverHorizon).toBeGreaterThan(0);
  }, 120_000);

  it("quotes the target with the age it was quoted at", () => {
    // A target is a weight by a day. A farm weaning at 28 against a figure the
    // breeding company quoted at 35 is not short of a ration, it is short of a
    // week, and a read-out that prints the weight alone says the wrong thing.
    const config = plan((c) => {
      c.growth.referenceWeaningWeightKg = 11.5;
      c.growth.referenceWeaningAgeDays = 35;
      c.reproduction.weaningAgeDays = 28;
    });
    const { weaning } = simulatePlan(config, { snapshots: false }).projection.summary;

    expect(weaning.referenceWeightKg).toBe(11.5);
    expect(weaning.referenceAgeDays).toBe(35);
    expect(weaning.ageDays).toBe(28);
    expect(weaningTargetLabel(weaning.referenceWeightKg, weaning.referenceAgeDays)).toBe(
      "11.5 kg by 35 days",
    );
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

    // The biological curve is an upper bound. Even a generous practical sow
    // ration cannot make the litter exceed it.
    const fed = plan((c) => (c.feed.lactationKgDay = 12));
    expect(expectedWeaningWeightKg(fed)).toBeLessThanOrEqual(
      fullyFedPigletWeightKg(fed, fed.reproduction.weaningAgeDays),
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

  it("preserves an old implied suckling rate as a relative curve calibration", () => {
    const stored = cloneDefaultConfig() as unknown as Record<string, unknown>;
    const growth = { ...(stored.growth as Record<string, unknown>) };
    delete growth.pigletGrowthPotentialPct;
    delete growth.referenceWeaningAgeDays;
    delete growth.referenceWeaningWeightKg;
    growth.weaningWeightKg = 9;
    stored.growth = growth;
    stored.reproduction = {
      ...(stored.reproduction as Record<string, unknown>),
      weaningAgeDays: 35,
    };

    const loaded = withConfigDefaults(stored)!;
    const implied = (9 - BIRTH_WEIGHT_KG) / 35;
    expect(loaded.growth.referenceWeaningAgeDays).toBe(35);
    expect(loaded.growth.pigletGrowthPotentialPct).toBeCloseTo(
      Math.max(50, Math.min(150, (implied / 0.28) * 100)),
      9,
    );
  });

  it("does not take a rate off a target a plan already knew was a target", () => {
    // The hole the old name could have left open. A plan written since the
    // weaning weight became a target has the new name in it, and taking a
    // growth rate off that weight would put the target back in the simulation
    // by the side door: inert in the plan on the screen and live in the one on
    // the disk, so that raising it grew the litters after all.
    const saved = (referenceWeaningWeightKg: number) => {
      const stored = cloneDefaultConfig() as unknown as Record<string, unknown>;
      const growth = { ...(stored.growth as Record<string, unknown>) };
      delete growth.pigletGrowthPotentialPct;
      growth.referenceWeaningWeightKg = referenceWeaningWeightKg;
      stored.growth = growth;
      return withConfigDefaults(stored)!;
    };

    const modest = saved(7);
    const ambitious = saved(12);
    expect(potentialPigletGainKg(ambitious, 14)).toBe(
      potentialPigletGainKg(modest, 14),
    );
    expect(expectedWeaningWeightKg(ambitious)).toBe(expectedWeaningWeightKg(modest));
  });

  it("maps a saved flat rate onto the curve without losing its relative tuning", () => {
    const stored = cloneDefaultConfig() as unknown as Record<string, unknown>;
    const growth = { ...(stored.growth as Record<string, unknown>) };
    delete growth.pigletGrowthPotentialPct;
    growth.pigletDailyGainKg = 0.25;
    stored.growth = growth;

    expect(withConfigDefaults(stored)?.growth.pigletGrowthPotentialPct).toBeCloseTo(
      (0.25 / 0.28) * 100,
      9,
    );
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
