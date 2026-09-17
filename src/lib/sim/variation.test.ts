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
  it("varies with the seed and repeats on the same one", () => {
    const first = Array.from({ length: 20 }, () =>
      new ChanceVariation(7, DEVIATIONS).litterSize(12.4),
    );
    const again = Array.from({ length: 20 }, () =>
      new ChanceVariation(7, DEVIATIONS).litterSize(12.4),
    );
    expect(again).toEqual(first);
    const other = Array.from({ length: 20 }, () =>
      new ChanceVariation(8, DEVIATIONS).litterSize(12.4),
    );
    expect(other).not.toEqual(first);
  });

  it("is what variationFor builds for a plan that asks for it", () => {
    expect(variationFor("chance", 1, DEVIATIONS).settled).toBe(false);
    expect(variationFor("settled", 1, DEVIATIONS).settled).toBe(true);
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
    expect(farm.lifetime.pigletDeaths / farm.lifetime.bornAlive).toBeCloseTo(
      config.reproduction.preWeanMortalityPct / 100,
      3,
    );
  }, 60_000);
});
