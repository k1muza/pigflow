import { BIRTH_WEIGHT_KG, MATURE_SOW_WEIGHT_KG, type PlannerConfig } from "../config";

/**
 * What it takes to milk a litter, in one place.
 *
 * A suckling pig does not eat: it is fed by its dam, and what it puts on is
 * whatever her milk and the creep feeder between them paid for. That makes
 * pre-weaning growth the one part of this model where the animal growing and
 * the animal being fed are different animals, and it is why the arithmetic is
 * gathered here rather than spread between the two engines, the forecaster and
 * the sow's own ration.
 *
 * The chain is short and every link is a configured number:
 *
 * ```text
 * what the litter is trying to grow today
 *      ↓ × feed a kilogram of gain
 * milk the sow has to make
 *      ↓ + what she eats for herself
 * what the feeder puts in front of her   (capped by the lactation ration)
 *      ↓ × what the store actually served
 * milk she can make
 *      ↓ + what the litter ate out of the creep feeder
 * the gain the litter can actually make
 * ```
 *
 * Read it backwards and it is the property this exists to hold: extra
 * pre-weaning liveweight needs extra feed or extra days. Nothing here gives a
 * piglet a kilogram that nothing paid for, and a plan that asks for a heavier
 * weaner than its feed will carry gets a lighter one and a bill it can see.
 *
 * None of it invents a coefficient. The three that decide the shape — what a
 * lactating sow eats for herself, what a kilogram of litter gain costs in sow
 * feed, and what it costs in creep — are plan inputs with defaults off the
 * tables, so a unit that milks better than the book says can say so.
 */

/** What one sow's litter wants today, and what it takes to give it to them. */
export type LactationDemand = {
  /** Live sucklers on her this morning. */
  sucklers: number;
  /** The liveweight the litter would put on today if nothing were short. */
  potentialGainKg: number;
  /** Creep put in front of the litter today, before any store shortage. */
  creepOfferedKg: number;
  /** The gain that creep would pay for if the litter ate all of it. */
  creepGainKg: number;
  /** What the sow eats for herself, whatever she is suckling. */
  maintenanceKg: number;
  /** Feed above maintenance for the milk the creep does not cover. */
  milkFeedKg: number;
  /** Maintenance plus milk: what she would be given if nothing capped it. */
  requiredKg: number;
  /** What the feeder actually puts in front of her, capped by the ration. */
  offeredKg: number;
  /** True when the cap is what she got, so the litter is short by policy. */
  rationed: boolean;
};

/** A sow as this module needs to see her, so a forecast can ask the same thing. */
export type LactatingSow = {
  weightKg: number;
  /** Live sucklers, and what each of them would grow today if fully fed. */
  sucklers: number;
  potentialGainKg: number;
  /** Creep offered to the whole litter today. */
  creepOfferedKg: number;
};

/** Her own upkeep, scaled by bodyweight the way her gestation ration is. */
export function lactationMaintenanceKg(weightKg: number, config: PlannerConfig): number {
  const scale = Math.pow(Math.max(weightKg, 1) / MATURE_SOW_WEIGHT_KG, 0.75);
  return config.feed.lactationMaintenanceKgDay * scale;
}

/**
 * What one lactating sow is offered today.
 *
 * The cap is the plan's lactation ration: it is the top of the feed curve, and
 * a litter that wants more than it allows is a litter that grows more slowly.
 * That is the honest answer — the alternative is a sow eating nine kilograms a
 * day on paper because her litter was written down as heavy.
 */
