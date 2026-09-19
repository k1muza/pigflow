import { describe, expect, it } from "vitest";

import { cloneDefaultConfig, type PlannerConfig } from "../config";
import { runFarm } from "./index";
import { ChanceVariation, SettledVariation, variationFor } from "./variation";

const DEVIATIONS = { litter: 2.6, gestation: 1.4, weanToService: 2.5 };

function plan(mode: "chance" | "settled", seed: number, tweak?: (c: PlannerConfig) => void) {
  const config = cloneDefaultConfig();
  config.project.variation = mode;
  config.project.seed = seed;
  config.project.months = 60;
  tweak?.(config);
  return config;
}

describe("Settled: the rates come back exactly, carried to whole animals", () => {
  it("uses a deterministic wide litter distribution and records total-born outcomes", () => {
    const settled = new SettledVariation();
    const outcomes = Array.from({ length: 80 }, () =>
      settled.farrowingOutcome(12.4, 3, 6, 1.5),
    );
    expect(new Set(outcomes.map((outcome) => outcome.bornAlive)).size).toBeGreaterThan(5);
    expect(Math.min(...outcomes.map((outcome) => outcome.bornAlive))).toBeLessThanOrEqual(9);
    expect(Math.max(...outcomes.map((outcome) => outcome.bornAlive))).toBeGreaterThanOrEqual(15);
    expect(outcomes.reduce((sum, outcome) => sum + outcome.stillborn, 0)).toBeGreaterThan(0);
    expect(outcomes.reduce((sum, outcome) => sum + outcome.mummified, 0)).toBeGreaterThan(0);
  });

  it("averages the born-alive figure a plan states, without fractions of a pig", () => {
    const settled = new SettledVariation();
    const sizes = Array.from({ length: 500 }, () => settled.litterSize(12.4));

    for (const size of sizes) expect(Number.isInteger(size)).toBe(true);
    // 12.4 is not a litter, so litters of 12 and 13 fall in the pattern that
    // averages it — the 0.4 left over each time is carried to the next sow.
    expect(new Set(sizes)).toEqual(new Set([12, 13]));
    const mean = sizes.reduce((sum, size) => sum + size, 0) / sizes.length;
    expect(mean).toBeCloseTo(12.4, 2);
  });

  it("holds services at the rate the plan states", () => {
    const settled = new SettledVariation();
    const held = Array.from({ length: 1000 }, () => settled.conceives(0.85)).filter(Boolean);
    expect(held.length / 1000).toBeCloseTo(0.85, 2);
  });

  it("never holds at nought and always holds at one", () => {
    const settled = new SettledVariation();
    expect(Array.from({ length: 50 }, () => settled.conceives(0)).some(Boolean)).toBe(false);
    expect(Array.from({ length: 50 }, () => settled.conceives(1)).every(Boolean)).toBe(true);
  });

  it("splits the sexes evenly", () => {
    const settled = new SettledVariation();
    const females = Array.from({ length: 400 }, () => settled.sex()).filter(
      (sex) => sex === "female",
    );
    expect(females.length).toBe(200);
  });

  it("takes gestation and the weaning interval at their stated lengths", () => {
    const settled = new SettledVariation();
    expect(settled.gestationDays(114)).toBe(114);
    expect(settled.weanToServiceDays(6)).toBe(6);
  });

  it("still spreads a litter, because a settled plan is not a uniform one", () => {
    // Litter mates that all reached sale weight on one day would be a batch no
    // real farm sends. The spread is handed out rather than drawn, so it is the
    // same every run — but it is still there.
    const settled = new SettledVariation();
    const factors = Array.from({ length: 8 }, () => settled.growthFactor(0.07));
    expect(new Set(factors).size).toBe(8);
    expect(Math.min(...factors)).toBeLessThan(0.95);
    expect(Math.max(...factors)).toBeGreaterThan(1.05);
    const mean = factors.reduce((sum, f) => sum + f, 0) / factors.length;
    expect(mean).toBeCloseTo(1, 6);
  });

  it("brings gilts into heat across the window rather than all on one day", () => {
    const settled = new SettledVariation();
    const offsets = Array.from({ length: 21 }, () => settled.estrusOffsetDays(21));
    expect(new Set(offsets).size).toBe(21);
  });
});

