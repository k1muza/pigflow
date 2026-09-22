import { describe, expect, it } from "vitest";

import { cloneDefaultConfig, type PlannerConfig } from "../config";
import { GrowingPig } from "./animals";
import { runFarm } from "./index";
import {
  frailty,
  MORTALITY_PROFILES,
  MortalityScheduler,
  riskStillToCome,
  shareBefore,
  stageBands,
  stageMortalityRate,
} from "./mortality";

/** A litter of suckling pigs, born together, for booking into the piglet stage. */
function litter(size: number, birthDay = 0, from = 0): GrowingPig[] {
  return Array.from({ length: size }, (_, i) => {
    const tag = "PIG-" + String(from + i).padStart(5, "0");
    return new GrowingPig({ id: tag, tag, sex: "female", birthDay, weightKg: 1.4, stage: "piglet" });
  });
}

function bookedDeaths(pigs: GrowingPig[]): GrowingPig[] {
  return pigs.filter((pig) => pig.deathStage !== null);
}

function tenPercentPreWean(): PlannerConfig {
  const config = cloneDefaultConfig();
  config.reproduction.preWeanMortalityPct = 10;
  return config;
}

describe("Deaths are placed, not drawn", () => {
  it("charges a stage exactly what it owes and carries the fraction on", () => {
    const scheduler = new MortalityScheduler(tenPercentPreWean());

    // 12 piglets at 10% owe 1.2 deaths. No litter can lose a fifth of a pig, so
    // each is charged one and the remainders are carried: every fifth litter or
    // so loses two, and fifty litters lose the sixty the rate comes to.
    const perLitter = Array.from({ length: 50 }, (_, index) => {
      const members = litter(12, 0, index * 100);
      scheduler.enterStage(members, "piglet", 0);
      return bookedDeaths(members).length;
    });

    const total = perLitter.reduce((sum, count) => sum + count, 0);
    expect(total).toBe(60);
    // It is the carrying that does it: the litters are not uniform, and none is
    // handed a share of a pig.
    expect(new Set(perLitter)).toEqual(new Set([1, 2]));
    expect(perLitter.filter((count) => count === 2).length).toBe(10);
  });

  it("does not open every plan with a stretch that cannot lose anything", () => {
    // A stage whose slate started at nothing would owe its first whole death
    // only once enough pigs had been through it — so a small herd on a short
    // plan would report none at all, on every seed. Each slate opens partly
    // written instead, from the seed, so the first loss lands where it should.
    const opening = [1, 2, 3, 4, 5, 6, 7, 8].map((seed) => {
      const config = tenPercentPreWean();
      config.project.seed = seed;
      const scheduler = new MortalityScheduler(config);
      // One small litter: far less than a whole death owed on its own.
      const members = litter(3, 0, 0);
      scheduler.enterStage(members, "piglet", 0);
      return bookedDeaths(members).length;
    });

    expect(opening.some((count) => count > 0)).toBe(true);
    // And it never invents more than the one animal the opening balance can add.
    for (const count of opening) expect(count).toBeLessThanOrEqual(1);
  });

  it("puts a stage's losses on the pigs with most of it left to run", () => {
    // Starting stock is placed across a stage rather than all on its first day,
    // so one cohort can hold a pig with the whole finishing house ahead of it
    // and one with a quarter of it left. The second carries about a quarter of
    // the risk, and the losses should follow that rather than falling evenly
    // over whoever happens to be standing in the pen.
    const justIn = cloneDefaultConfig().growth.finisherStartWeightKg;
    const span = cloneDefaultConfig().growth.saleWeightKg - justIn;
    const nearlyDone = justIn + span * 0.75;

    let fresh = 0;
    let total = 0;
    // One cohort books only a handful of deaths, which is too few to read a
    // three-to-one weighting off, so the same cohort is run on many seeds.
    for (let seed = 1; seed <= 20; seed += 1) {
      const config = cloneDefaultConfig();
      config.growth.finisherMortalityPct = 40;
      config.project.seed = seed;
      const scheduler = new MortalityScheduler(config);
      const members = Array.from({ length: 40 }, (_, i) => {
        const tag = "PIG-" + String(i).padStart(5, "0");
        return new GrowingPig({
          id: tag,
          tag,
          sex: "female",
          birthDay: 0,
          weightKg: i % 2 === 0 ? nearlyDone : justIn,
          stage: "finisher",
        });
      });
      scheduler.enterStage(members, "finisher", 0);
      for (const pig of bookedDeaths(members)) {
        total += 1;
        if (pig.weightKg === justIn) fresh += 1;
      }
    }

    expect(total).toBeGreaterThan(100);
    // Frailty alone would split these evenly, at a half.
    expect(fresh / total).toBeGreaterThan(0.65);
  });

  it("never books a fraction of a pig", () => {
    const scheduler = new MortalityScheduler(tenPercentPreWean());
    for (let index = 0; index < 20; index += 1) {
      const members = litter(11, 0, index * 100);
      scheduler.enterStage(members, "piglet", 0);
      for (const pig of members) {
        if (pig.deathDay === null) continue;
        expect(Number.isInteger(pig.deathDay)).toBe(true);
      }
    }
  });

  it("hands a death back to the stage when a pig leaves it alive", () => {
    const scheduler = new MortalityScheduler(tenPercentPreWean());
    const members = litter(12);
    scheduler.enterStage(members, "piglet", 0);

    const [doomed] = bookedDeaths(members);
    expect(doomed).toBeDefined();
    const owedBefore = scheduler.debt("piglet");

    scheduler.release(doomed);
    expect(doomed.deathStage).toBeNull();
    expect(doomed.deathDay).toBeNull();
    // The loss is not lost: the stage carries it on to the next cohort through.
    expect(scheduler.debt("piglet")).toBeCloseTo(owedBefore + 1, 6);
  });

  it("settles a death that happened without owing it again", () => {
    const scheduler = new MortalityScheduler(tenPercentPreWean());
    const members = litter(12);
    scheduler.enterStage(members, "piglet", 0);

    const [doomed] = bookedDeaths(members);
    const owedBefore = scheduler.debt("piglet");
    scheduler.settle(doomed);
    expect(scheduler.debt("piglet")).toBeCloseTo(owedBefore, 6);
  });

  it("picks the same pigs however the herd around them changes", () => {
    // Frailty is read off the animal, not off a shared stream, so it cannot be
    // shifted by something that happened elsewhere on the farm first.
    const first = frailty(7, "piglet", 0, "PIG-00042");
    const again = frailty(7, "piglet", 0, "PIG-00042");
    expect(again).toBe(first);
    expect(frailty(8, "piglet", 0, "PIG-00042")).not.toBe(first);
    expect(frailty(7, "weaner", 0, "PIG-00042")).not.toBe(first);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThan(1);
  });
});

