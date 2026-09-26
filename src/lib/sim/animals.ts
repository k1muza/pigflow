import {
  BIRTH_WEIGHT_KG,
  BOAR_WEIGHT_KG,
  ESTRUS_CYCLE_DAYS,
  FEMALE_GROWTH_FACTOR,
  GILT_DAILY_GAIN_KG,
  MAINTENANCE_SHARE,
  MALE_GROWTH_FACTOR,
  MATURE_SOW_WEIGHT_KG,
  MAX_SOW_WEIGHT_KG,
  SOW_WEIGHT_GAIN_PER_PARITY_KG,
  type PlannerConfig,
} from "../config";
import { achievedGainKg, dailyFeedKg, growthAccountOf } from "../growth-curve";
import { nutritionForGrowthStage, type GrowthStageNutrition } from "../nutrition";
import {
  lactationDemandOf,
  potentialPigletGainKg,
  type LactationDemand,
} from "./lactation";

export type Sex = "female" | "male";
/** Where a pig sits on its way to the abattoir or the farrowing house. */
export type PigStage = "piglet" | "weaner" | "grower" | "finisher" | "gilt";

/** The order a pig passes through the stages, so a move is never backwards. */
const STAGE_ORDER: Record<PigStage, number> = {
  piglet: 0,
  weaner: 1,
  grower: 2,
  finisher: 3,
  gilt: 4,
};
export type Destination = "market" | "breeding";
export type SowState = "gestating" | "lactating" | "open";
export type ExitReason = "sold" | "sold-as-gilt" | "died" | "culled";

/**
 * An animal that left the farm, and why it left.
 *
 * Both engines drop their dead, sold and culled animals at the close of the day
 * they leave on, so anything reading the herd afterwards can see that somebody
 * has gone and cannot see what happened to them. A sale and a death empty the
 * same pen; only this tells them apart.
 */
export type AnimalDeparture = {
  id: string;
  day: number;
  reason: ExitReason | null;
  /** Present for growing pigs so observers can describe an exit after pruning. */
  stage?: PigStage;
  ageDays?: number;
  weightKg?: number;
};

export const COST_TYPES = ["feed", "health", "heating", "transport", "purchase"] as const;
export type CostType = (typeof COST_TYPES)[number];

export const COST_STAGES = [
  "piglet",
  "weaner",
  "grower",
  "finisher",
  "gilt",
  "breeding",
] as const;
export type CostStage = (typeof COST_STAGES)[number];

/**
 * The five rations a piggery buys. A demand carries the ration it draws on as
 * well as its price, because two rations can be priced the same and the feed
 * store still has to know which bin the kilograms come out of.
 */
export const FEED_RATIONS = ["sow", "creep", "weaner", "grower", "finisher"] as const;
export type FeedRation = (typeof FEED_RATIONS)[number];

export type FeedDemand = { kg: number; costPerKg: number; ration: FeedRation };

const NO_FEED: FeedDemand = { kg: 0, costPerKg: 0, ration: "sow" };

function zeroed<T extends readonly string[]>(keys: T): Record<T[number], number> {
  return Object.fromEntries(keys.map((key) => [key, 0])) as Record<T[number], number>;
}

/**
 * What one animal has cost the farm, kept both by kind of cost and by the life
 * stage it was incurred in — so a pig's bill can be read against its age.
 */
export class CostRecord {
  readonly byType = zeroed(COST_TYPES);
  readonly byStage = zeroed(COST_STAGES);
  total = 0;

  add(type: CostType, stage: CostStage, amount: number): void {
    if (!Number.isFinite(amount) || amount === 0) return;
    this.byType[type] += amount;
    this.byStage[stage] += amount;
    this.total += amount;
  }

  /** Carries a gilt's rearing bill onto the sow she becomes. */
  absorb(other: CostRecord): void {
    for (const type of COST_TYPES) this.byType[type] += other.byType[type];
    for (const stage of COST_STAGES) this.byStage[stage] += other.byStage[stage];
    this.total += other.total;
  }
}

/** Entire males eat and grow a little faster than gilts of the same age. */
export function sexFactor(sex: Sex): number {
  return sex === "male" ? MALE_GROWTH_FACTOR : FEMALE_GROWTH_FACTOR;
}

