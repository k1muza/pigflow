import { beforeAll, describe, expect, it } from "vitest";

import { cloneDefaultConfig, getModelMetrics } from "./model";
import { feedOf, runFarm } from "./sim";

/*
 * These are independent reality guardrails, not restatements of PigFlow's inputs.
 * They deliberately use broad published commercial ranges because genetics,
 * housing, health and climate move pig performance materially.
 *
 * Sources:
 * - AHDB/BPEX InterPIG, Table 11: 2.3 litters/sow/year, 21.6–25.4 pigs
 *   weaned/sow/year, 11.0–12.7 born/litter, 12.4–13.0% pre-weaning
 *   mortality, 2.5–2.7% rearing mortality, 2.5–2.6% finishing mortality,
 *   780–822 g/day finishing gain and 2.7–2.9 finishing FCR.
 *   https://library2.nics.gov.uk/pdf/dard/2013/EENV.pdf
 * - DAERA Farm Business Data: typical finishing mortality 1% and FCR 2.66,
 *   while noting material variation by management, genetics, weight and health.
 *   https://www.daera-ni.gov.uk/sites/default/files/publications/daera/Farm%20Business%20Data%202017.PDF
 * - MSD Veterinary Manual and AHDB are the biological references already
 *   disclosed in the app's Method & sources tab.
 */
const REALITY = {
  littersPerSowYear: { min: 2.1, max: 2.45 },
  weanedPerSowYear: { min: 20, max: 28 },
  bornAlivePerLitter: { min: 10.5, max: 14 },
  preWeanMortality: { min: 0.08, max: 0.18 },
  postWeanMortality: { min: 0.02, max: 0.08 },
  saleWeightKg: { min: 95, max: 125 },
  daysBirthToSale: { min: 145, max: 200 },
  wholeGrowoutFcr: { min: 2.4, max: 2.9 },
} as const;

function expectInside(value: number, range: { min: number; max: number }) {
  expect(value).toBeGreaterThanOrEqual(range.min);
  expect(value).toBeLessThanOrEqual(range.max);
}

type CohortResults = {
  littersPerSowYear: number;
  weanedPerSowYear: number;
  bornAlivePerLitter: number;
  preWeanMortality: number;
  postWeanMortality: number;
  averageSaleWeightKg: number;
};

let cohort: CohortResults;

