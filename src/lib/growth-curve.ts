import type { PlannerConfig } from "./config";

type GrowthConfig = PlannerConfig["growth"];

/** The two liveweights the feed-per-kilogram-of-gain inputs are quoted at. */
const LIGHT_ANCHOR_KG = 20;
const HEAVY_ANCHOR_KG = 100;

/**
 * Feed a pig of this weight eats before any of it shows up as gain — keeping
 * warm, moving about, replacing what its body turns over. It follows metabolic
 * weight rather than weight itself, so a pig twice as heavy needs about two
 * thirds more upkeep, not twice as much. The manual on housing puts the same
 * relationship the other way round: upkeep is what rises when a pig is cold,
 * by about 0.3 g of feed per kilogram of bodyweight for every degree below its
 * comfortable range, which is why the heavier pigs in a shed are the ones a
 * draught costs most.
 */
export function upkeepFeedKgDay(weightKg: number, growth: GrowthConfig): number {
  return growth.upkeepFeedKgAt100Kg * Math.pow(Math.max(weightKg, 0) / HEAVY_ANCHOR_KG, 0.75);
}

/**
 * Feed it takes to add one kilogram at this weight, upkeep aside. A young pig
 * lays down lean, which is mostly water and comes cheap; as it fills out more of
 * each kilogram is fat, which costs several times as much to make. Between the
 * two anchors the cost is read off the straight line through them, and below the
 * lighter one it is held flat — two points say nothing about a pig smaller than
 * either of them.
 */
export function gainFeedKgPerKg(weightKg: number, growth: GrowthConfig): number {
  const perKgOfWeight =
    (growth.gainFeedKgAt100Kg - growth.gainFeedKgAt20Kg) / (HEAVY_ANCHOR_KG - LIGHT_ANCHOR_KG);
  return (
    growth.gainFeedKgAt20Kg +
    perKgOfWeight * (Math.max(weightKg, LIGHT_ANCHOR_KG) - LIGHT_ANCHOR_KG)
  );
}

/** A growing pig's day: what it costs to keep it, plus what its day's gain costs. */
export function dailyFeedKg(
  weightKg: number,
  dailyGainKg: number,
  growth: GrowthConfig,
): number {
  return upkeepFeedKgDay(weightKg, growth) + dailyGainKg * gainFeedKgPerKg(weightKg, growth);
}

/**
 * The conversion ratio a farmer would measure on a pig of this weight growing at
 * this rate: its upkeep spread over the day's gain, plus what the gain itself
 * costs. Both halves get dearer as the pig grows, which is why one FCR quoted
 * over a whole growout hides where the feed actually went.
 */
export function feedConversionAt(
  weightKg: number,
  dailyGainKg: number,
  growth: GrowthConfig,
): number {
  if (dailyGainKg <= 0) return 0;
  return dailyFeedKg(weightKg, dailyGainKg, growth) / dailyGainKg;
}

export type GrowoutFeed = {
  feedKg: number;
  days: number;
  weanerFcr: number;
  growerFcr: number;
  finisherFcr: number;
  growoutFcr: number;
};

/**
 * Walks one average pig from weaning to sale weight, a day at a time, and reads
 * the conversion off what it ate. A weight-dependent curve has no closed-form
 * FCR: the only honest way to quote one is to grow a pig through the curve and
 * divide. Sex and thriftiness are left at the average here — this is the plan's
 * arithmetic, which a farmer can check by hand, not the simulation, which grows
 * every pig on its own.
 */
export function growoutFeedConversion(growth: GrowthConfig): GrowoutFeed {
  const feed = { weaner: 0, grower: 0, finisher: 0 };
  const gained = { weaner: 0, grower: 0, finisher: 0 };
  let weightKg = growth.weaningWeightKg;
  let days = 0;

  // The day cap is for configurations that would never arrive: a stage with no
  // gain in it leaves a pig standing at that weight for ever.
  while (weightKg < growth.saleWeightKg && days < 2000) {
    const stage =
      weightKg < growth.growerStartWeightKg
        ? "weaner"
        : weightKg < growth.finisherStartWeightKg
          ? "grower"
          : "finisher";
    const gain =
      stage === "weaner"
        ? growth.weanerDailyGainKg
        : stage === "grower"
          ? growth.growerDailyGainKg
          : growth.finisherDailyGainKg;
    if (gain <= 0) break;
    feed[stage] += dailyFeedKg(weightKg, gain, growth);
    gained[stage] += gain;
    weightKg += gain;
    days += 1;
  }

  const feedKg = feed.weaner + feed.grower + feed.finisher;
  const gainKg = gained.weaner + gained.grower + gained.finisher;
  return {
    feedKg,
    days,
    weanerFcr: ratio(feed.weaner, gained.weaner),
    growerFcr: ratio(feed.grower, gained.grower),
    finisherFcr: ratio(feed.finisher, gained.finisher),
    growoutFcr: ratio(feedKg, gainKg),
  };
}

function ratio(feedKg: number, gainKg: number): number {
  return gainKg > 0 ? feedKg / gainKg : 0;
}