/** Anything on the farm that is born, weighs something, eats, ages and leaves. */
export abstract class Animal {
  readonly id: string;
  readonly tag: string;
  readonly sex: Sex;
  readonly birthDay: number;
  /** 0 for founding stock; a piglet is always one past its dam. */
  readonly generation: number;
  readonly damTag: string | null;
  /**
   * The sires standing behind this animal on its dam's side, nearest first: its
   * own sire, then its maternal grandsire, and so on as deep as
   * ANCESTRY_EXCLUSION_DEPTH keeps. Every one of them is barred from serving
   * her, which is what keeps a boar off his own granddaughters once he has been
   * standing long enough to meet them.
   */
  readonly sireLine: readonly string[];
  weightKg: number;
  alive = true;
  exitDay: number | null = null;
  exitReason: ExitReason | null = null;
  readonly costs = new CostRecord();
  /**
   * What this animal was worth when it became a breeding asset, and how much of
   * that has been written off since. Both are zero on anything that is not in
   * the breeding herd — a growing pig is stock rather than plant, and what it
   * is worth is simply what has been spent on it.
   *
   * Only the experimental inventory-adjusted books read them; see
   * {@link ./accounting}.
   */
  breedingValue = 0;
  accumulatedDepreciation = 0;
  /**
   * How far into its working life this animal was when {@link breedingValue}
   * was set on it — parities for a sow, days in service for a boar.
   *
   * Zero for everything the plan itself puts into the breeding herd, which is
   * every animal that was reared or bought here: its value was set on the day
   * it walked in, and the whole of its working life is still ahead of it.
   *
   * It is not zero for a sow or boar the farm already owned when the plan
   * opened. She is entered at what she is worth today, with her parities
   * already behind her, so writing her down for them would charge the plan for
   * wear that happened before it started and leave her carried at less than
   * the farmer said she was worth. What is left of her value is spread over
   * what is left of her working life instead.
   */
  valuedAfter = 0;

  constructor(init: {
    id: string;
    tag: string;
    sex: Sex;
    birthDay: number;
    weightKg: number;
    generation?: number;
    damTag?: string | null;
    sireLine?: readonly string[];
  }) {
    this.id = init.id;
    this.tag = init.tag;
    this.sex = init.sex;
    this.birthDay = init.birthDay;
    this.weightKg = init.weightKg;
    this.generation = init.generation ?? 0;
    this.damTag = init.damTag ?? null;
    this.sireLine = init.sireLine ?? [];
  }

  /** This animal's own sire, which is simply the nearest name in its sire line. */
  get sireTag(): string | null {
    return this.sireLine[0] ?? null;
  }

  /** Whether this boar or stud is close enough kin to be kept off this female. */
  relatedTo(sireTag: string): boolean {
    return this.sireLine.includes(sireTag);
  }

  ageDays(day: number): number {
    return day - this.birthDay;
  }

  ageMonths(day: number): number {
    return this.ageDays(day) / 30.4375;
  }

  leave(day: number, reason: ExitReason): void {
    this.alive = false;
    this.exitDay = day;
    this.exitReason = reason;
  }

  /**
   * Feed eaten on one day, with the price of the ration that animal is on.
   *
   * The day is passed because one animal's ration depends on it: a lactating
   * sow is fed for the litter under her, and what that litter is offered out of
   * the creep feeder — which its age decides — is feed she does not have to
   * make into milk. Everything else on the farm ignores it.
   */
  abstract dailyFeed(config: PlannerConfig, day: number): FeedDemand;

  /** Which bucket this animal's costs land in today. */
  abstract get costStage(): CostStage;
}

