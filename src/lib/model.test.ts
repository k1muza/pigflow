import { describe, expect, it } from "vitest";

import {
  calculateProjection,
  cloneDefaultConfig,
  getModelMetrics,
  withConfigDefaults,
  type PlannerConfig,
} from "./model";
import { feedOf, EXPENSE_CATEGORIES, INCOME_CATEGORIES, runFarm } from "./sim";

function config(): PlannerConfig {
  return cloneDefaultConfig();
}

describe("PigFlow monthly projection", () => {
  it("starts the default plan with no cash so the funding gap is visible", () => {
    const input = config();
    const result = calculateProjection(input);
    expect(input.project.openingCash).toBe(0);
    expect(result.summary.peakFundingNeed).toBeGreaterThan(0);
    expect(result.summary.peakFundingNeed).toBeCloseTo(-result.summary.lowestCash, 6);
  });

  it("uses the real number of days in each calendar month", () => {
    const result = calculateProjection(config());
    expect(result.months[0].days).toBe(31);
    expect(result.months[1].date).toBe("2027-02-01");
    expect(result.months[1].days).toBe(28);
  });

  it("reconciles opening cash, monthly net cash and closing cash", () => {
    const input = config();
    const result = calculateProjection(input);
    let expectedCash = input.project.openingCash;
    for (const month of result.months) {
      expectedCash += month.netCashFlow;
      expect(month.closingCash).toBeCloseTo(expectedCash, 6);
      expect(month.totalCost).toBeCloseTo(
        EXPENSE_CATEGORIES.reduce((sum, category) => sum + month.totals[category], 0),
        6,
      );
      expect(month.revenue).toBeCloseTo(
        INCOME_CATEGORIES.reduce((sum, category) => sum + month.totals[category], 0),
        6,
      );
    }
  });

  it("dresses the liveweight out and prices the carcass, not the live pig", () => {
    const input = config();
    const result = calculateProjection(input);
    const saleMonth = result.months.find((month) => month.pigsSold > 0);
    expect(saleMonth).toBeDefined();
    expect(saleMonth!.saleLiveweightKg / saleMonth!.pigsSold).toBeGreaterThanOrEqual(
      input.growth.saleWeightKg,
    );
    expect(saleMonth!.saleDeadweightKg).toBeCloseTo(
      (saleMonth!.saleLiveweightKg * input.finance.dressingPct) / 100,
      6,
    );
    expect(saleMonth!.totals["pig-sales"]).toBeCloseTo(
      saleMonth!.saleDeadweightKg * input.finance.salePriceKg,
      6,
    );
    // The price is quoted per kg deadweight, so it must never be applied live.
    expect(saleMonth!.totals["pig-sales"]).toBeLessThan(
      saleMonth!.saleLiveweightKg * input.finance.salePriceKg,
    );
  });

  it("increases feed cost and reduces closing cash when FCR worsens", () => {
    const base = config();
    const inefficient = config();
    inefficient.growth.gainFeedKgAt100Kg = 3.4;
    const baseResult = calculateProjection(base);
    const inefficientResult = calculateProjection(inefficient);
    expect(inefficientResult.summary.totalFeedCost).toBeGreaterThan(
      baseResult.summary.totalFeedCost,
    );
    expect(inefficientResult.summary.closingCash).toBeLessThan(baseResult.summary.closingCash);
  });

  it("does not create pigs when there is no starting herd", () => {
    const input = config();
    input.stock = { sows: 0, gilts: 0, boars: 0, weaners: 0, growers: 0, finishers: 0 };
    const result = calculateProjection(input);
    expect(result.summary.totalPigsSold).toBe(0);
    expect(result.months.every((month) => month.bornAlive === 0)).toBe(true);
  });

  it("stops breeding once the sows already in pig have farrowed and there is no boar", () => {
    const input = config();
    input.herd.startMode = "staggered";
    input.stock.boars = 0;
    const result = calculateProjection(input);
    // Sows that started the plan pregnant still farrow; nothing is served after that.
    expect(result.summary.totalBornAlive).toBeGreaterThan(0);
    expect(result.months.slice(6).every((month) => month.bornAlive === 0)).toBe(true);
    expect(result.warnings.some((warning) => warning.title === "No boar on the farm")).toBe(true);
  });

  it("never produces invalid or negative animal counts", () => {
    const result = calculateProjection(config());
    for (const month of result.months) {
      for (const value of [
        month.piglets,
        month.weaners,
        month.growers,
        month.finishers,
        month.gilts,
        month.pigsSold,
        month.sows,
      ]) {
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(value)).toBe(true);
      }
    }
  });

  it("repeats exactly for one seed and moves for another", () => {
    const first = calculateProjection(config());
    const repeat = calculateProjection(config());
    expect(repeat.summary.closingCash).toBe(first.summary.closingCash);
    expect(repeat.summary.totalPigsSold).toBe(first.summary.totalPigsSold);

    const other = config();
    other.project.seed = 7;
    const otherResult = calculateProjection(other);
    expect(otherResult.summary.totalPigsSold).not.toBe(first.summary.totalPigsSold);
    // Different luck, same farm: the outcome should still be in the same league.
    expect(otherResult.summary.totalPigsSold).toBeGreaterThan(first.summary.totalPigsSold * 0.75);
    expect(otherResult.summary.totalPigsSold).toBeLessThan(first.summary.totalPigsSold * 1.25);
  });

  it("lands close to the hand-checkable planning metrics", () => {
    // Read across seeds rather than on one. The benchmark is what the plan's
    // rates say a sow should manage, which is a statement about the model and
    // not about any one roll of its dice — and a single run swings about 1.4
    // weaned pigs a sow year between seeds, most of a third of the tolerance.
    // On one seed this was a coin toss: the default plan passed on seed 1 and
    // would have failed on seed 3, which tested where the luck landed.
    const metrics = getModelMetrics(config());
    const runs = [1, 2, 3, 4, 5].map((seed) => {
      const input = config();
      input.project.seed = seed;
      return calculateProjection(input).summary;
    });
    const mean = (pick: (s: (typeof runs)[number]) => number) =>
      runs.reduce((sum, run) => sum + pick(run), 0) / runs.length;

    const litters = mean((run) => run.littersPerSowYear);
    const weaned = mean((run) => run.pigsWeanedPerSowYear);
    expect(litters).toBeGreaterThan(metrics.littersPerSowYear - 0.45);
    expect(litters).toBeLessThan(metrics.littersPerSowYear + 0.35);
    expect(weaned).toBeGreaterThan(metrics.pigsWeanedPerSowYear - 5);
    expect(weaned).toBeLessThan(metrics.pigsWeanedPerSowYear + 5);
  });
});