export function lactationDemandOf(sow: LactatingSow, config: PlannerConfig): LactationDemand {
  const maintenanceKg = lactationMaintenanceKg(sow.weightKg, config);
  const cap = config.feed.lactationKgDay * Math.pow(
    Math.max(sow.weightKg, 1) / MATURE_SOW_WEIGHT_KG,
    0.75,
  );

  // Creep first: a kilogram of gain the litter ate for itself is a kilogram its
  // dam does not have to milk, which is the whole reason a farm creep-feeds.
  const creepGainKg =
    config.feed.creepFeedKgPerKgGain > 0
      ? sow.creepOfferedKg / config.feed.creepFeedKgPerKgGain
      : 0;
  const milkedGainKg = Math.max(0, sow.potentialGainKg - creepGainKg);
  const milkFeedKg = milkedGainKg * config.feed.lactationFeedKgPerKgGain;

  const requiredKg = maintenanceKg + milkFeedKg;
  const offeredKg = Math.min(requiredKg, cap);
  return {
    sucklers: sow.sucklers,
    potentialGainKg: sow.potentialGainKg,
    creepOfferedKg: sow.creepOfferedKg,
    creepGainKg,
    maintenanceKg,
    milkFeedKg,
    requiredKg,
    offeredKg,
    rationed: requiredKg > cap + 1e-9,
  };
}

/** Where a litter's day of growth came from, in the feed that paid for it. */
export type LitterGrowthAccount = {
  /** Sow feed she was actually handed, above and below her own upkeep. */
  servedSowKg: number;
  maintenanceKg: number;
  milkFeedKg: number;
  /** Gain that milk paid for, at the plan's sow feed per kilogram of gain. */
  milkGainKg: number;
  /** Creep the litter actually ate, and the gain it paid for. */
  servedCreepKg: number;
  creepGainKg: number;
  /** The two together, before the genotype has its say. */
  fedGainKg: number;
  /** What the litter could have made today however much it was given. */
  potentialGainKg: number;
  /** The lesser of the two: the gain the litter actually makes. */
  gainKg: number;
};

/**
 * What a litter grew today and what bought it.
 *
 * Read the way the feed goes in: the sow eats for herself first, what is left of
 * her ration is turned into milk at the plan's conversion, the creep feeder adds
 * whatever the litter ate out of it, and the genotype caps the total — a litter
 * cannot be fed into growing faster than a piglet grows.
 *
 * Fed with what the sow was served rather than what she was offered, and with
 * the creep the litter was served rather than what was put down for it, so a
 * store that ran dry reaches the piglet through the same arithmetic as a ration
 * that was never big enough.
 */
export function litterGrowthAccount(
  demand: LactationDemand,
  servedSowKg: number,
  servedCreepKg: number,
  config: PlannerConfig,
): LitterGrowthAccount {
  const milkFeedKg = Math.max(0, servedSowKg - demand.maintenanceKg);
  const milkGainKg =
    config.feed.lactationFeedKgPerKgGain > 0
      ? milkFeedKg / config.feed.lactationFeedKgPerKgGain
      : 0;
  const creepGainKg =
    config.feed.creepFeedKgPerKgGain > 0 ? servedCreepKg / config.feed.creepFeedKgPerKgGain : 0;
  const fedGainKg = milkGainKg + creepGainKg;
  return {
    servedSowKg,
    maintenanceKg: demand.maintenanceKg,
    milkFeedKg,
    milkGainKg,
    servedCreepKg,
    creepGainKg,
    fedGainKg,
    potentialGainKg: demand.potentialGainKg,
    gainKg: Math.max(0, Math.min(demand.potentialGainKg, fedGainKg)),
  };
}

/** The same day in a sentence, for a farm asking where the weaner went. */
export function explainLitterGrowth(account: LitterGrowthAccount): string {
  const kg = (value: number) => value.toFixed(2) + " kg";
  const held = account.fedGainKg > account.potentialGainKg + 1e-9;
  return (
    "The sow was fed " +
    kg(account.servedSowKg) +
    ", of which " +
    kg(account.maintenanceKg) +
    " kept her; the remaining " +
    kg(account.milkFeedKg) +
    " milked " +
    kg(account.milkGainKg) +
    " of litter gain, and the creep feeder added " +
    kg(account.creepGainKg) +
    " on " +
    kg(account.servedCreepKg) +
    ". The litter gained " +
    kg(account.gainKg) +
    (held ? ", held at what a piglet can put on in a day." : ".")
  );
}