/** A pig on its way to market, or picked out to become a breeding gilt. */
export class GrowingPig extends Animal {
  stage: PigStage;
  destination: Destination = "market";
  weanedOnDay: number | null = null;
  /** How far through the vaccination schedule this pig has been taken. */
  vaccinationsGiven = 0;
  /**
   * This pig's own thriftiness, around 1. Litter mates do not grow at one rate,
   * so they do not all reach sale weight — or breeding age — on the same day.
   */
  growthFactor: number;
  /**
   * This gilt's own days past the herd's puberty age before she first stands.
   * Litter mates do not come into season together, and it is that spread —
   * carried forward through her cycle — that keeps a batch of them from all
   * being served on one day.
   */
  estrusOffsetDays = 0;
  /**
   * The day she first stood, or null before she has. Every heat after it is a
   * cycle on from it, so this one day fixes her whole breeding calendar.
   */
  firstHeatDay: number | null = null;
  /** Set once this pig has been looked over for breeding, kept or not. */
  assessedForBreeding = false;
  /**
   * What this pig weighed when it walked into the stage it is standing in, or
   * null for opening stock, which was placed in the middle of a stage rather
   * than grown into it.
   *
   * It is what says how far through a stage a pig is. Measuring that from the
   * plan's stage floor instead read a heavy weaner as a pig that had already
   * served part of its time in the weaner house: a litter weaned at 11 kg
   * against a plan expecting 8 was credited with a fortnight it had spent on
   * its dam, and charged less than the whole of the weaner stage's mortality
   * for it. A pig that was suckling yesterday has spent no time in the weaner
   * house, however heavy it is — it simply has less of the house to get
   * through. Opening stock is the real version of the other case, and keeps it:
   * it did live somewhere before day one, and is not charged for the part of
   * the stage it lived through there.
   */
  stageEntryWeightKg: number | null = null;
  /**
   * The day this pig first qualified to move up a stage and was refused a place
   * in the room it was moving into, or null when it is not waiting on one. A
   * batch that is held does not stop growing — it goes on filling the room it is
   * already in, which is exactly how housing pressure travels back up a farm.
   */
  heldSinceDay: number | null = null;
  /**
   * Share of the feed this pig asked for that it was actually given today. 1 on
   * any day the stores covered the herd, and below it when one did not.
   *
   * A reading for the log and the read-outs. What the pig grows on is
   * {@link feedEatenKg}, which is the issue itself.
   */
  intakeFactor = 1;
  /**
   * Kilograms of its own ration this pig was actually handed today, or null on a
   * day it has not been fed yet.
   *
   * The issue off the store, not a share of a demand: growth is worked out from
   * this number, so what the books say left the bin and what the pig grew on are
   * the same kilogram. Reconstructing the intake from a percentage was close but
   * not exact — the demand was priced off the pig's plan rate and the growth off
   * its rate after crowding and treatment, so a short-fed pig in a full room
   * could be grown on less feed than the farm had actually issued it.
   */
  feedEatenKg: number | null = null;
  /**
   * What its dam's milk and the creep feeder between them actually paid for
   * today, in kilograms of this piglet's own gain, or null off the sow.
   *
   * A suckler eats no ration of its own, so this is its share of the litter's
   * feed-supported gain — see `lib/sim/lactation`. It is an absolute gain and
   * not a share, so it can be held up against what the animal is capable of
   * rather than multiplied into it.
   */
  milkGainKg: number | null = null;
  /**
   * What the room this pig stood in last night did to its day's gain: 1 inside
   * its places, less when it is carrying an overflow.
   */
  crowdingFactor = 1;
  /**
   * What is left of this pig's growth, given how near it is to the size it will
   * finish at: 1 anywhere inside the growout, falling away above sale weight and
   * reaching 0 at its mature weight.
   *
   * It is set each morning by the engine rather than worked out here, for the
   * same reason the crowding factor is: the 1.x farm shares these animals and
   * has no mature weight in it, so leaving this at 1 leaves that farm exactly as
   * it was.
   */
  maturityFactor = 1;
  /** Days of reduced gain remaining after a non-fatal illness or injury. */
  treatmentPenaltyDays = 0;
  /** Multiplier applied to gain while treatmentPenaltyDays is positive. */
  treatmentGrowthFactor = 1;
  /**
   * The day this pig is booked to die, and the stage that booked it. Mortality
   * is scheduled when a cohort enters a stage rather than rolled every morning,
   * so a pig carries its own appointment. Both are cleared when the day comes,
   * and handed back to the stage if the pig leaves it alive first.
   */
  deathDay: number | null = null;
  deathStage: PigStage | null = null;

  constructor(init: {
    id: string;
    tag: string;
    sex: Sex;
    birthDay: number;
    weightKg: number;
    stage: PigStage;
    generation?: number;
    damTag?: string | null;
    sireLine?: readonly string[];
    growthFactor?: number;
    estrusOffsetDays?: number;
  }) {
    super(init);
    this.stage = init.stage;
    this.growthFactor = init.growthFactor ?? 1;
    this.estrusOffsetDays = init.estrusOffsetDays ?? 0;
  }

  get costStage(): CostStage {
    return this.stage;
  }

  get suckling(): boolean {
    return this.stage === "piglet";
  }

  /**
   * The nutrient specification this growing pig should be formulated to today.
   *
   * Nutrition follows liveweight rather than PigFlow's configurable housing
   * stage thresholds. That keeps a dietary phase from changing merely because
   * a farmer calls a room "grower" earlier or later than the reference manual.
   * Suckling piglets and selected replacement gilts use different feeding
   * models and are intentionally outside this growing-pig programme.
   */
  nutritionRequirements(): GrowthStageNutrition | null {
    if (this.stage === "piglet" || this.stage === "gilt") return null;
    return nutritionForGrowthStage(this.stage, this.weightKg);
  }