beforeAll(async () => {
  let sowYears = 0;
  let litters = 0;
  let bornAlive = 0;
  let weaned = 0;
  let pigletDeaths = 0;
  let growingDeaths = 0;
  let sold = 0;
  let soldLiveweightKg = 0;

  // A single seed can be lucky or unlucky. Twenty-four five-year farms give
  // the stochastic rules enough exposure for population rates to stabilise.
  for (let seed = 1; seed <= 24; seed += 1) {
    const input = cloneDefaultConfig();
    input.project.seed = seed;
    input.project.months = 60;
    const farm = runFarm(input);

    sowYears += farm.history.reduce((sum, day) => sum + day.counts.sows, 0) / 365.25;
    litters += farm.lifetime.litters;
    bornAlive += farm.lifetime.bornAlive;
    weaned += farm.lifetime.weaned;
    pigletDeaths += farm.lifetime.pigletDeaths;
    growingDeaths += farm.lifetime.growingDeaths;
    sold += farm.lifetime.sold;
    soldLiveweightKg += farm.lifetime.soldLiveweightKg;

    // Come up for air. Twenty-four five-year farms in one unbroken synchronous
    // run hold this worker's event loop for half a minute, which starves the
    // channel vitest reports on and fails the whole file with a timeout that
    // has nothing to do with what is being measured. Yielding every few seeds
    // costs nothing and changes no result.
    if (seed % 4 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
  }

  cohort = {
    littersPerSowYear: litters / sowYears,
    weanedPerSowYear: weaned / sowYears,
    bornAlivePerLitter: bornAlive / litters,
    preWeanMortality: pigletDeaths / bornAlive,
    postWeanMortality: growingDeaths / weaned,
    averageSaleWeightKg: soldLiveweightKg / sold,
  };
}, 120_000);

describe("Published commercial-production guardrails", () => {
  it("produces a credible annual reproductive rhythm across many random seeds", () => {
    expectInside(cohort.littersPerSowYear, REALITY.littersPerSowYear);
    expectInside(cohort.weanedPerSowYear, REALITY.weanedPerSowYear);
  });

  it("keeps litter size and pre-weaning survival in credible commercial ranges", () => {
    expectInside(cohort.bornAlivePerLitter, REALITY.bornAlivePerLitter);
    expectInside(cohort.preWeanMortality, REALITY.preWeanMortality);
  });

  it("keeps aggregate post-weaning losses in a credible range", () => {
    expectInside(cohort.postWeanMortality, REALITY.postWeanMortality);
  });

  it("sells market pigs at a commercially recognisable liveweight", () => {
    expectInside(cohort.averageSaleWeightKg, REALITY.saleWeightKg);
  });

  it("reaches sale weight in a credible birth-to-market time", () => {
    const metrics = getModelMetrics(cloneDefaultConfig());
    expectInside(metrics.daysToSaleWeight, REALITY.daysBirthToSale);
  });

  it("delivers a realistic whole-growout feed conversion", () => {
    const input = cloneDefaultConfig();
    input.stock = { sows: 0, gilts: 0, boars: 0, weaners: 600, growers: 0, finishers: 0, starting: [] };
    input.growth.weanerMortalityPct = 0;
    input.growth.growerMortalityPct = 0;
    input.growth.finisherMortalityPct = 0;
    input.herd.retainHomeBredGilts = false;

    const farm = runFarm(input, 400);
    const feedKg = farm.history.reduce((sum, day) => sum + day.growingFeedKg, 0);
    // Founding weaners are deliberately spread through their starting stage.
    const averageStartingWeightKg = (input.growth.referenceWeaningWeightKg + 30) / 2;
    const gainKg = farm.lifetime.soldLiveweightKg - 600 * averageStartingWeightKg;

    expect(farm.lifetime.sold).toBe(600);
    expectInside(feedKg / gainKg, REALITY.wholeGrowoutFcr);
  });
});

describe("Economic reality relationships", () => {
  it("changes money, but not biological output, when only feed prices change", () => {
    const base = cloneDefaultConfig();
    base.project.months = 60;
    const expensive = cloneDefaultConfig();
    expensive.project.months = 60;
    expensive.feed.sowFeedCostKg *= 1.2;
    expensive.feed.creepFeedCostKg *= 1.2;
    expensive.feed.weanerFeedCostKg *= 1.2;
    expensive.feed.growerFeedCostKg *= 1.2;
    expensive.feed.finisherFeedCostKg *= 1.2;

    const baseFarm = runFarm(base);
    const expensiveFarm = runFarm(expensive);

    expect(expensiveFarm.lifetime.bornAlive).toBe(baseFarm.lifetime.bornAlive);
    expect(expensiveFarm.lifetime.sold).toBe(baseFarm.lifetime.sold);
    expect(feedOf(expensiveFarm.ledger.totals)).toBeCloseTo(
      feedOf(baseFarm.ledger.totals) * 1.2,
      6,
    );
    expect(expensiveFarm.state().finance.cash).toBeLessThan(baseFarm.state().finance.cash);
  });

  it("reduces pigs sold when mortality assumptions deteriorate", () => {
    const base = cloneDefaultConfig();
    base.project.months = 60;
    const highMortality = cloneDefaultConfig();
    highMortality.project.months = 60;
    highMortality.reproduction.preWeanMortalityPct = 25;
    highMortality.growth.weanerMortalityPct = 6;
    highMortality.growth.growerMortalityPct = 5;
    highMortality.growth.finisherMortalityPct = 5;

    let baseSold = 0;
    let highMortalitySold = 0;
    for (let seed = 1; seed <= 8; seed += 1) {
      base.project.seed = seed;
      highMortality.project.seed = seed;
      baseSold += runFarm(base).lifetime.sold;
      highMortalitySold += runFarm(highMortality).lifetime.sold;
    }

    expect(highMortalitySold).toBeLessThan(baseSold * 0.9);
    // Sixteen five-year farms, because one seed is luck and this claim is about
    // the trend. That is well past the default per-test timeout.
  }, 60_000);
});