/**
 * How much of what the litter wanted it actually got, as a share of 1.
 *
 * The same account as {@link litterGrowthAccount}, divided through, because the
 * engines carry the shortfall on the piglet rather than on the litter: every
 * suckler on that dam grows at this share of what it could have done. A litter
 * wanting nothing is fully supported, which keeps the day a litter is born and
 * the day it is weaned from dividing by zero.
 */
export function pigletSupportFactor(
  demand: LactationDemand,
  servedSowKg: number,
  servedCreepKg: number,
  config: PlannerConfig,
): number {
  if (demand.potentialGainKg <= 0) return 1;
  const account = litterGrowthAccount(demand, servedSowKg, servedCreepKg, config);
  return account.gainKg / demand.potentialGainKg;
}

/**
 * Biological pre-weaning growth potential under essentially unrestricted
 * nutrition, expressed as an age-dependent daily gain curve.
 *
 * The later anchors are taken from the artificial-rearing work reported by
 * Harrell/Boyd: growth accelerates through lactation instead of sitting at one
 * flat ADG. The first point is a conservative back-extrapolation chosen so the
 * curve averages about 0.40 kg/day over the first three weeks, matching the
 * reported birth-to-21-day biological potential. The study ends at 23 days, so
 * the last observed level is held flat after that rather than extrapolated
 * upward without evidence.
 *
 * These are ceilings, not expected farm gains. Milk and creep still have to pay
 * for every kilogram through {@link litterGrowthAccount}.
 */
export const REFERENCE_PIGLET_GROWTH_CURVE = [
  { ageDays: 0, gainKgDay: 0.2894 },
  { ageDays: 9.5, gainKgDay: 0.358 },
  { ageDays: 12.5, gainKgDay: 0.432 },
  { ageDays: 15.5, gainKgDay: 0.455 },
  { ageDays: 19, gainKgDay: 0.521 },
  { ageDays: 22, gainKgDay: 0.61 },
] as const;

export function referencePigletGainKg(ageDays: number): number {
  const age = Math.max(0, ageDays);
  const first = REFERENCE_PIGLET_GROWTH_CURVE[0];
  if (age <= first.ageDays) return first.gainKgDay;

  for (let index = 1; index < REFERENCE_PIGLET_GROWTH_CURVE.length; index += 1) {
    const right = REFERENCE_PIGLET_GROWTH_CURVE[index];
    if (age > right.ageDays) continue;
    const left = REFERENCE_PIGLET_GROWTH_CURVE[index - 1];
    const share = (age - left.ageDays) / (right.ageDays - left.ageDays);
    return left.gainKgDay + share * (right.gainKgDay - left.gainKgDay);
  }

  return REFERENCE_PIGLET_GROWTH_CURVE[REFERENCE_PIGLET_GROWTH_CURVE.length - 1].gainKgDay;
}

/**
 * What a fully nourished suckler of this genotype can put on at this age.
 *
 * A farm can move the whole reference curve up or down with one calibration
 * percentage. The feed system then decides how much of this ceiling the litter
 * actually reaches.
 */
export function potentialPigletGainKg(
  config: PlannerConfig,
  ageDays: number,
): number {
  const calibration = Math.max(0, config.growth.pigletGrowthPotentialPct) / 100;
  return referencePigletGainKg(ageDays) * calibration;
}

/**
 * What this plan's own ration will actually carry a suckler to by a given age.
 *
 * {@link potentialPigletGainKg} says what the genotype is capable of. This says
 * what the farm will get: the same litter, the same lactation ration and the
 * same creep feeder, worked forward day by day. The two agree only on a plan
 * that feeds its sows enough to reach the ceiling, and a plan that does not
 * should not be quoting a growout, a days-to-sale, a weaner-stage length or an
 * opening piglet off a weight its litters will never be.
 *
 * It is a planning figure and not a measurement: one average dam at mature
 * weight with the plan's own litter on her, which is the herd the rest of the
 * plan's arithmetic is drawn on. What any particular litter managed is on the
 * run, in `ProjectionSummary.weaning`.
 */