  dailyGainKg(config: PlannerConfig, day?: number): number {
    // What a fully milked, fully creep-fed suckler of this genotype would do —
    // and only that. Whether this one gets it is settled by what its dam was
    // actually given: see `lib/sim/lactation` and {@link achievedGainKg}. This
    // used to be the whole rule, which made the configured weaning weight a
    // promise nothing on the farm had to feed.
    // No thriftiness factor on a suckler. What a piglet puts on before weaning
    // is set by how much milk it gets rather than by how well it converts, and
    // the milk is its dam's to give — so the spread that makes litter mates
    // reach sale weight on different days starts when they start eating.
    // Keeping it here would also make a litter's milk demand unforecastable:
    // the ordering policy would be buying sow feed for an average litter and
    // the farm would be feeding a particular one.
    if (this.stage === "piglet") {
      if (day === undefined) {
        throw new Error("A suckling piglet's growth potential requires the simulation day.");
      }
      return potentialPigletGainKg(config, this.ageDays(day));
    }
    if (this.stage === "gilt") return GILT_DAILY_GAIN_KG * this.growthFactor * this.maturityFactor;
    const base =
      this.stage === "weaner"
        ? config.growth.weanerDailyGainKg
        : this.stage === "grower"
          ? config.growth.growerDailyGainKg
          : config.growth.finisherDailyGainKg;
    return base * sexFactor(this.sex) * this.growthFactor * this.maturityFactor;
  }

  /**
   * Intake is built the way a pig actually eats: upkeep for the body it is
   * carrying, and on top of that the feed its day's gain costs at the weight it
   * is at now. Both terms rise with weight, so conversion worsens across the
   * growout on its own — a 95 kg finisher eats measurably more than a 62 kg one
   * and turns less of it into meat. Stage still picks the bin the feed comes out
   * of, and sex still scales appetite through the gain it supports.
   */
  dailyFeed(config: PlannerConfig): FeedDemand {
    // A suckling pig lives on milk, which is paid for through the sow's ration.
    // Its creep feed is handled separately because it depends on age, not stage.
    if (this.stage === "piglet") return NO_FEED;
    if (this.stage === "gilt") {
      return {
        kg: config.feed.gestationKgDay * this.giltRationScale(config),
        costPerKg: config.feed.sowFeedCostKg,
        ration: "sow",
      };
    }
    const ration: FeedRation =
      this.stage === "weaner" ? "weaner" : this.stage === "grower" ? "grower" : "finisher";
    const costPerKg =
      ration === "weaner"
        ? config.feed.weanerFeedCostKg
        : ration === "grower"
          ? config.feed.growerFeedCostKg
          : config.feed.finisherFeedCostKg;
    return {
      kg: dailyFeedKg(this.weightKg, this.dailyGainKg(config), config.growth),
      costPerKg,
      ration,
    };
  }

  /**
   * A gilt is on a restricted developer ration, so a feeder decides what she
   * gets rather than her appetite. Only the upkeep part of it moves with her
   * size: 1.0 at the middle of her stage, above and below it as she grows on.
   */
  private giltRationScale(config: PlannerConfig): number {
    const midWeightKg = (config.growth.saleWeightKg + config.herd.giltServiceWeightKg) / 2;
    const ratio = this.weightKg / Math.max(midWeightKg, 0.1);
    return 1 - MAINTENANCE_SHARE + MAINTENANCE_SHARE * Math.pow(ratio, 0.75);
  }

  /** Creep feed offered to a suckling piglet once it is old enough to eat. */
  creepFeed(day: number, config: PlannerConfig): FeedDemand {
    if (this.stage !== "piglet") return NO_FEED;
    if (this.ageDays(day) < config.feed.creepStartAgeDays) return NO_FEED;
    return {
      kg: config.feed.creepKgPerPigDay,
      costPerKg: config.feed.creepFeedCostKg,
      ration: "creep",
    };
  }