describe("Zooming in and out", () => {
  it("rolls twelve months into each plan year without losing money", () => {
    const result = calculateProjection(config());
    expect(result.years).toHaveLength(3);

    for (const year of result.years) {
      const months = result.months.filter((month) => year.months.includes(month.index));
      expect(months).toHaveLength(12);
      expect(year.revenue).toBeCloseTo(
        months.reduce((sum, month) => sum + month.revenue, 0),
        6,
      );
      expect(year.totalCost).toBeCloseTo(
        months.reduce((sum, month) => sum + month.totalCost, 0),
        6,
      );
      expect(year.closingCash).toBeCloseTo(months.at(-1)!.closingCash, 6);
    }

    const totalFromYears = result.years.reduce((sum, year) => sum + year.netCashFlow, 0);
    expect(result.summary.closingCash).toBeCloseTo(
      cloneDefaultConfig().project.openingCash + totalFromYears,
      6,
    );
  });

  it("answers what a single month is expected to earn and spend", () => {
    const result = calculateProjection(config());
    // Pigs go in cohorts, so a month either has a kill in it or it does not.
    // This is a month with one.
    const month = result.months.find((row) => row.pigsSold > 0)!;
    expect(month).toBeDefined();
    const income = INCOME_CATEGORIES.reduce((sum, key) => sum + month.totals[key], 0);
    const spend = EXPENSE_CATEGORIES.reduce((sum, key) => sum + month.totals[key], 0);
    expect(income).toBeGreaterThan(0);
    expect(spend).toBeGreaterThan(0);
    expect(feedOf(month.totals)).toBeGreaterThan(0);
    expect(month.totals.overheads).toBeGreaterThan(0);
    expect(month.netCashFlow).toBeCloseTo(income - spend, 6);
  });
});

