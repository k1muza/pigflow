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
import { dailyFeedKg } from "../growth-curve";

export type Sex = "female" | "male";
/** Where a pig sits on its way to the abattoir or the farrowing house. */
export type PigStage = "piglet" | "weaner" | "grower" | "finisher" | "gilt";
export type Destination = "market" | "breeding";
export type SowState = "gestating" | "lactating" | "open";
export type ExitReason = "sold" | "sold-as-gilt" | "died" | "culled";

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
    if (this.stage === "gilt") return GILT_DAILY_GAIN_KG * this.growthFactor;
    const base =
      this.stage === "weaner"
        ? config.growth.weanerDailyGainKg
        : this.stage === "grower"
          ? config.growth.growerDailyGainKg
          : config.growth.finisherDailyGainKg;
    return base * sexFactor(this.sex) * this.growthFactor;
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

  /** Adds one day of liveweight and moves the pig up a stage once it qualifies. */
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

  wean(day: number, config: PlannerConfig): void {
    this.weanedOnDay = day;
    this.weightKg = Math.max(this.weightKg, config.growth.weaningWeightKg);
    this.stage = "weaner";
    if (this.weightKg >= config.growth.finisherStartWeightKg) this.stage = "finisher";
    else if (this.weightKg >= config.growth.growerStartWeightKg) this.stage = "grower";
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
  /** Whether the service she is carrying came back — or would come back — late. */
  lastReturnIrregular = false;
  /** The day she is due back in heat when this service did not hold. */
  returnDay: number | null = null;
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
    this.scanDay = day + outcome.scanDays;
    this.lastReturnIrregular = !conceived && outcome.irregular;
    if (conceived) {
      this.state = "gestating";
      this.dueDay = day + Math.round(gestationDays);
      this.returnDay = null;
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
    this.weanDay = day + Math.round(config.reproduction.weaningAgeDays);
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