  /**
   * The gain this pig makes today, which is the lower of two ceilings.
   *
   * One is the animal: what a pig of its stage, sex and thriftiness can put on,
   * less what the room it is standing in and whatever it is being treated for
   * take off it. The other is the feed: the kilograms it was actually handed,
   * less its own upkeep, over what a kilogram of gain costs at this weight. A
   * pig grows at whichever runs out first, and neither is allowed to stand in
   * for the other — a shed with no room in it does not make feed go further,
   * and a full trough does not cure anything.
   */
  achievedGainKg(config: PlannerConfig, day?: number): number {
    const treatmentFactor = this.treatmentPenaltyDays > 0 ? this.treatmentGrowthFactor : 1;
    const potential = this.dailyGainKg(config, day) * this.crowdingFactor * treatmentFactor;
    if (this.stage === "piglet") {
      // A suckler lives on milk, and the milk is its dam's to give. What that
      // milk and the creep feeder paid for is worked out over the whole litter
      // in `lib/sim/lactation` and handed down to the piglet in kilograms.
      if (this.milkGainKg === null) return potential;
      return Math.min(potential, this.milkGainKg);
    }
    if (this.stage === "gilt") {
      // She is on a restricted developer ration a feeder decides rather than an
      // appetite, so what a short day costs her is worked off the ration and not
      // off the growth curve: the upkeep share has to be covered before she puts
      // anything on.
      if (this.intakeFactor >= 1) return potential;
      const spare = (this.intakeFactor - MAINTENANCE_SHARE) / (1 - MAINTENANCE_SHARE);
      return potential * Math.max(0, spare);
    }
    // The issue itself where there is one, so that what the books say left the
    // bin is what the pig grew on.
    if (this.feedEatenKg !== null) {
      return growthAccountOf(this.weightKg, potential, this.feedEatenKg, config.growth).gainKg;
    }
    if (this.intakeFactor >= 1) return potential;
    return achievedGainKg(this.weightKg, potential, this.intakeFactor, config.growth);
  }

  /**
   * Adds one day of liveweight and moves the pig up a stage once it qualifies.
   *
   * This is the 1.x rule, and the 1.x engine still runs on it: growing on and
   * moving on are the same event, because nothing in that engine can refuse the
   * move. The 2.0 engine splits the two — see {@link advanceWeight} and
   * {@link nextStage} — because there a stage is a room with a finite number of
   * places in it.
   */
  grow(config: PlannerConfig, day?: number): void {
    // The same growth rule the 2.0 engine uses, and for the same reason there is
    // only one of it: what the pig ate today, less what it took to keep it, over
    // what a kilogram of gain costs at this weight. This engine buys feed as it
    // is eaten and no store in it can run dry, so a growing pig here is always on
    // a full ration and the rule hands back its plan rate, exactly as it always
    // did. A suckler is the exception in both engines, because its feed is its
    // dam's and hers can fall short of what her litter is trying to grow.
    this.weightKg = Math.max(BIRTH_WEIGHT_KG, this.weightKg + this.achievedGainKg(config, day));
    if (this.stage === "piglet" || this.stage === "gilt") return;
    if (this.destination === "breeding" && this.weightKg >= config.growth.saleWeightKg) {
      this.moveToStage("gilt");
      return;
    }
    if (this.weightKg >= config.growth.finisherStartWeightKg) this.moveToStage("finisher");
    else if (this.weightKg >= config.growth.growerStartWeightKg) this.moveToStage("grower");
  }

  /**
   * Adds the day's liveweight and nothing else. What the weight has earned the
   * pig is {@link nextStage}; whether it gets it is the farm's business rather
   * than the pig's, and in the 2.0 engine it is settled by the housing.
   */
  advanceWeight(config: PlannerConfig, day?: number): void {
    this.weightKg = Math.max(BIRTH_WEIGHT_KG, this.weightKg + this.achievedGainKg(config, day));
    if (this.treatmentPenaltyDays > 0) this.treatmentPenaltyDays -= 1;
  }

  /**
   * The stage this pig's weight now qualifies it for, or null when it is in the
   * right one. A pig picked out to breed leaves the growing houses at sale
   * weight, whatever the market pigs beside it are doing.
   */
  nextStage(config: PlannerConfig): PigStage | null {
    if (this.stage === "piglet" || this.stage === "gilt") return null;
    if (this.destination === "breeding" && this.weightKg >= config.growth.saleWeightKg) {
      return "gilt";
    }
    const earned: PigStage =
      this.weightKg >= config.growth.finisherStartWeightKg
        ? "finisher"
        : this.weightKg >= config.growth.growerStartWeightKg
          ? "grower"
          : "weaner";
    if (earned === this.stage) return null;
    return STAGE_ORDER[earned] > STAGE_ORDER[this.stage] ? earned : null;
  }

  /**
   * Moves the pig into a stage and remembers the weight it walked in at.
   *
   * Every stage change in either engine goes through here, because the entry
   * weight is the only record of how much of a stage a pig has actually stood
   * through — see {@link stageEntryWeightKg}. Setting the stage without it
   * leaves the mortality scheduler reading the pig's position off the plan's
   * average instead of off the pig.
   */
  moveToStage(stage: PigStage): void {
    this.stage = stage;
    this.stageEntryWeightKg = this.weightKg;
  }