describe("Losses land when a herd really loses them", () => {
  /** The day of life each booked death falls on, over a run of ordinary litters. */
  function deathDaysOver(litters: number, timing: "profiled" | "even"): number[] {
    const config = cloneDefaultConfig();
    config.health.mortalityTiming = timing;
    const scheduler = new MortalityScheduler(config);
    const days: number[] = [];
    for (let index = 0; index < litters; index += 1) {
      const members = litter(12, 0, index * 100);
      scheduler.enterStage(members, "piglet", 0);
      for (const pig of members) {
        if (pig.deathDay !== null) days.push(pig.deathDay);
      }
    }
    return days;
  }

  function bandShares(days: number[]): [number, number, number] {
    const share = (kept: (day: number) => boolean) =>
      days.filter(kept).length / days.length;
    return [
      share((day) => day <= 3),
      share((day) => day > 3 && day <= 7),
      share((day) => day > 7),
    ];
  }

  it("reproduces the risk curve across a stage, not just inside a big cohort", () => {
    // An ordinary litter owes one death, and one death can only be placed in one
    // spot — so a curve worked out inside each cohort would put every loss on
    // the same day of life and never touch its later bands at all. The timing
    // walk is carried between cohorts, so the farm as a whole follows the curve.
    const days = deathDaysOver(200, "profiled");
    expect(days.length).toBeGreaterThan(100);

    // Near the 55/20/25 the profile asks for, rather than exactly on it: each
    // death's place on the curve is read off the pig rather than counted out,
    // which is what stops the losses moving when the herd around them does, and
    // costs a few points of fidelity in exchange. Flat would be 14/14/72.
    const [early, middle, late] = bandShares(days);
    expect(early).toBeGreaterThan(0.45);
    expect(early).toBeLessThan(0.65);
    expect(middle).toBeGreaterThan(0.12);
    expect(middle).toBeLessThan(0.28);
    expect(late).toBeGreaterThan(0.18);
    expect(late).toBeLessThan(0.35);
    // And they are spread over the stage rather than stacked on a few days.
    expect(new Set(days).size).toBeGreaterThan(20);
  });

  it("spreads them flat when the plan asks for even timing", () => {
    const days = deathDaysOver(200, "even");
    const [early] = bandShares(days);
    // The first band is the first four days of life, so a flat spread puts
    // four days' worth of the stage in it. Measured against the stage the plan
    // actually has rather than against a number: a farm weaning at 35 days has
    // a longer stage to spread the same losses over, and "flat" is a shape
    // rather than a share.
    const stageDays = cloneDefaultConfig().reproduction.weaningAgeDays;
    const flat = 4 / stageDays;
    expect(early).toBeGreaterThan(flat * 0.6);
    expect(early).toBeLessThan(flat * 1.5);
    expect(new Set(days).size).toBeGreaterThan(20);
  });

  it("changes when pigs die, not how many", () => {
    const profiled = cloneDefaultConfig();
    profiled.reproduction.preWeanMortalityPct = 40;
    const even = cloneDefaultConfig();
    even.reproduction.preWeanMortalityPct = 40;
    even.health.mortalityTiming = "even";

    const under = (config: PlannerConfig) => {
      const scheduler = new MortalityScheduler(config);
      const members = litter(20);
      scheduler.enterStage(members, "piglet", 0);
      return bookedDeaths(members).length;
    };

    expect(under(even)).toBe(under(profiled));
  });
});

