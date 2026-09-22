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

/** Where one pig's day of growth came from, in the feed that paid for it. */
export type GrowthAccount = {
  /** What it was offered: upkeep plus what a full day's gain would cost. */
  offeredKg: number;
  /** What it actually ate, after whatever the stores could cover. */
  intakeKg: number;
  /** Feed spent on carrying the body it already has. */
  upkeepKg: number;
  /** What was left of the intake once upkeep was paid. */
  growthFeedKg: number;
  /** Feed a kilogram of gain costs at this weight. */
  feedKgPerKgGain: number;
  /** The gain that feed bought, before the genotype has its say. */
  fedGainKg: number;
  /** What the pig could have made today, however much it was given. */
  potentialGainKg: number;
  /** The lesser of the two, floored at the most an animal sheds in a day. */
  gainKg: number;
};

/**
 * What a pig ate today and what it got for it.
 *
 * A day's ration is upkeep first and gain second: a pig that is given four
 * fifths of what it wanted does not grow four fifths as fast, because the upkeep
 * comes out of the four fifths whole and only what is left over goes on its
 * back. Below upkeep it loses weight, which is what a store running dry really
 * costs a farm — not the emergency premium, the fortnight of growth.
 *
 * The potential is a ceiling and not a promise: feeding a pig more than its day
 * of growth costs does not make it grow faster, it makes it a fat pig, and this
 * model does not pretend to know the difference beyond stopping there.
 */
export function growthAccountOf(
  weightKg: number,
  potentialGainKg: number,
  /** Kilograms actually issued to this pig today, off the store. */
  intakeKg: number,
  growth: GrowthConfig,
): GrowthAccount {
  const upkeepKg = upkeepFeedKgDay(weightKg, growth);
  const feedKgPerKgGain = gainFeedKgPerKg(weightKg, growth);
  const growthFeedKg = Math.max(0, intakeKg - upkeepKg);
  const fedGainKg = feedKgPerKgGain > 0 ? (intakeKg - upkeepKg) / feedKgPerKgGain : 0;
  // Two ceilings and not two multipliers. What the feed will carry is one of
  // them and what the animal is capable of today — after the room it stands in
  // and whatever it is being treated for — is the other, and a pig grows at the
  // lower. Multiplying them made a pig on four fifths of its feed and six
  // tenths of its health grow at forty-eight hundredths, which is a penalty
  // charged twice: the feed it could not eat is the feed the illness took its
  // appetite for.
  const gainKg = Math.max(-MAX_DAILY_LOSS_KG, Math.min(potentialGainKg, fedGainKg));
  return {
    offeredKg: upkeepKg + Math.max(0, potentialGainKg) * feedKgPerKgGain,
    intakeKg,
    upkeepKg,
    growthFeedKg,
    feedKgPerKgGain,
    fedGainKg,
    potentialGainKg,
    gainKg,
  };
}

/**
 * The same account for a caller that knows only what share of the day's ration
 * a store could cover — the plan's own arithmetic, and the forecaster's, where
 * there is no issue to read off.
 */
export function growthAccount(
  weightKg: number,
  potentialGainKg: number,
  intakeFactor: number,
  growth: GrowthConfig,
): GrowthAccount {
  const offeredKg =
    upkeepFeedKgDay(weightKg, growth) +
    Math.max(0, potentialGainKg) * gainFeedKgPerKg(weightKg, growth);
  return growthAccountOf(
    weightKg,
    potentialGainKg,
    Math.max(0, Math.min(1, intakeFactor)) * offeredKg,
    growth,
  );
}

/** The same day in a sentence, for a farm asking where the growth went. */
export function explainGrowth(account: GrowthAccount): string {
  const kg = (value: number) => value.toFixed(2) + " kg";
  return (
    "The pig ate " +
    kg(account.intakeKg) +
    " today. " +
    kg(account.upkeepKg) +
    " kept it where it was. The remaining " +
    kg(account.growthFeedKg) +
    " bought " +
    kg(account.gainKg) +
    " of liveweight at " +
    account.feedKgPerKgGain.toFixed(2) +
    " kg of feed a kilogram" +
    (account.fedGainKg > account.potentialGainKg + 1e-9
      ? ", held at what a pig this size can put on in a day."
      : ".")
  );
}

/**
 * The gain a pig actually makes on the feed it actually got: the account above,
 * read for its one number. Fully fed is the common case and short-circuits, so
 * the curve is only walked when a store could not cover the day.
 */
export function achievedGainKg(
  weightKg: number,
  potentialGainKg: number,
  intakeFactor: number,
  growth: GrowthConfig,
): number {
  if (intakeFactor >= 1 || potentialGainKg <= 0) return potentialGainKg;
  return growthAccount(weightKg, potentialGainKg, intakeFactor, growth).gainKg;
}

/** Most weight a pig is allowed to shed in one day, however short the feed is. */
export const MAX_DAILY_LOSS_KG = 0.4;

/**
 * How sharply gain falls away as a pig fills out. Near 1 the pig decelerates
 * from the day it is weaned; large, and it grows flat out and then stops dead.
 * 3 puts the deceleration where it belongs, in the last third of the approach.
 */
const MATURITY_EXPONENT = 3;

/**
 * What is left of a pig's potential gain at this weight, given the size it is
 * growing towards.
 *
 * Gain in this model is a rate per stage, read off tables measured on pigs
 * inside the growout. Beyond sale weight those tables say nothing, and taking
 * them at their word meant a pig held for want of a finishing place went on
 * gaining 0.85 kg a day for two years and passed 500 kg. It was not only the
 * weight that was wrong: that pig's upkeep, its feed orders, its insured value
 * and its cost per kilogram were all computed off it.
 *
 * So the curve is normalised to leave the growout exactly as it was — the factor
 * is 1 at sale weight and below, which is the whole of a plan that sells its
 * pigs on time — and takes over above it, falling to nothing as the pig reaches
 * its mature size. A pig that waits does not keep growing; it finishes growing
 * and stands there, which is what a pig does.
 */
export function maturityFactor(weightKg: number, growth: GrowthConfig): number {
  const mature = growth.matureWeightKg;
  // A mature weight at or under sale weight describes no growout at all, so
  // there is nothing to normalise against and nothing is applied.
  if (mature <= 0 || mature <= growth.saleWeightKg) return 1;
  const left = (kg: number) =>
    1 - Math.pow(Math.min(Math.max(kg, 0), mature) / mature, MATURITY_EXPONENT);
  const atSale = left(growth.saleWeightKg);
  if (atSale <= 0) return 1;
  return Math.max(0, Math.min(1, left(weightKg) / atSale));
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
export function growoutFeedConversion(
  growth: GrowthConfig,
  /**
   * The weight the pig comes into the weaner house at — what this plan's own
   * lactation ration will actually produce, from `lib/sim/lactation`, and not
   * the weaner the plan hopes for. A lighter weaner has further to walk and eats
   * on the way, which is the whole reason a thin farrowing house shows up in a
   * finishing bill.
   */
  startWeightKg: number,
): GrowoutFeed {
  const feed = { weaner: 0, grower: 0, finisher: 0 };
  const gained = { weaner: 0, grower: 0, finisher: 0 };
  let weightKg = startWeightKg;
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