  /**
   * Takes the pig off the sow. The 1.x rule puts a heavy weaner straight into
   * whichever house its weight belongs in; the 2.0 engine lands every weaner in
   * the weaner house and lets the housing decide what happens next, so it asks
   * for {@link weanIntoNursery} instead.
   */
  wean(day: number, config: PlannerConfig): void {
    this.weanIntoNursery(day, config);
    if (this.weightKg >= config.growth.finisherStartWeightKg) this.moveToStage("finisher");
    else if (this.weightKg >= config.growth.growerStartWeightKg) this.moveToStage("grower");
  }

  /**
   * Off the sow and into the weaner house, at the weight it actually reached.
   *
   * Nothing is added here. It used to leave the sow at
   * `max(weight, referenceWeaningWeight)`, which handed a kilogram to every
   * piglet whose dam had not been fed enough to grow it — and did it at the one
   * moment the shortfall would otherwise have shown. A piglet leaves its dam
   * weighing what she and the creep feeder made it weigh.
   *
   * Opening stock is the one place a weaner is placed at a weight rather than
   * growing to it, and it is placed there when the plan opens rather than
   * weaned into it: see `startingWeaner` in `lib/sim/starting-stock`.
   */
  weanIntoNursery(day: number, config: PlannerConfig): void {
    void config;
    this.weanedOnDay = day;
    this.moveToStage("weaner");
  }

  /**
   * The cohort this pig is killed with: every market pig born on the same day.
   * Litter mates are reared together and go in one batch, so the day is settled
   * by the cohort's average weight, not by each pig's own.
   */
  get cohort(): number {
    return this.birthDay;
  }

  /** A market pig that is weaned and can be counted into its cohort's kill. */
  readyForMarket(): boolean {
    return this.destination === "market" && !this.suckling;
  }

  /**
   * Records the day this gilt reaches puberty: the first day she is both old
   * enough and heavy enough to stand. Called once a day; it only ever writes
   * once, because a herd's breeding calendar hangs off that one day.
   */
  noteFirstHeat(day: number, config: PlannerConfig): void {
    if (this.firstHeatDay !== null) return;
    if (this.destination !== "breeding" || this.stage !== "gilt") return;
    const old = this.ageDays(day) >= config.herd.giltPubertyAgeDays + this.estrusOffsetDays;
    const grown = this.weightKg >= config.herd.giltPubertyWeightKg;
    if (old && grown) this.firstHeatDay = day;
  }

  /**
   * Which standing heat she is on today — 1 at puberty, 2 a cycle later — or 0
   * on any day between them. A gilt can only be served on a day she stands, so
   * a batch coming to weight together still goes to the boar a cycle apart
   * rather than all on the morning the scale says they are ready.
   */
  heatNumberOn(day: number): number {
    if (this.firstHeatDay === null || day < this.firstHeatDay) return 0;
    const since = day - this.firstHeatDay;
    return since % ESTRUS_CYCLE_DAYS === 0 ? since / ESTRUS_CYCLE_DAYS + 1 : 0;
  }

  /**
   * A selected gilt joins the breeding herd on a standing heat: the plan's
   * chosen heat or later, and then only if she is carrying the weight and the
   * age by the time it comes round. Missing either holds her to the next heat
   * rather than to the next day, which is what puts a herd's services a cycle
   * apart instead of spreading them over whatever days the gilts hit target.
   */
  readyToBreed(day: number, config: PlannerConfig): boolean {
    return (
      this.destination === "breeding" &&
      this.stage === "gilt" &&
      this.heatNumberOn(day) >= config.herd.giltServeAtHeat &&
      this.weightKg >= config.herd.giltServiceWeightKg &&
      this.ageDays(day) >= config.herd.giltServiceAgeDays
    );
  }
}

/** A breeding female cycling through service, gestation and lactation. */
export class Sow extends Animal {
  state: SowState;
  parity = 0;
  nextServiceDay: number;
  dueDay: number | null = null;
  weanDay: number | null = null;
  litter: GrowingPig[] = [];
  servicesUsed = 0;
  /**
   * The day she is due to be scanned for this service, or null when there is
   * nothing to scan for. A scan tells the farm what the sow will not: that she
   * is empty, before she has spent another three weeks looking otherwise.
   */
  scanDay: number | null = null;
  /** A confirmed pregnancy loss scheduled after scanning, if this gestation loses. */
  pregnancyLossDay: number | null = null;
  /** Whether the service she is carrying came back — or would come back — late. */
  lastReturnIrregular = false;
  /** The day she is due back in heat when this service did not hold. */
  returnDay: number | null = null;
  /**
   * Whether this standing heat was spotted, drawn once on the day it opens and
   * cleared when it closes. Detection is not conception: a heat nobody saw is a
   * cycle gone with no service to charge for and nothing on the service card.
   */
  heatDetected: boolean | null = null;
  /** Standing heats that opened and closed without a service. */
  heatsMissed = 0;
  totalBornAlive = 0;
  totalWeaned = 0;
  lastSireTag: string | null = null;
  /** Set when this sow was reared on the farm rather than bought in. */
  readonly homeBred: boolean;