describe("An animal is taken where it actually stands", () => {
  const WEAN = cloneDefaultConfig().reproduction.weaningAgeDays;

  /** Books many litters of a given age and returns each death's day of life. */
  function deathAges(ageAtBooking: number): number[] {
    const config = cloneDefaultConfig();
    config.reproduction.preWeanMortalityPct = 40;
    const scheduler = new MortalityScheduler(config);
    const ages: number[] = [];
    for (let index = 0; index < 120; index += 1) {
      const members = Array.from({ length: 12 }, (_, i) => {
        const tag = "PIG-" + String(index * 100 + i).padStart(5, "0");
        return new GrowingPig({
          id: tag,
          tag,
          sex: "female",
          birthDay: -ageAtBooking,
          weightKg: 1.4,
          stage: "piglet",
        });
      });
      scheduler.enterStage(members, "piglet", 0);
      for (const pig of members) {
        if (pig.deathDay !== null) ages.push(pig.deathDay + ageAtBooking);
      }
    }
    return ages;
  }

  it("does not treat a part-grown piglet as a newborn", () => {
    // Starting stock is booked in partway through a stage. Laying the risk curve
    // from the day it was booked would put a three-week-old piglet back in the
    // first days of life, where most of the danger is and where it plainly is
    // not — it has already lived through them.
    const threeWeeks = deathAges(21);
    expect(threeWeeks.length).toBeGreaterThan(20);
    expect(Math.min(...threeWeeks)).toBeGreaterThanOrEqual(21);
    expect(Math.max(...threeWeeks)).toBeLessThan(WEAN);

    // A newborn litter still uses the whole stage.
    const newborn = deathAges(0);
    expect(Math.min(...newborn)).toBe(0);
    expect(Math.max(...newborn)).toBeGreaterThan(21);
  });

  it("charges what is left of the curve, not what is left of the calendar", () => {
    const bands = stageBands(MORTALITY_PROFILES.piglet, WEAN);

    const dayFour = shareBefore(bands, 4);
    // Four days in, a piglet has most of its days ahead of it and most of its
    // danger behind it. Prorating on time would charge it roughly twice over.
    expect(1 - dayFour).toBeLessThan(0.5);
    expect((WEAN - 4) / WEAN).toBeGreaterThan(0.8);

    expect(riskStillToCome(0.4, dayFour)).toBeLessThan(0.4 * ((WEAN - 4) / WEAN));
    // Nothing behind it yet means the whole stage rate.
    expect(riskStillToCome(0.4, 0)).toBeCloseTo(0.4, 9);
  });

  it("does not take a new breeder for risk the herd ran up before it arrived", () => {
    // How many of the breeding herd go is a farm-level figure, and a slate that
    // falls due the week a replacement boar arrives must not fall on him.
    let takenFromNewcomers = 0;
    const rounds = 24;

    for (let seed = 1; seed <= rounds; seed += 1) {
      const config = cloneDefaultConfig();
      config.project.seed = seed;
      config.herd.sowAnnualMortalityPct = 8;
      const scheduler = new MortalityScheduler(config);

      const oldTimers = [
        { tag: "SOW-001", birthDay: -900 },
        { tag: "SOW-002", birthDay: -850 },
        { tag: "BOAR-01", birthDay: -800 },
      ];
      // Years of standing, so the herd has real exposure behind it.
      for (let day = 0; day < 1500; day += 1) scheduler.claimBreedingDeaths(oldTimers);

      // A boar bought this morning joins them.
      const newcomer = { tag: "BOAR-09", birthDay: -400 };
      const herd = [...oldTimers, newcomer];
      for (let day = 0; day < 120; day += 1) {
        for (const taken of scheduler.claimBreedingDeaths(herd)) {
          if (taken.tag === newcomer.tag) takenFromNewcomers += 1;
        }
      }
    }

    // Ranking on frailty alone would have made this about one in four.
    expect(takenFromNewcomers).toBeLessThanOrEqual(2);
  });
});