describe("Herd flow", () => {
  it("does not collapse the whole herd into one farrowing batch", () => {
    const input = config();
    input.stock.sows = 10;
    input.herd.startMode = "staggered";
    input.herd.maxSows = 20;
    const result = calculateProjection(input);
    // Skip year one: the founding herd is placed evenly by construction.
    const births = result.months.slice(12).map((month) => month.bornAlive);
    const mean = births.reduce((sum, value) => sum + value, 0) / births.length;
    expect(mean).toBeGreaterThan(0);
    // Gilts are drawn from a run of litters, so no month carries a whole cycle.
    expect(Math.max(...births)).toBeLessThan(mean * 2.5);
  });

  it("spreads gilt intake across several litters rather than emptying one", () => {
    const input = config();
    input.stock.sows = 10;
    input.herd.startMode = "staggered";
    input.herd.maxSows = 24;
    const farm = runFarm(input);
    const promotionDays = farm.history
      .filter((day) => day.giltsPromoted > 0)
      .map((day) => day.day);
    expect(promotionDays.length).toBeGreaterThan(5);
    const firstTen = promotionDays.slice(0, 10);
    // The first ten replacements arrive over months, not over one week.
    expect(firstTen.at(-1)! - firstTen[0]).toBeGreaterThan(45);
  });
});

describe("Plans saved before a field existed still load", () => {
  it("fills in what a stored plan does not know about", () => {
    const stored = JSON.parse(JSON.stringify(cloneDefaultConfig())) as Record<
      string,
      Record<string, unknown>
    >;
    // A plan saved before working capital and the generated-row flag arrived.
    delete stored.finance.workingCapitalTarget;
    stored.finance.cashMovements = [
      { id: "old", monthIndex: 2, kind: "in", amount: 1_000, note: "Grant" },
    ];
    delete stored.feed.truckCapacityKg;
    stored.herd.maxSows = 30;
    delete stored.housing;

    const restored = withConfigDefaults(stored);
    expect(restored).not.toBeNull();
    expect(restored!.finance.workingCapitalTarget).toBe(0);
    expect(restored!.feed.truckCapacityKg).toBe(2_800);
    // The places are scaled off the old planning ratios; everything else the
    // section has gained since is filled in from the defaults.
    expect(restored!.housing).toEqual({
      ...cloneDefaultConfig().housing,
      farrowingPlaces: 9,
      weanerPlaces: 84,
      growerPlaces: 65,
      finisherPlaces: 166,
    });
    // A row typed before the flag existed is a row you typed, not a generated one.
    expect(restored!.finance.cashMovements[0].auto).toBe(false);
    expect(restored!.finance.cashMovements[0].amount).toBe(1_000);
  });

  it("refuses a plan that is not a plan at all", () => {
    expect(withConfigDefaults(null)).toBeNull();
    expect(withConfigDefaults({ project: { months: -4 } })).toBeNull();
  });

  it("opens plans saved with experimental housing enforcement in observation-only mode", () => {
    const stored = cloneDefaultConfig();
    stored.housing.enforceCapacity = true;

    expect(withConfigDefaults(stored)?.housing.enforceCapacity).toBe(false);
  });
});
