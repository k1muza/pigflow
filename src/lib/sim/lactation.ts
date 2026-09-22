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

/**
 * How much of what the litter wanted it actually got, as a share of 1.
 *
 * Fed with what the sow was served rather than what she was offered, and with
 * the creep the litter was served rather than what was put down for it, so a
 * store that ran dry reaches the piglet through the same arithmetic as a ration
 * that was never big enough. A litter wanting nothing is fully supported, which
 * keeps the day a litter is born and the day it is weaned from dividing by zero.
 */
export function pigletSupportFactor(
  demand: LactationDemand,
  servedSowKg: number,
  servedCreepKg: number,
  config: PlannerConfig,
): number {
  if (demand.potentialGainKg <= 0) return 1;
  const milkFeedKg = Math.max(0, servedSowKg - demand.maintenanceKg);
  const milkedGainKg =
    config.feed.lactationFeedKgPerKgGain > 0
      ? milkFeedKg / config.feed.lactationFeedKgPerKgGain
      : 0;
  const creepGainKg =
    config.feed.creepFeedKgPerKgGain > 0 ? servedCreepKg / config.feed.creepFeedKgPerKgGain : 0;
  return Math.min(1, Math.max(0, (milkedGainKg + creepGainKg) / demand.potentialGainKg));
}

/**
 * The gain a suckler is aiming at: the reference weaning weight spread over the
 * reference lactation, and nothing to do with what it will be given.
 *
 * This is the one place the configured weaning weight is allowed to speak, and
 * all it says is what a well-fed piglet of this genotype does. Whether this
 * piglet gets it is settled by {@link pigletSupportFactor}.
 */
export function potentialPigletGainKg(config: PlannerConfig): number {
  const days = Math.max(1, config.reproduction.weaningAgeDays);
  return Math.max(0, config.growth.referenceWeaningWeightKg - BIRTH_WEIGHT_KG) / days;
}

/**
 * What this plan's own ration will actually carry a litter to by weaning.
 *
 * {@link potentialPigletGainKg} reads the configured weaning weight as what the
 * genotype is capable of. This reads what the farm will get: the same litter,
 * the same lactation ration and the same creep feeder, worked forward to the
 * day they come off. The two are the same number only on a plan that feeds its
 * sows enough to reach the figure it typed, and a plan that does not should not
 * be quoting a growout, a days-to-sale or a weaner-stage length off a weight
 * its piglets will never be.
 *
 * It is a planning figure and not a measurement: one average dam at mature
 * weight with the plan's own litter on her, which is the herd the rest of the
 * plan's arithmetic is drawn on. What any particular litter managed is on the
 * run, in `ProjectionSummary.weaning`.
 */
export function expectedWeaningWeightKg(config: PlannerConfig): number {
  const days = Math.max(0, Math.round(config.reproduction.weaningAgeDays));
  const sucklers = Math.max(0, config.reproduction.bornAlivePerLitter);
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