describe("The plan gets back the mortality it was given", () => {
  const YEARS = 5;

  function realised(seed: number) {
    const input = cloneDefaultConfig();
    input.project.seed = seed;
    input.project.months = YEARS * 12;
    const farm = runFarm(input);
    return {
      preWean: farm.lifetime.pigletDeaths / farm.lifetime.bornAlive,
      sold: farm.lifetime.sold,
    };
  }

  it("holds pre-weaning losses close to the input even on a two-sow herd", () => {
    const target = cloneDefaultConfig().reproduction.preWeanMortalityPct / 100;
    const rates = [1, 2, 3, 4, 5, 6].map((seed) => realised(seed).preWean);

    for (const rate of rates) {
      // Coin flips on a herd this small used to swing several points either way.
      expect(Math.abs(rate - target)).toBeLessThan(0.01);
    }
    const mean = rates.reduce((sum, rate) => sum + rate, 0) / rates.length;
    expect(mean).toBeCloseTo(target, 2);
    // Six five-year runs, which is minutes of work when the whole suite is
    // competing for the same cores.
  }, 60_000);

  it("holds the realised rate steady across seeds, which output does not", () => {
    const seeds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    const runs = seeds.map((seed) => realised(seed));

    // What this scheduler is answerable for: the rate comes back as set, on
    // every seed. A point and a half of swing either way used to be ordinary.
    //
    // The bound is the spread the scheduler really holds to rather than the
    // spread these twelve seeds happen to show. Measured over thirty seeds it
    // is about 0.009 either side, and it was the same before mating was barred
    // to the maternal grandsire — that change moves which seed lands where
    // without making the rate any less answerable. A bound tuned to one seed
    // window fails the next time anything upstream of the draw moves.
    const rates = runs.map((run) => run.preWean);
    expect(Math.max(...rates) - Math.min(...rates)).toBeLessThan(0.01);

    // What it is not answerable for: how many pigs the farm produces still
    // moves with the seed, because litter size and conception are drawn and
    // an unlucky start compounds over five years on a two-sow herd. Comparing
    // two plans on one seed will mislead; the spread has to be shown.
    const sold = runs.map((run) => run.sold);
    expect(Math.max(...sold) - Math.min(...sold)).toBeGreaterThan(100);
  }, 60_000);

  it("reproduces a run exactly", () => {
    const input = cloneDefaultConfig();
    input.project.months = 24;
    const first = runFarm(input);
    const again = runFarm(input);
    expect(again.lifetime.pigletDeaths).toBe(first.lifetime.pigletDeaths);
    expect(again.lifetime.growingDeaths).toBe(first.lifetime.growingDeaths);
    expect(again.lifetime.sold).toBe(first.lifetime.sold);
  });

  it("loses no pigs at all when every mortality input is zero", () => {
    const input = cloneDefaultConfig();
    input.project.months = 24;
    input.reproduction.preWeanMortalityPct = 0;
    input.growth.weanerMortalityPct = 0;
    input.growth.growerMortalityPct = 0;
    input.growth.finisherMortalityPct = 0;
    input.herd.sowAnnualMortalityPct = 0;
    const farm = runFarm(input);
    expect(farm.lifetime.pigletDeaths).toBe(0);
    expect(farm.lifetime.growingDeaths).toBe(0);
    expect(farm.lifetime.breedingDeaths).toBe(0);
  });

  it("reads each stage's rate off the input it belongs to", () => {
    const config = cloneDefaultConfig();
    expect(stageMortalityRate("piglet", config)).toBeCloseTo(
      config.reproduction.preWeanMortalityPct / 100,
      9,
    );
    expect(stageMortalityRate("weaner", config)).toBeCloseTo(
      config.growth.weanerMortalityPct / 100,
      9,
    );
    // A gilt carries the breeding herd's annual risk, over her time in rearing.
    expect(stageMortalityRate("gilt", config)).toBeLessThan(
      config.herd.sowAnnualMortalityPct / 100,
    );
    expect(stageMortalityRate("gilt", config)).toBeGreaterThan(0);
  });
});