export function expectedPigletWeightAtAgeKg(
  config: PlannerConfig,
  ageDays: number,
  /**
   * Litter mates it is sharing its dam with, because a sow's ration is divided
   * by the number on her and a litter of nine is not the same weaner as a
   * litter of fourteen. A caller with a particular litter passes it.
   *
   * Without one, the plan's own average — and the average over a lactation is
   * not the number born alive. Pre-weaning losses fall across the four weeks,
   * so the sow spends the second half of it milking fewer than she started
   * with, and the ones left get a bigger share of the same ration. Quoting the
   * born-alive figure instead made the plan's expected weaner lighter than the
   * farm's actual one by more than half a kilogram on a ration that binds.
   */
  litterSize: number = averageSucklers(config),
): number {
  const days = Math.max(0, Math.round(ageDays));
  const sucklers = Math.max(0, litterSize);
  if (days === 0 || sucklers <= 0) return BIRTH_WEIGHT_KG;

  // Potential now changes with age, so the only honest calculation is the same
  // one the engine performs: walk the lactation one day at a time, ask what the
  // piglet could do at that age, then let the sow ration and creep feeder limit
  // it. This remains a deterministic planning walk — no future simulation state
  // or random draw is consulted.
  let weightKg = BIRTH_WEIGHT_KG;
  for (let day = 0; day < days; day += 1) {
    const potentialPerPiglet = potentialPigletGainKg(config, day);
    const creepOfferedKg =
      day >= config.feed.creepStartAgeDays ? sucklers * config.feed.creepKgPerPigDay : 0;
    const demand = lactationDemandOf(
      {
        weightKg: MATURE_SOW_WEIGHT_KG,
        sucklers,
        potentialGainKg: sucklers * potentialPerPiglet,
        creepOfferedKg,
      },
      config,
    );
    const support = pigletSupportFactor(
      demand,
      demand.offeredKg,
      creepOfferedKg,
      config,
    );
    weightKg += potentialPerPiglet * support;
  }
  return weightKg;
}

/**
 * How many a sow is milking on an average day of her lactation: what she
 * farrowed, less half of what she will lose, because the losses are spread
 * across the weeks rather than taken on the first morning.
 */
function averageSucklers(config: PlannerConfig): number {
  const bornAlive = Math.max(0, config.reproduction.bornAlivePerLitter);
  const lost = Math.min(100, Math.max(0, config.reproduction.preWeanMortalityPct)) / 100;
  return bornAlive * (1 - lost / 2);
}

/** The same walk, taken to the day the farm actually weans on. */
export function expectedWeaningWeightKg(config: PlannerConfig): number {
  return expectedPigletWeightAtAgeKg(config, config.reproduction.weaningAgeDays);
}

/**
 * What a suckler of this age weighs if nothing was ever short of it: the
 * genotype's rate, every day, and no ration in it at all.
 *
 * For the animals the farm already owned on the morning the plan opens. A pig
 * standing in the weaner house on day zero was weaned by whatever fed it, weeks
 * before any of this plan applies, so inferring its weight from this plan's
 * lactation ration runs the causality backwards: raising the sow feed for the
 * litters still to come would reach back and make a pig that is already three
 * weeks weaned heavier, and the farm would sell the difference. The past is not
 * the plan's to decide.
 *
 * So what is left is what a farm with nothing else to go on would say — this
 * genotype, fed. It is an assumption and not a measurement, which is why a
 * starting animal can carry its own weighed weight instead and override it
 * entirely.
 */
export function fullyFedPigletWeightKg(config: PlannerConfig, ageDays: number): number {
  const days = Math.max(0, Math.round(ageDays));
  let weightKg = BIRTH_WEIGHT_KG;
  for (let day = 0; day < days; day += 1) {
    weightKg += potentialPigletGainKg(config, day);
  }
  return weightKg;
}

/** Where the weaner house starts for a pig the farm already owned. */
export function openingWeanerWeightKg(config: PlannerConfig): number {
  return fullyFedPigletWeightKg(config, config.reproduction.weaningAgeDays);
}