describe("Chance: the plan still rolls for its year", () => {
  /** Twenty sows farrowing on twenty days, which is what a draw is keyed to. */
  const litters = (seed: number) => {
    const chance = new ChanceVariation(seed, DEVIATIONS);
    return Array.from({ length: 20 }, (_, i) => chance.litterSize(12.4, ["S" + i, 100 + i]));
  };

  it("varies with the seed and repeats on the same one", () => {
    expect(litters(7)).toEqual(litters(7));
    expect(litters(8)).not.toEqual(litters(7));
    // And it is a spread rather than one number handed out twenty times.
    expect(new Set(litters(7)).size).toBeGreaterThan(3);
  });

  it("gives a sow the same figure whatever else the farm did that day", () => {
    // The point of keying. Under a shared stream a draw's value depended on how
    // many times everything else had called first, so adding a rule anywhere
    // moved every outcome after it. Here the answer to "did S7 hold on day 90"
    // is the same question asked in any order, or twice, or on its own.
    const chance = new ChanceVariation(3, DEVIATIONS);
    const alone = chance.conceives(0.85, ["S7", 90]);

    const busy = new ChanceVariation(3, DEVIATIONS);
    for (let i = 0; i < 500; i += 1) {
      busy.heatSpotted(0.9, ["S" + i, 90]);
      busy.sex(["P" + i]);
      busy.gestationDays(115, ["S" + i, 90]);
    }
    expect(busy.conceives(0.85, ["S7", 90])).toBe(alone);
    // Asking twice is asking the same thing, not taking the next value.
    expect(busy.conceives(0.85, ["S7", 90])).toBe(alone);
  });

  it("keeps one sow's occasions apart, and two questions about one occasion", () => {
    const chance = new ChanceVariation(11, DEVIATIONS);
    // The same sow served on forty different days is forty different services,
    // not one answer repeated.
    const days = Array.from({ length: 40 }, (_, d) => chance.gestationDays(115, ["S1", d]));
    expect(new Set(days.map((n) => n.toFixed(6))).size).toBeGreaterThan(30);

    // And two different questions keyed the same way must not share an answer,
    // which is what each method's own label is for.
    const tags = Array.from({ length: 60 }, (_, i) => "S" + i);
    const held = tags.map((tag) => chance.conceives(0.5, [tag, 10]));
    const spotted = tags.map((tag) => chance.heatSpotted(0.5, [tag, 10]));
    expect(spotted).not.toEqual(held);
  });

  it("is what variationFor builds for a plan that asks for it", () => {
    expect(variationFor("chance", 1, DEVIATIONS).settled).toBe(false);
    expect(variationFor("settled", 1, DEVIATIONS).settled).toBe(true);
  });

  it("keeps a cost change to the money, and off the herd", () => {
    // A guard rather than the proof. The proof that keying fixed something is
    // the generator test above, which a shared stream fails outright: 500
    // intervening draws moved a sow's answer.
    //
    // This one would have passed before too, because changing a price takes no
    // draw and so could not shift a stream either. It is here for what comes
    // next: the moment a cost path starts drawing — a delivery that sometimes
    // arrives late, a vet visit that sometimes finds something — this is the
    // test that says so, instead of the herd quietly changing under a price.
    //
    // Bedding is a cost and nothing else: it is not fed to anything, it kills
    // nothing, and no animal's life turns on what it costs.
    const dear = plan("chance", 4, (c) => (c.housing.beddingCostPerKg = 2));
    const cheap = plan("chance", 4, (c) => (c.housing.beddingCostPerKg = 1));

    const dearer = runFarm(dear);
    const cheaper = runFarm(cheap);

    expect(dearer.ledger.totals.bedding).toBeGreaterThan(cheaper.ledger.totals.bedding);
    // Same pigs, same sexes, same days, down to the animal.
    expect(dearer.lifetime.sold).toBe(cheaper.lifetime.sold);
    expect(dearer.lifetime.bornAlive).toBe(cheaper.lifetime.bornAlive);
    expect(dearer.lifetime.litters).toBe(cheaper.lifetime.litters);
    expect(dearer.lifetime.weaned).toBe(cheaper.lifetime.weaned);
    expect(dearer.lifetime.bornAlive).toBeGreaterThan(0);
    expect(dearer.history.map((day) => day.counts.total)).toEqual(
      cheaper.history.map((day) => day.counts.total),
    );
  });
});

describe("What the two modes are for", () => {
  it("gives a settled plan one answer, whatever the seed says", () => {
    const runs = [1, 7, 99, 1000000].map((seed) => {
      const farm = runFarm(plan("settled", seed));
      return {
        sold: farm.lifetime.sold,
        bornAlive: farm.lifetime.bornAlive,
        breakEven: farm.state().costOfProduction.fullCostPerDeadweightKg,
      };
    });
    for (const run of runs) expect(run).toEqual(runs[0]);
    // And it is a working farm, not a degenerate one.
    expect(runs[0].sold).toBeGreaterThan(500);
  }, 60_000);

  it("keeps a chance plan moving with the seed", () => {
    const sold = [1, 7, 99, 1000000].map((seed) => runFarm(plan("chance", seed)).lifetime.sold);
    expect(new Set(sold).size).toBeGreaterThan(1);
  }, 60_000);

  it("settles the small comparison a chance plan cannot call", () => {
    // One more sow place is the case that a rolled plan answers differently
    // depending on the seed. A settled plan answers it once.
    const deltas = [1, 2, 3, 4, 5, 6].map((seed) => {
      const before = runFarm(plan("settled", seed)).state().costOfProduction
        .fullCostPerDeadweightKg;
      const after = runFarm(plan("settled", seed, (c) => (c.herd.maxSows += 1))).state()
        .costOfProduction.fullCostPerDeadweightKg;
      return (after - before) / before;
    });
    for (const delta of deltas) expect(delta).toBeCloseTo(deltas[0], 9);
  }, 120_000);

  it("holds the plan's own reproduction figures on a settled run", () => {
    const config = plan("settled", 1);
    const farm = runFarm(config);
    expect(farm.lifetime.bornAlive / farm.lifetime.litters).toBeCloseTo(
      config.reproduction.bornAlivePerLitter,
      1,
    );
    // Within a tenth of a percentage point of what was typed in. Held as an
    // explicit bound rather than a decimal place, because the scheduler is
    // answerable for the rate and not for landing on a rounding boundary.
    expect(
      Math.abs(
        farm.lifetime.pigletDeaths / farm.lifetime.bornAlive -
          config.reproduction.preWeanMortalityPct / 100,
      ),
    ).toBeLessThan(0.001);
  }, 60_000);
});
