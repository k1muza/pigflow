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

export type FeedDemand = { kg: number; costPerKg: number };

const NO_FEED: FeedDemand = { kg: 0, costPerKg: 0 };

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
  readonly sireTag: string | null;
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
    sireTag?: string | null;
  }) {
    this.id = init.id;
    this.tag = init.tag;
    this.sex = init.sex;
    this.birthDay = init.birthDay;
    this.weightKg = init.weightKg;
    this.generation = init.generation ?? 0;
    this.damTag = init.damTag ?? null;
    this.sireTag = init.sireTag ?? null;
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
  /** Days past the service minimum before this gilt shows a standing heat. */
  estrusOffsetDays = 0;
  /** Set once this pig has been looked over for breeding, kept or not. */
  assessedForBreeding = false;

  constructor(init: {
    id: string;
    tag: string;
    sex: Sex;
    birthDay: number;
    weightKg: number;
    stage: PigStage;
    generation?: number;
    damTag?: string | null;
    sireTag?: string | null;
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

  /** Midpoint weight of the stage this pig is in, used to scale maintenance feed. */
  private stageMidWeightKg(config: PlannerConfig): number {
    const { growth } = config;
    switch (this.stage) {
      case "piglet":
        return (BIRTH_WEIGHT_KG + growth.weaningWeightKg) / 2;
      case "weaner":
        return (growth.weaningWeightKg + growth.growerStartWeightKg) / 2;
      case "grower":
        return (growth.growerStartWeightKg + growth.finisherStartWeightKg) / 2;
      case "finisher":
        return (growth.finisherStartWeightKg + growth.saleWeightKg) / 2;
      case "gilt":
        return (growth.saleWeightKg + config.herd.giltServiceWeightKg) / 2;
    }
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
   * Intake is driven by what this pig is: its stage sets the ration, its sex
   * scales appetite, and its weight scales the maintenance part of the ration,
   * so a 95 kg finisher eats measurably more than a 62 kg one.
   */
  dailyFeed(config: PlannerConfig): FeedDemand {
    // A suckling pig lives on milk, which is paid for through the sow's ration.
    // Its creep feed is handled separately because it depends on age, not stage.
    if (this.stage === "piglet") return NO_FEED;
    if (this.stage === "gilt") {
      return {
        kg: config.feed.gestationKgDay * this.maintenanceScale(config),
        costPerKg: config.feed.sowFeedCostKg,
      };
    }
    const fcr =
      this.stage === "weaner"
        ? config.growth.weanerFcr
        : this.stage === "grower"
          ? config.growth.growerFcr
          : config.growth.finisherFcr;
    const costPerKg =
      this.stage === "weaner"
        ? config.feed.weanerFeedCostKg
        : this.stage === "grower"
          ? config.feed.growerFeedCostKg
          : config.feed.finisherFeedCostKg;
    return { kg: this.dailyGainKg(config) * fcr * this.maintenanceScale(config), costPerKg };
  }

  /** 1.0 at the middle of the stage; above and below it as the pig grows through. */
  private maintenanceScale(config: PlannerConfig): number {
    const ratio = this.weightKg / Math.max(this.stageMidWeightKg(config), 0.1);
    return 1 - MAINTENANCE_SHARE + MAINTENANCE_SHARE * Math.pow(ratio, 0.75);
  }

  /** Creep feed offered to a suckling piglet once it is old enough to eat. */
  creepFeed(day: number, config: PlannerConfig): FeedDemand {
    if (this.stage !== "piglet") return NO_FEED;
    if (this.ageDays(day) < config.feed.creepStartAgeDays) return NO_FEED;
    return { kg: config.feed.creepKgPerPigDay, costPerKg: config.feed.creepFeedCostKg };
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

  /** A market pig is drawn the day it reaches sale weight. */
  readyForMarket(config: PlannerConfig): boolean {
    return (
      this.destination === "market" &&
      !this.suckling &&
      this.weightKg >= config.growth.saleWeightKg
    );
  }

  /**
   * A selected gilt joins the breeding herd on weight and age together, and then
   * only on her next standing heat — which is what keeps a batch of litter mates
   * from all being served on the same day.
   */
  readyToBreed(day: number, config: PlannerConfig): boolean {
    return (
      this.destination === "breeding" &&
      this.stage === "gilt" &&
      this.weightKg >= config.herd.giltServiceWeightKg &&
      this.ageDays(day) >= config.herd.giltServiceAgeDays + this.estrusOffsetDays
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
    sireTag?: string | null;
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
      sireTag: pig.sireTag,
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
    return { kg: ration * scale, costPerKg: config.feed.sowFeedCostKg };
  }

  dueForService(day: number): boolean {
    return this.alive && this.state === "open" && day >= this.nextServiceDay;
  }

  /**
   * Records a service. A service that does not hold returns to estrus one cycle
   * later. Gestation length is passed in because it varies from sow to sow.
   */
  serve(
    day: number,
    conceived: boolean,
    gestationDays: number,
    sireTag: string | null,
  ): void {
    this.servicesUsed += 1;
    this.lastSireTag = sireTag;
    if (conceived) {
      this.state = "gestating";
      this.dueDay = day + Math.round(gestationDays);
    } else {
      this.nextServiceDay = day + ESTRUS_CYCLE_DAYS;
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
    return { kg: config.feed.boarKgDay * scale, costPerKg: config.feed.sowFeedCostKg };
  }
}
