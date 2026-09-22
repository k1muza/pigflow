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
import { achievedGainKg, dailyFeedKg } from "../growth-curve";

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
export type AnimalDeparture = { id: string; day: number; reason: ExitReason | null };

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

  /** Feed eaten on one day, with the price of the ration that animal is on. */
  abstract dailyFeed(config: PlannerConfig): FeedDemand;

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
   * The day this pig first qualified to move up a stage and was refused a place
   * in the room it was moving into, or null when it is not waiting on one. A
   * batch that is held does not stop growing — it goes on filling the room it is
   * already in, which is exactly how housing pressure travels back up a farm.
   */
  heldSinceDay: number | null = null;
  /**
   * Share of the feed this pig asked for that it was actually given today. 1 on
   * any day the stores covered the herd, and below it when one did not.
   */
  intakeFactor = 1;
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

  dailyGainKg(config: PlannerConfig): number {
    if (this.stage === "piglet") {
      return (
        (config.growth.weaningWeightKg - BIRTH_WEIGHT_KG) / config.reproduction.weaningAgeDays
      );
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
   * The gain this pig makes today: what it could have made, less what the room
   * it is standing in and the feed it was given took off. Crowding comes off the
   * potential — a pig with nowhere to lie eats less and fights more — and the
   * ration is then worked out against what is left, upkeep first.
   */
  achievedGainKg(config: PlannerConfig): number {
    const treatmentFactor = this.treatmentPenaltyDays > 0 ? this.treatmentGrowthFactor : 1;
    const potential = this.dailyGainKg(config) * this.crowdingFactor * treatmentFactor;
    if (this.intakeFactor >= 1) return potential;
    if (this.stage === "piglet") {
      // A suckler lives on milk, and milk follows what the sow was given.
      return potential * Math.max(0, this.intakeFactor);
    }
    if (this.stage === "gilt") {
      // She is on a restricted ration a feeder decides, and the upkeep share of
      // it is the part that has to be covered before she puts anything on.
      const spare = (this.intakeFactor - MAINTENANCE_SHARE) / (1 - MAINTENANCE_SHARE);
      return potential * Math.max(0, spare);
    }
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
  grow(config: PlannerConfig): void {
    this.weightKg += this.dailyGainKg(config);
    if (this.stage === "piglet" || this.stage === "gilt") return;
    if (this.destination === "breeding" && this.weightKg >= config.growth.saleWeightKg) {
      this.stage = "gilt";
      return;
    }
    if (this.weightKg >= config.growth.finisherStartWeightKg) this.stage = "finisher";
    else if (this.weightKg >= config.growth.growerStartWeightKg) this.stage = "grower";
  }

  /**
   * Adds the day's liveweight and nothing else. What the weight has earned the
   * pig is {@link nextStage}; whether it gets it is the farm's business rather
   * than the pig's, and in the 2.0 engine it is settled by the housing.
   */
  advanceWeight(config: PlannerConfig): void {
    this.weightKg = Math.max(BIRTH_WEIGHT_KG, this.weightKg + this.achievedGainKg(config));
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
   * Takes the pig off the sow. The 1.x rule puts a heavy weaner straight into
   * whichever house its weight belongs in; the 2.0 engine lands every weaner in
   * the weaner house and lets the housing decide what happens next, so it asks
   * for {@link weanIntoNursery} instead.
   */
  wean(day: number, config: PlannerConfig): void {
    this.weanIntoNursery(day, config);
    if (this.weightKg >= config.growth.finisherStartWeightKg) this.stage = "finisher";
    else if (this.weightKg >= config.growth.growerStartWeightKg) this.stage = "grower";
  }

  /** Off the sow and into the weaner house, wherever its weight might allow. */
  weanIntoNursery(day: number, config: PlannerConfig): void {
    this.weanedOnDay = day;
    this.weightKg = Math.max(this.weightKg, config.growth.weaningWeightKg);
    this.stage = "weaner";
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

  dailyFeed(config: PlannerConfig): FeedDemand {
    const ration =
      this.state === "lactating" ? config.feed.lactationKgDay : config.feed.gestationKgDay;
    // A lighter young sow on the same ration plan eats less than a mature one.
    const scale = Math.pow(this.weightKg / MATURE_SOW_WEIGHT_KG, 0.75);
    return { kg: ration * scale, costPerKg: config.feed.sowFeedCostKg, ration: "sow" };
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
