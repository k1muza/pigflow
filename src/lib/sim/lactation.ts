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
 * The most a suckler can put on in a day: the genotype's own figure, and
 * nothing to do with what it will be given or with what the plan hopes it will
 * weigh at weaning.
 *
 * It is a cap and not a rate the piglet is entitled to. What it actually makes
 * is settled by {@link litterGrowthAccount} out of its dam's ration and the
 * creep feeder, and how many days it gets is the farm's own weaning age.
 *
 * This used to be the configured weaning weight divided by the weaning age,
 * which made the plan's target the thing that drove growth — type a heavier
 * weaner and every litter on the farm grew faster, for nothing. Worse, the
 * weaning age was in the divisor: a litter left on a week longer simply grew a
 * seventh slower and arrived at the same weight, so time on the sow bought
 * nothing either. The rule is that pre-weaning liveweight comes from feed or
 * from days, and it has to hold for both.
 */
export function potentialPigletGainKg(config: PlannerConfig): number {
  return Math.max(0, config.growth.pigletDailyGainKg);
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
   * Litter mates it is sharing its dam with. The plan's own average where the
   * caller has no particular litter in mind; the litter itself where it has
   * one, because a sow's ration is divided by the number on her and an opening
   * litter of nine is not the same weaner as an opening litter of fourteen.
   */
  litterSize: number = config.reproduction.bornAlivePerLitter,
): number {
  const days = Math.max(0, Math.round(ageDays));
  const sucklers = Math.max(0, litterSize);
  const gain = potentialPigletGainKg(config);
  if (days === 0 || sucklers <= 0 || gain <= 0) return BIRTH_WEIGHT_KG;

  // Two rates and not twenty-eight: the litter's demand is flat across the
  // lactation and the creep feeder is the only thing that changes, so the whole
  // walk is the days before it went in and the days after.
  const shareOn = (creepOfferedKg: number) => {
    const demand = lactationDemandOf(
      {
        weightKg: MATURE_SOW_WEIGHT_KG,
        sucklers,
        potentialGainKg: sucklers * gain,
        creepOfferedKg,
      },
      config,
    );
    return pigletSupportFactor(demand, demand.offeredKg, creepOfferedKg, config);
  };

  const creepFrom = Math.min(days, Math.max(0, Math.round(config.feed.creepStartAgeDays)));
  const onMilkAlone = shareOn(0);
  const onCreep = shareOn(sucklers * config.feed.creepKgPerPigDay);
  return BIRTH_WEIGHT_KG + gain * (creepFrom * onMilkAlone + (days - creepFrom) * onCreep);
}

/** The same walk, taken to the day the farm actually weans on. */
export function expectedWeaningWeightKg(config: PlannerConfig): number {
  return expectedPigletWeightAtAgeKg(config, config.reproduction.weaningAgeDays);
}