  constructor(init: {
    id: string;
    tag: string;
    birthDay: number;
    weightKg: number;
    state?: SowState;
    nextServiceDay?: number;
    generation?: number;
    damTag?: string | null;
    sireLine?: readonly string[];
    homeBred?: boolean;
  }) {
    super({ ...init, sex: "female" });
    this.state = init.state ?? "open";
    this.nextServiceDay = init.nextServiceDay ?? 0;
    this.homeBred = init.homeBred ?? false;
  }

  /** Promotes a selected gilt, carrying her identity, lineage and rearing cost. */
  static fromGilt(pig: GrowingPig, day: number): Sow {
    const sow = new Sow({
      id: pig.id,
      tag: pig.tag,
      birthDay: pig.birthDay,
      weightKg: pig.weightKg,
      state: "open",
      nextServiceDay: day,
      generation: pig.generation,
      damTag: pig.damTag,
      sireLine: pig.sireLine,
      homeBred: true,
    });
    sow.costs.absorb(pig.costs);
    return sow;
  }

  get costStage(): CostStage {
    return "breeding";
  }

  /**
   * The live litter under her, and what it is asking of her today.
   *
   * The one calculation that has to see two animals at once: what the piglets
   * are trying to grow decides what their dam is given, and what she is given
   * decides what they actually grow. Both halves are in `lib/sim/lactation` so
   * that the two engines, the forecaster and her ration cannot drift apart.
   */
  lactationDemand(day: number, config: PlannerConfig): LactationDemand {
    let sucklers = 0;
    let potentialGainKg = 0;
    let creepOfferedKg = 0;
    for (const piglet of this.litter) {
      if (!piglet.alive || piglet.stage !== "piglet") continue;
      sucklers += 1;
      potentialGainKg += piglet.dailyGainKg(config, day);
      creepOfferedKg += piglet.creepFeed(day, config).kg;
    }
    return lactationDemandOf(
      { weightKg: this.weightKg, sucklers, potentialGainKg, creepOfferedKg },
      config,
    );
  }

  dailyFeed(config: PlannerConfig, day: number): FeedDemand {
    // Fed for her litter: the milk it is asking for, plus her own upkeep, up to
    // the lactation ration the plan allows. A flat figure here was what let a
    // sow suckling six and a sow suckling fourteen cost the same to keep.
    if (this.state === "lactating") {
      return {
        kg: this.lactationDemand(day, config).offeredKg,
        costPerKg: config.feed.sowFeedCostKg,
        ration: "sow",
      };
    }
    // A lighter young sow on the same ration plan eats less than a mature one.
    const scale = Math.pow(this.weightKg / MATURE_SOW_WEIGHT_KG, 0.75);
    return {
      kg: config.feed.gestationKgDay * scale,
      costPerKg: config.feed.sowFeedCostKg,
      ration: "sow",
    };
  }

  /**
   * Whether she is standing today.
   *
   * She is due on her date and for the two or three days after it, and then she
   * is not due again for three weeks. This used to read `day >= nextServiceDay`,
   * which made a sow permanently in season from her date onwards: anything that
   * held a service up — a worked-out boar team, no unrelated mate, a technician
   * who did not come — cost her a day rather than a cycle, and the farm's boar
   * capacity was not a constraint so much as a queue.
   */
  inHeat(day: number, windowDays: number): boolean {
    if (!this.alive || this.state !== "open") return false;
    return day >= this.nextServiceDay && day < this.nextServiceDay + Math.max(1, windowDays);
  }

  /** The first day of a standing heat, which is the day it is spotted or not. */
  heatOpens(day: number): boolean {
    return this.alive && this.state === "open" && day === this.nextServiceDay;
  }

  /** The last day of the window: after this she is gone for a cycle. */
  heatCloses(day: number, windowDays: number): boolean {
    return (
      this.alive &&
      this.state === "open" &&
      day === this.nextServiceDay + Math.max(1, windowDays) - 1
    );
  }

  /**
   * Closes a heat that went by without a service, for whatever reason. She comes
   * round again on the next cycle, three weeks of feed later, and the plan has
   * that as a missed opportunity rather than a service deferred to tomorrow.
   */
  missHeat(): void {
    this.nextServiceDay += ESTRUS_CYCLE_DAYS;
    this.heatDetected = null;
    this.heatsMissed += 1;
  }

  dueForService(day: number): boolean {
    return this.alive && this.state === "open" && day >= this.nextServiceDay;
  }

  /**
   * Records a service. One that holds puts her in pig; one that does not brings
   * her back in heat, on the next cycle or a week or two past it depending on
   * whether she never took or lost it after she had. Both are scanned: a scan
   * is booked off the service, not off what the service turned out to be.
   *
   * Gestation length, the return interval and whether the return is irregular
   * are all passed in, because each varies from sow to sow and the farm is what
   * holds the plan's variation.
   */
  serve(
    day: number,
    conceived: boolean,
    gestationDays: number,
    sireTag: string | null,
    outcome: { returnDays: number; irregular: boolean; scanDays: number },
  ): void {
    this.servicesUsed += 1;
    this.lastSireTag = sireTag;
    this.heatDetected = null;
    this.scanDay = day + outcome.scanDays;
    this.lastReturnIrregular = !conceived && outcome.irregular;
    if (conceived) {
      this.state = "gestating";
      this.dueDay = day + Math.round(gestationDays);
      this.returnDay = null;
      this.pregnancyLossDay = null;
    } else {
      this.returnDay = day + outcome.returnDays;
      this.nextServiceDay = this.returnDay;
    }
  }

  farrow(day: number, piglets: GrowingPig[], config: PlannerConfig): void {
    this.state = "lactating";
    this.parity += 1;
    this.litter = piglets;
    this.totalBornAlive += piglets.length;
    this.dueDay = null;
    this.pregnancyLossDay = null;
    this.weanDay = day + Math.round(config.reproduction.weaningAgeDays);
  }

  /** Ends a confirmed gestation without a litter and books a recovery interval. */
  losePregnancy(day: number, returnDelayDays: number): void {
    this.state = "open";
    this.dueDay = null;
    this.scanDay = null;
    this.pregnancyLossDay = null;
    this.returnDay = null;
    this.nextServiceDay = day + Math.max(1, Math.round(returnDelayDays));
  }

  /**
   * Ends lactation and returns the piglets that survived to weaning. How long she
   * takes to come back into heat is passed in, because sows differ.
   */
  wean(day: number, config: PlannerConfig, weanToServiceDays: number): GrowingPig[] {
    const weaned = this.litter.filter((piglet) => piglet.alive);
    for (const piglet of weaned) piglet.wean(day, config);
    this.totalWeaned += weaned.length;
    this.litter = [];
    this.state = "open";
    this.weanDay = null;
    this.nextServiceDay = day + Math.max(1, Math.round(weanToServiceDays));
    this.weightKg = Math.min(MAX_SOW_WEIGHT_KG, this.weightKg + SOW_WEIGHT_GAIN_PER_PARITY_KG);
    return weaned;
  }

  readyToCull(config: PlannerConfig): boolean {
    return this.state === "open" && this.parity >= config.herd.cullAfterParity;
  }
}

/** A working boar: he eats every day and caps how many sows can be served. */
export class Boar extends Animal {
  servicesThisWeek = 0;
  totalServices = 0;
  /** The day he started work here, which is what his rotation is counted from. */
  readonly joinedDay: number;

  constructor(init: {
    id: string;
    tag: string;
    birthDay: number;
    weightKg?: number;
    generation?: number;
    joinedDay?: number;
  }) {
    super({ ...init, sex: "male", weightKg: init.weightKg ?? BOAR_WEIGHT_KG });
    this.joinedDay = init.joinedDay ?? 0;
  }

  /**
   * A boar is rotated out at the end of his working life. Standing him longer
   * than that puts him over his own daughters, which is what the rotation exists
   * to prevent.
   */
  readyToRotate(day: number, workingLifeDays: number): boolean {
    return day - this.joinedDay >= workingLifeDays;
  }

  get costStage(): CostStage {
    return "breeding";
  }

  dailyFeed(config: PlannerConfig): FeedDemand {
    const scale = Math.pow(this.weightKg / BOAR_WEIGHT_KG, 0.75);
    return { kg: config.feed.boarKgDay * scale, costPerKg: config.feed.sowFeedCostKg, ration: "sow" };
  }
}
