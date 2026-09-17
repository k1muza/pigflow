import { addDays, addMonths, differenceInCalendarDays, format, parseISO } from "date-fns";

import {
  BIRTH_WEIGHT_KG,
  BOAR_WEIGHT_KG,
  DAYS_PER_MONTH,
  GILT_ACCLIMATISATION_DAYS,
  GILT_ENTRY_AGE_DAYS,
  MATURE_SOW_WEIGHT_KG,
  SERVICES_PER_BOAR_PER_WEEK,
  deadweightKg,
  plannerSchema,
  workersNeeded,
  type PlannerConfig,
  type Vaccination,
} from "../config";
import {
  Boar,
  COST_STAGES,
  COST_TYPES,
  CostRecord,
  GrowingPig,
  Sow,
  type CostStage,
  type CostType,
  type FeedRation,
  type PigStage,
} from "./animals";
import {
  emptyRations,
  EMPTY_FEED_PLAN,
  planFeedDeliveries,
  type FeedDelivery,
  type FeedPlan,
  type RationTally,
} from "./feed-plan";
import { emptyTotals, Ledger, type CategoryTotals } from "./ledger";
import { dailyHazard, Rng } from "./rng";

export type FarmEventType =
  | "farrowing"
  | "weaning"
  | "selection"
  | "promotion"
  | "sale"
  | "death"
  | "cull"
  | "purchase"
  | "funding"
  | "market"
  | "capacity";

export type FarmEvent = {
  day: number;
  date: string;
  type: FarmEventType;
  message: string;
};

export type StageCounts = {
  sows: number;
  gestatingSows: number;
  lactatingSows: number;
  openSows: number;
  boars: number;
  piglets: number;
  weaners: number;
  growers: number;
  finishers: number;
  gilts: number;
  /** Every pig selected to breed, at whatever stage it has reached. */
  replacementPipeline: number;
  growingTotal: number;
  total: number;
};

export type DayRecord = {
  day: number;
  date: string;
  farrowings: number;
  bornAlive: number;
  weaned: number;
  sold: number;
  soldLiveweightKg: number;
  soldDeadweightKg: number;
  giltsSelected: number;
  giltsPromoted: number;
  giltsSold: number;
  /** Services read a cycle later: held, or back in heat to be served again. */
  conceptions: number;
  returnsToHeat: number;
  /** Growing pigs that moved up a stage today. */
  movedToGrower: number;
  movedToFinisher: number;
  pigletDeaths: number;
  growingDeaths: number;
  breedingDeaths: number;
  sowsCulled: number;
  giltsPurchased: number;
  boarsRotated: number;
  services: number;
  /** Stockpeople the herd needs at this size. */
  workers: number;
  vaccinations: Record<PigStage, number>;
  sowFeedKg: number;
  growingFeedKg: number;
  /** What the herd ate today, ration by ration. */
  feedByRation: RationTally;
  /** Loads that came through the gate today, each with the order it carried. */
  feedDeliveries: FeedDelivery[];
  feedLoads: number;
  feedDeliveredKg: number;
  /** Runs the lorry made to the abattoir today with the pigs sold. */
  marketTrips: number;
  counts: StageCounts;
  totals: CategoryTotals;
  netCashFlow: number;
  closingCash: number;
};

export type LifetimeTotals = {
  litters: number;
  bornAlive: number;
  weaned: number;
  sold: number;
  soldLiveweightKg: number;
  soldDeadweightKg: number;
  giltsSelected: number;
  giltsPromoted: number;
  giltsSold: number;
  pigletDeaths: number;
  growingDeaths: number;
  breedingDeaths: number;
  sowsCulled: number;
  giltsPurchased: number;
  boarsRotated: number;
  servicesAttempted: number;
  /** Feed loads hauled in since the plan started. */
  feedLoads: number;
  feedDeliveredKg: number;
  feedHaulageCost: number;
  /** Runs to the abattoir since the plan started, and what they cost. */
  marketTrips: number;
  marketHaulageCost: number;
  servicesMissedForBoarCapacity: number;
  /** Services deferred because the only boar standing was the female's own sire. */
  servicesMissedForGenetics: number;
};

export type SowRow = {
  tag: string;
  state: Sow["state"];
  parity: number;
  ageMonths: number;
  weightKg: number;
  generation: number;
  homeBred: boolean;
  litterSize: number;
  totalWeaned: number;
  lifetimeCost: number;
  nextEvent: string;
  daysToNextEvent: number | null;
};

export type StockKind = PigStage | "sow" | "boar";

/** One live animal available on the farm at a point in the plan. */
export type StockRow = {
  tag: string;
  kind: StockKind;
  sex: "female" | "male";
  ageDays: number;
  ageMonths: number;
  weightKg: number;
  generation: number;
  status: string;
};

export type GenerationRow = {
  generation: number;
  born: number;
  alive: number;
  breedingFemales: number;
  sold: number;
  died: number;
};

/** What a market pig has cost by the time it is drawn, and what it returned. */
export type CostOfProduction = {
  pigsSold: number;
  averageSaleWeightKg: number;
  averageDeadweightKg: number;
  directByStage: Record<CostStage, number>;
  directByType: Record<CostType, number>;
  directPerPig: number;
  /**
   * The breeding herd's running cost, net of what it earns selling gilts and
   * cull sows, carried onto the market pigs it produced. Sow feed is a cost of
   * producing a market pig; leaving it out flatters the margin badly.
   */
  breedingCostPerPig: number;
  allocatedOverheadPerPig: number;
  fullCostPerPig: number;
  revenuePerPig: number;
  marginPerPig: number;
  fullCostPerKg: number;
  /** Full cost against the carcass weight the price is quoted on. */
  fullCostPerDeadweightKg: number;
};

export type FarmState = {
  day: number;
  date: string;
  timestamp: string;
  withinHorizon: boolean;
  herd: StageCounts & {
    liveweightKg: number;
    averageWeightKg: Record<PigStage, number>;
    maxSows: number;
  };
  finance: {
    openingCash: number;
    cash: number;
    income: number;
    expenses: number;
    herdValue: number;
    netWorth: number;
    totals: CategoryTotals;
    last30Days: { income: number; expenses: number; net: number };
  };
  lifetime: LifetimeTotals;
  generations: GenerationRow[];
  costOfProduction: CostOfProduction;
  stock: StockRow[];
  sows: SowRow[];
  recentEvents: FarmEvent[];
};

const STOCK_ORDER: StockKind[] = [
  "sow",
  "gilt",
  "boar",
  "piglet",
  "weaner",
  "grower",
  "finisher",
];

const MAX_EVENTS = 400;
const LITTER_SIZE_DEVIATION = 2.6;
/** Spread of individual thriftiness within a litter. */
const GROWTH_FACTOR_DEVIATION = 0.07;
/** Sows do not all carry for the same number of days, nor return to heat together. */
const GESTATION_DEVIATION_DAYS = 1.4;
const WEAN_TO_SERVICE_DEVIATION_DAYS = 2.5;
/**
 * No more than this many gilts are ever kept out of one litter. It is ordinary
 * selection practice — it spreads the genetics — and it is what stops a herd that
 * is filling its places from drawing every replacement out of the same fortnight
 * of litters, which would lock it into one batch that farrows together for years.
 */
const MAX_GILTS_PER_LITTER = 2;
/** A gilt is served on her next standing heat, which recurs every 21 days. */
const GILT_HEAT_WINDOW_DAYS = 21;
/**
 * How far clear of a post's threshold the herd has to fall before that post is
 * shed. A farm takes a stockperson on as soon as the work is there, but it does
 * not lay one off over a single month's swing in a batch-farrowing herd.
 */
const LABOUR_SHED_BAND = 0.1;
/** Spare gilts carried beyond the sow places, so culls can be replaced without a gap. */
const PIPELINE_BUFFER_SHARE = 0.15;
/** Opening age requested for a new, synchronised breeding herd. */
const SYNCHRONISED_START_AGE_DAYS = Math.round(7 * 30.4375);

function emptyCounts(): StageCounts {
  return {
    sows: 0,
    gestatingSows: 0,
    lactatingSows: 0,
    openSows: 0,
    boars: 0,
    piglets: 0,
    weaners: 0,
    growers: 0,
    finishers: 0,
    gilts: 0,
    replacementPipeline: 0,
    growingTotal: 0,
    total: 0,
  };
}

function emptyVaccinations(): Record<PigStage, number> {
  return { piglet: 0, weaner: 0, grower: 0, finisher: 0, gilt: 0 };
}

function stageDurationDays(stage: PigStage, config: PlannerConfig): number {
  switch (stage) {
    case "piglet":
      return config.reproduction.weaningAgeDays;
    case "weaner":
      return (
        (config.growth.growerStartWeightKg - config.growth.weaningWeightKg) /
        config.growth.weanerDailyGainKg
      );
    case "grower":
      return (
        (config.growth.finisherStartWeightKg - config.growth.growerStartWeightKg) /
        config.growth.growerDailyGainKg
      );
    case "finisher":
      return (
        (config.growth.saleWeightKg - config.growth.finisherStartWeightKg) /
        config.growth.finisherDailyGainKg
      );
    case "gilt":
      return 60;
  }
}

/** The note on a cash movement, if the owner wrote one. */
function noteOf(note: string): string {
  return note.trim() ? `: ${note.trim()}` : "";
}

/** Plans kept against the config that produced them; a few is plenty. */
const PLAN_CACHE_SIZE = 8;
const planCache = new Map<string, FeedPlan>();

/**
 * The lorry trips a plan needs. Working them out means knowing what the herd ate
 * on every day of the plan, which takes a run of the farm in its own right — so
 * the answer is kept against the plan that produced it. Without the cache, every
 * farm built from the same plan would pay for the same extra run.
 *
 * Anchoring the schedule to the end of the horizon is what keeps it stable: read
 * the farm on any date and the trips behind that date are the same trips.
 */
export function feedPlanFor(config: PlannerConfig): FeedPlan {
  const key = JSON.stringify(config);
  const cached = planCache.get(key);
  if (cached) return cached;

  const start = parseISO(config.project.startDate);
  const horizon = differenceInCalendarDays(addMonths(start, config.project.months), start) - 1;
  const probe = new Farm(config, EMPTY_FEED_PLAN).advanceTo(horizon);
  const plan = planFeedDeliveries(
    probe.history.map((day) => day.feedByRation),
    config,
  );

  if (planCache.size >= PLAN_CACHE_SIZE) {
    const oldest = planCache.keys().next().value;
    if (oldest !== undefined) planCache.delete(oldest);
  }
  planCache.set(key, plan);
  return plan;
}

/**
 * A piggery simulated one day at a time. Every sow, boar and growing pig is a
 * live object with a sex, a weight, an age and a lineage: it eats according to
 * what it is, is charged for the vaccinations and heat its age calls for, and
 * posts all of it to the ledger. Stock numbers and the financial position on any
 * date are read off the herd itself rather than from an averaged formula.
 */
export class Farm {
  readonly config: PlannerConfig;
  readonly start: Date;
  readonly ledger: Ledger;
  readonly history: DayRecord[] = [];
  readonly events: FarmEvent[] = [];
  readonly lifetime: LifetimeTotals = {
    litters: 0,
    bornAlive: 0,
    weaned: 0,
    sold: 0,
    soldLiveweightKg: 0,
    soldDeadweightKg: 0,
    giltsSelected: 0,
    giltsPromoted: 0,
    giltsSold: 0,
    pigletDeaths: 0,
    growingDeaths: 0,
    breedingDeaths: 0,
    sowsCulled: 0,
    giltsPurchased: 0,
    boarsRotated: 0,
    feedLoads: 0,
    feedDeliveredKg: 0,
    feedHaulageCost: 0,
    marketTrips: 0,
    marketHaulageCost: 0,
    servicesAttempted: 0,
    servicesMissedForBoarCapacity: 0,
    servicesMissedForGenetics: 0,
  };

  sows: Sow[] = [];
  boars: Boar[] = [];
  pigs: GrowingPig[] = [];

  /** Index of the last simulated day; -1 before the start date. */
  day = -1;

  /** The lorry trips this plan needs, worked out before the first day is run. */
  readonly feedPlan: FeedPlan;
  private readonly deliveriesByDay = new Map<number, FeedDelivery[]>();
  private readonly rng: Rng;
  private readonly hazard: Record<PigStage, number>;
  private readonly breedingHazard: number;
  private readonly vaccinations: Vaccination[];
  private readonly soldPigCosts = new CostRecord();
  /** Everything spent on keeping the breeding herd and rearing its replacements. */
  private readonly breedingCosts = new CostRecord();
  /**
   * Generated withdrawals posted to overheads. They are cash leaving the
   * business, not a cost of producing pork, so they come back out again before
   * overheads are carried over the pigs sold.
   */
  private financingCosts = 0;
  private readonly generationStats = new Map<
    number,
    { born: number; sold: number; died: number }
  >();
  private nextMonthlyChargeDay = 0;
  private monthsCharged = 0;
  private readonly giltsKeptPerLitter = new Map<string, number>();
  /** Where the service rotation left off, so the team is worked in turn. */
  private boarCursor = 0;
  /** Stockpeople currently on the payroll; re-read once a month, not daily. */
  private workersOnPayroll = 0;
  private sowSequence = 0;
  private boarSequence = 0;
  private pigSequence = 0;

  /**
   * A feed plan may be handed in; without one the farm works its own out, which
   * takes a run of its own (see {@link feedPlanFor}).
   */
  constructor(input: PlannerConfig, feedPlan?: FeedPlan) {
    this.config = plannerSchema.parse(input);
    this.start = parseISO(this.config.project.startDate);
    this.rng = new Rng(this.config.project.seed);
    this.ledger = new Ledger(this.config.project.openingCash);
    this.feedPlan = feedPlan ?? feedPlanFor(this.config);
    for (const load of this.feedPlan.deliveries) {
      const sameDay = this.deliveriesByDay.get(load.day);
      if (sameDay) sameDay.push(load);
      else this.deliveriesByDay.set(load.day, [load]);
    }
    this.vaccinations = [...this.config.health.vaccinations].sort(
      (a, b) => a.ageDays - b.ageDays,
    );
    this.breedingHazard = dailyHazard(this.config.herd.sowAnnualMortalityPct, 365);
    this.hazard = {
      piglet: dailyHazard(
        this.config.reproduction.preWeanMortalityPct,
        stageDurationDays("piglet", this.config),
      ),
      weaner: dailyHazard(
        this.config.growth.weanerMortalityPct,
        stageDurationDays("weaner", this.config),
      ),
      grower: dailyHazard(
        this.config.growth.growerMortalityPct,
        stageDurationDays("grower", this.config),
      ),
      finisher: dailyHazard(
        this.config.growth.finisherMortalityPct,
        stageDurationDays("finisher", this.config),
      ),
      gilt: this.breedingHazard,
    };
    this.seedHerd();
  }

  /** Calendar date for a simulation day index. */
  dateOf(day: number): Date {
    return addDays(this.start, day);
  }

  /** Simulation day index for a calendar date, truncated to whole days. */
  dayOf(date: Date): number {
    return differenceInCalendarDays(date, this.start);
  }

  /** Runs the farm forward to and including the target day. */
  advanceTo(targetDay: number): this {
    while (this.day < targetDay) this.step(this.day + 1);
    return this;
  }

  /** Sow places the plan allows, and the spare gilts carried on top of them. */
  get pipelineBuffer(): number {
    return Math.max(1, Math.round(this.config.herd.maxSows * PIPELINE_BUFFER_SHARE));
  }

  // ---------------------------------------------------------------- herd setup

  private nextSowTag(): string {
    this.sowSequence += 1;
    return "SOW-" + String(this.sowSequence).padStart(3, "0");
  }

  private nextBoarTag(): string {
    this.boarSequence += 1;
    return "BOAR-" + String(this.boarSequence).padStart(2, "0");
  }

  private nextPigTag(): string {
    this.pigSequence += 1;
    return "PIG-" + String(this.pigSequence).padStart(5, "0");
  }

  private noteBirth(generation: number): void {
    const stats = this.generationStats.get(generation) ?? { born: 0, sold: 0, died: 0 };
    stats.born += 1;
    this.generationStats.set(generation, stats);
  }

  private noteExit(generation: number, sold: boolean): void {
    const stats = this.generationStats.get(generation) ?? { born: 0, sold: 0, died: 0 };
    if (sold) stats.sold += 1;
    else stats.died += 1;
    this.generationStats.set(generation, stats);
  }

  /** Marks a pig as already through the vaccinations its age has passed. */
  private catchUpVaccinations(pig: GrowingPig, day: number): void {
    const age = pig.ageDays(day);
    let given = 0;
    while (given < this.vaccinations.length && age >= this.vaccinations[given].ageDays) given += 1;
    pig.vaccinationsGiven = given;
  }

  /** Every pig is drawn its own thriftiness and its own first-heat timing. */
  private growthDraw(): { growthFactor: number; estrusOffsetDays: number } {
    return {
      growthFactor: Math.min(1.3, Math.max(0.7, this.rng.normal(1, GROWTH_FACTOR_DEVIATION))),
      estrusOffsetDays: Math.floor(this.rng.next() * GILT_HEAT_WINDOW_DAYS),
    };
  }

  private createPiglet(mother: Sow, birthDay: number, weightKg: number): GrowingPig {
    const tag = this.nextPigTag();
    const piglet = new GrowingPig({
      id: tag,
      tag,
      sex: this.rng.chance(0.5) ? "female" : "male",
      birthDay,
      weightKg,
      stage: "piglet",
      generation: mother.generation + 1,
      damTag: mother.tag,
      sireTag: mother.lastSireTag,
      ...this.growthDraw(),
    });
    this.noteBirth(piglet.generation);
    return piglet;
  }

  private seedHerd(): void {
    const { reproduction, growth, stock, herd } = this.config;
    const cycleDays =
      reproduction.gestationDays + reproduction.weaningAgeDays + reproduction.weanToServiceDays;
    const sowCount = Math.round(stock.sows);

    for (let i = 0; i < sowCount; i += 1) {
      // A running herd is spread across the cycle; a synchronised start serves
      // every sow on day one.
      const synchronised = herd.startMode === "synchronised";
      const phase = synchronised ? cycleDays : Math.floor((i * cycleDays) / sowCount);
      const parity = synchronised ? 0 : herd.cullAfterParity > 0 ? i % herd.cullAfterParity : 0;
      const tag = this.nextSowTag();
      const sow = new Sow({
        id: tag,
        tag,
        birthDay: synchronised
          ? -SYNCHRONISED_START_AGE_DAYS
          : -(GILT_ENTRY_AGE_DAYS + parity * cycleDays + phase),
        weightKg: Math.min(MATURE_SOW_WEIGHT_KG + parity * 6, 250),
      });
      sow.parity = parity;

      if (phase < reproduction.gestationDays) {
        sow.state = "gestating";
        sow.dueDay = Math.round(reproduction.gestationDays - phase);
      } else if (phase < reproduction.gestationDays + reproduction.weaningAgeDays) {
        const pigletAge = Math.round(phase - reproduction.gestationDays);
        sow.state = "lactating";
        sow.parity = Math.max(1, parity);
        sow.weanDay = Math.round(reproduction.gestationDays + reproduction.weaningAgeDays - phase);
        const litterSize = this.rng.intAround(
          reproduction.bornAlivePerLitter,
          LITTER_SIZE_DEVIATION,
          1,
          25,
        );
        const gain = (growth.weaningWeightKg - BIRTH_WEIGHT_KG) / reproduction.weaningAgeDays;
        for (let p = 0; p < litterSize; p += 1) {
          const piglet = this.createPiglet(sow, -pigletAge, BIRTH_WEIGHT_KG + gain * pigletAge);
          this.catchUpVaccinations(piglet, 0);
          sow.litter.push(piglet);
          this.pigs.push(piglet);
        }
      } else {
        sow.state = "open";
        sow.nextServiceDay = Math.round(cycleDays - phase);
      }
      this.sows.push(sow);
    }

    for (let i = 0; i < Math.round(stock.boars); i += 1) {
      const tag = this.nextBoarTag();
      this.boars.push(
        new Boar({
          id: tag,
          tag,
          birthDay:
            herd.startMode === "synchronised"
              ? -SYNCHRONISED_START_AGE_DAYS
              : -(GILT_ENTRY_AGE_DAYS + 60),
          joinedDay: 0,
        }),
      );
    }

    // Starting gilts are maiden females already close to service weight.
    for (let i = 0; i < Math.round(stock.gilts); i += 1) {
      const tag = this.nextPigTag();
      const weightKg = Math.max(
        growth.saleWeightKg,
        herd.giltServiceWeightKg - 4 - (i % 6) * 4,
      );
      const gilt = new GrowingPig({
        id: tag,
        tag,
        sex: "female",
        birthDay: -Math.round(herd.giltServiceAgeDays - 10 - (i % 6) * 8),
        weightKg,
        stage: "gilt",
        ...this.growthDraw(),
      });
      gilt.destination = "breeding";
      gilt.weanedOnDay = -Math.round(herd.giltServiceAgeDays - 40);
      this.catchUpVaccinations(gilt, 0);
      this.pigs.push(gilt);
    }

    this.seedGrowingStock("weaner", Math.round(stock.weaners));
    this.seedGrowingStock("grower", Math.round(stock.growers));
    this.seedGrowingStock("finisher", Math.round(stock.finishers));
  }

  /** Places starting pigs evenly through their stage rather than all on its first day. */
  private seedGrowingStock(stage: Exclude<PigStage, "piglet" | "gilt">, count: number): void {
    if (count <= 0) return;
    const { growth, reproduction } = this.config;
    const startWeight =
      stage === "weaner"
        ? growth.weaningWeightKg
        : stage === "grower"
          ? growth.growerStartWeightKg
          : growth.finisherStartWeightKg;
    const endWeight =
      stage === "weaner"
        ? growth.growerStartWeightKg
        : stage === "grower"
          ? growth.finisherStartWeightKg
          : growth.saleWeightKg;
    const dailyGain =
      stage === "weaner"
        ? growth.weanerDailyGainKg
        : stage === "grower"
          ? growth.growerDailyGainKg
          : growth.finisherDailyGainKg;

    for (let i = 0; i < count; i += 1) {
      const progress = count === 1 ? 0 : i / count;
      const weightKg = startWeight + progress * (endWeight - startWeight);
      const daysInStage = (weightKg - startWeight) / dailyGain;
      const ageDays =
        reproduction.weaningAgeDays +
        (startWeight - growth.weaningWeightKg) / growth.weanerDailyGainKg +
        daysInStage;
      const tag = this.nextPigTag();
      const pig = new GrowingPig({
        id: tag,
        tag,
        sex: this.rng.chance(0.5) ? "female" : "male",
        birthDay: -Math.round(ageDays),
        weightKg,
        stage,
        ...this.growthDraw(),
      });
      pig.weanedOnDay = -Math.round(daysInStage);
      this.catchUpVaccinations(pig, 0);
      this.pigs.push(pig);
    }
  }

  // -------------------------------------------------------------- daily update

  private log(day: number, date: string, type: FarmEventType, message: string): void {
    this.events.push({ day, date, type, message });
    if (this.events.length > MAX_EVENTS) this.events.shift();
  }

  private step(day: number): void {
    const date = format(this.dateOf(day), "yyyy-MM-dd");
    const { config, ledger } = this;
    const record: DayRecord = {
      day,
      date,
      farrowings: 0,
      bornAlive: 0,
      weaned: 0,
      sold: 0,
      soldLiveweightKg: 0,
      soldDeadweightKg: 0,
      giltsSelected: 0,
      giltsPromoted: 0,
      giltsSold: 0,
      conceptions: 0,
      returnsToHeat: 0,
      movedToGrower: 0,
      movedToFinisher: 0,
      pigletDeaths: 0,
      growingDeaths: 0,
      breedingDeaths: 0,
      sowsCulled: 0,
      giltsPurchased: 0,
      boarsRotated: 0,
      services: 0,
      workers: 0,
      vaccinations: emptyVaccinations(),
      sowFeedKg: 0,
      growingFeedKg: 0,
      feedByRation: emptyRations(),
      feedDeliveries: [],
      feedLoads: 0,
      feedDeliveredKg: 0,
      marketTrips: 0,
      counts: emptyCounts(),
      totals: emptyTotals(),
      netCashFlow: 0,
      closingCash: 0,
    };

    if (day % 7 === 0) {
      for (const boar of this.boars) boar.servicesThisWeek = 0;
    }

    if (day === 0) ledger.accrue("capital", config.finance.initialCapitalCosts);

    // Taken before the monthly block moves the counter on, so the financing for
    // this month can be posted later in the day, after the contingency is struck.
    const chargedMonth = day === this.nextMonthlyChargeDay ? this.monthsCharged : null;

    if (day === this.nextMonthlyChargeDay) {
      // Labour is not a fixed overhead: a bigger herd is more people. The payroll
      // is re-read once a month, from the herd averaged over the month just gone
      // — a farm does not hire and fire on a single day's head count.
      this.workersOnPayroll = this.payrollFor(this.averageRecentHead());
      ledger.accrue(
        "labour",
        this.workersOnPayroll * config.finance.labourCostPerWorkerMonth,
      );
      ledger.accrue(
        "overheads",
        config.finance.utilitiesMonthly +
          config.finance.beddingMonthly +
          config.finance.biosecurityMonthly +
          config.finance.otherFixedMonthly,
      );
      ledger.accrue("other-income", config.finance.otherIncomeMonthly);
      // What the owner has added to this month by hand, posted alongside the
      // farm's own other income and fixed overheads rather than off to one side.
      for (const movement of config.finance.cashMovements) {
        if (movement.auto || movement.monthIndex !== this.monthsCharged) continue;
        if (movement.amount <= 0) continue;
        if (movement.kind === "in") {
          ledger.accrue("other-income", movement.amount);
          this.log(day, date, "funding", `Money in${noteOf(movement.note)}`);
        } else {
          ledger.accrue("overheads", movement.amount);
          this.log(day, date, "funding", `Money out${noteOf(movement.note)}`);
        }
      }
      for (const sow of this.sows) {
        sow.costs.add("health", "breeding", config.health.vetCostPerSowMonth);
        this.breedingCosts.add("health", "breeding", config.health.vetCostPerSowMonth);
        ledger.accrue("veterinary", config.health.vetCostPerSowMonth);
      }
      this.monthsCharged += 1;
      this.nextMonthlyChargeDay = this.dayOf(addMonths(this.start, this.monthsCharged));
    }

    this.runReproduction(day, date, record);
    this.runFeedDeliveries(day, record);
    this.runDailyCare(day, record);
    this.runSelection(day, date, record);
    this.runGrowthAndSales(day, date, record);
    this.runMortality(day, date, record);
    this.runCullingAndReplacement(day, date, record);

    ledger.accrue(
      "contingency",
      ledger.pendingOperatingCost() * (config.finance.contingencyPct / 100),
    );

    if (chargedMonth !== null) this.runFinancing(chargedMonth, day, date);

    this.pigs = this.pigs.filter((pig) => pig.alive);
    this.sows = this.sows.filter((sow) => sow.alive);
    this.boars = this.boars.filter((boar) => boar.alive);

    const closed = ledger.closeDay(day, date);
    record.totals = closed.totals;
    record.netCashFlow = closed.netCashFlow;
    record.closingCash = closed.closingCash;
    record.counts = this.countHerd();
    record.workers = this.workersOnPayroll;
    this.history.push(record);
    this.day = day;
  }

  private runReproduction(day: number, date: string, record: DayRecord): void {
    const { config } = this;

    for (const sow of this.sows) {
      if (!sow.alive) continue;

      // Three weeks on, a served sow either shows no heat and is in pig, or she
      // is back in heat and goes to the boar again.
      if (sow.confirmDay !== null && day >= sow.confirmDay) {
        sow.confirmDay = null;
        if (sow.state === "gestating") record.conceptions += 1;
        else record.returnsToHeat += 1;
      }

      if (sow.state === "gestating" && sow.dueDay !== null && day >= sow.dueDay) {
        const litterSize = this.rng.intAround(
          config.reproduction.bornAlivePerLitter,
          LITTER_SIZE_DEVIATION,
          1,
          25,
        );
        const piglets: GrowingPig[] = [];
        for (let i = 0; i < litterSize; i += 1) {
          const piglet = this.createPiglet(sow, day, BIRTH_WEIGHT_KG);
          piglets.push(piglet);
          this.pigs.push(piglet);
        }
        sow.farrow(day, piglets, config);
        record.farrowings += 1;
        record.bornAlive += litterSize;
        this.lifetime.litters += 1;
        this.lifetime.bornAlive += litterSize;
        this.log(
          day,
          date,
          "farrowing",
          sow.tag +
            " (gen " +
            sow.generation +
            ") farrowed " +
            litterSize +
            " live piglets, parity " +
            sow.parity,
        );
        continue;
      }

      if (sow.state === "lactating" && sow.weanDay !== null && day >= sow.weanDay) {
        const weaned = sow.wean(
          day,
          config,
          this.rng.normal(config.reproduction.weanToServiceDays, WEAN_TO_SERVICE_DEVIATION_DAYS),
        );
        record.weaned += weaned.length;
        this.lifetime.weaned += weaned.length;
        this.log(day, date, "weaning", sow.tag + " weaned " + weaned.length + " piglets");
      }
    }

    // Services are limited by the boars actually standing on the farm.
    const waiting = this.sows.filter((sow) => sow.dueForService(day));
    if (waiting.length === 0) return;
    if (this.boars.length === 0) {
      this.lifetime.servicesMissedForBoarCapacity += waiting.length;
      if (day % 30 === 0) {
        this.log(day, date, "capacity", waiting.length + " sows are waiting: no boar on the farm");
      }
      return;
    }

    let missed = 0;
    let missedForGenetics = 0;
    for (const sow of waiting) {
      const boar = this.pickBoar(sow);
      if (!boar) {
        if (this.everyBoarIsHerSire(sow)) missedForGenetics += 1;
        else missed += 1;
        continue;
      }
      boar.servicesThisWeek += 1;
      boar.totalServices += 1;
      this.lifetime.servicesAttempted += 1;
      record.services += 1;
      sow.serve(
        day,
        this.rng.chance(config.reproduction.farrowingSuccessPct / 100),
        this.rng.normal(config.reproduction.gestationDays, GESTATION_DEVIATION_DAYS),
        boar.tag,
      );
    }
    if (missed > 0) {
      this.lifetime.servicesMissedForBoarCapacity += missed;
      this.log(day, date, "capacity", missed + " services deferred: boar capacity reached");
    }
    if (missedForGenetics > 0) {
      this.lifetime.servicesMissedForGenetics += missedForGenetics;
      this.log(
        day,
        date,
        "capacity",
        missedForGenetics + " females held over: the only boar standing is their sire",
      );
    }
  }

  /**
   * The next boar in the rotation who is not this female's own sire. Working the
   * team in turn spreads the genetics through the herd; refusing her sire is
   * what stops an expanding closed herd from breeding daughters back to their
   * father as the second generation comes to service.
   */
  private pickBoar(sow: Sow): Boar | null {
    const team = this.boars.filter((boar) => boar.alive);
    if (team.length === 0) return null;
    for (let offset = 0; offset < team.length; offset += 1) {
      const boar = team[(this.boarCursor + offset) % team.length];
      if (boar.servicesThisWeek >= SERVICES_PER_BOAR_PER_WEEK) continue;
      if (sow.sireTag !== null && boar.tag === sow.sireTag) continue;
      this.boarCursor = (this.boarCursor + offset + 1) % team.length;
      return boar;
    }
    return null;
  }

  /** True when this female's only possible mate on the farm is her own sire. */
  private everyBoarIsHerSire(sow: Sow): boolean {
    if (sow.sireTag === null) return false;
    const team = this.boars.filter((boar) => boar.alive);
    return team.length > 0 && team.every((boar) => boar.tag === sow.sireTag);
  }

  /**
   * True when some breeding female on the farm — in the herd or growing towards
   * it — would have no mate but her own sire. That is the point at which a
   * closed herd has to stand a second, unrelated boar.
   */
  private needsUnrelatedBoar(): boolean {
    const team = this.boars.filter((boar) => boar.alive);
    if (team.length === 0) return false;
    const blocked = (sireTag: string | null) =>
      sireTag !== null && team.every((boar) => boar.tag === sireTag);
    for (const sow of this.sows) if (sow.alive && blocked(sow.sireTag)) return true;
    // Only gilts already on the developer ration count. Buying a boar the day a
    // weaner is picked out would stand him — and feed him — for half a year
    // before the first of those females is old enough to serve.
    for (const pig of this.pigs) {
      if (pig.alive && pig.stage === "gilt" && blocked(pig.sireTag)) return true;
    }
    return false;
  }

  /**
   * One pass over the herd for everything an animal needs today: its ration, the
   * creep feed and heat its age calls for, and any vaccination now due.
   */
  /**
   * Cash the funding buttons move in or out this month. It is posted after the
   * contingency has been struck, because topping the bank up — or taking a
   * surplus out — is not the farm running up a cost to be covered.
   */
  private runFinancing(monthIndex: number, day: number, date: string): void {
    for (const movement of this.config.finance.cashMovements) {
      if (!movement.auto || movement.monthIndex !== monthIndex) continue;
      if (movement.amount <= 0) continue;
      if (movement.kind === "in") {
        this.ledger.accrue("other-income", movement.amount);
        this.log(day, date, "funding", `Cash injection${noteOf(movement.note)}`);
      } else {
        this.ledger.accrue("overheads", movement.amount);
        this.financingCosts += movement.amount;
        this.log(day, date, "funding", `Cash withdrawal${noteOf(movement.note)}`);
      }
    }
  }

  /**
   * Takes the day's sold pigs to the abattoir, alive, on the day they are sold.
   * How many times the lorry goes is the head sold over what it holds, so a
   * cohort too big for one load is two runs and a small draw still costs a whole
   * trip. The bill lands on the pigs that were on the lorry, which is why it is
   * added to their costs rather than treated as an overhead of the farm.
   */
  private runMarketHaulage(day: number, date: string, record: DayRecord): void {
    const { config } = this;
    if (record.sold <= 0) return;

    const trips = Math.ceil(record.sold / config.finance.marketTruckCapacityPigs);
    const cost = trips * config.finance.marketTripCost;
    this.ledger.accrue("transport", cost);
    this.soldPigCosts.add("transport", "finisher", cost);
    record.marketTrips = trips;
    this.lifetime.marketTrips += trips;
    this.lifetime.marketHaulageCost += cost;
    this.log(
      day,
      date,
      "market",
      trips === 1
        ? "Lorry to the abattoir with " + record.sold + " pigs"
        : trips + " lorry runs to the abattoir with " + record.sold + " pigs",
    );
  }

  /** Takes in the loads the plan has standing for today and pays their haulage. */
  private runFeedDeliveries(day: number, record: DayRecord): void {
    const arrivals = this.deliveriesByDay.get(day);
    if (!arrivals) return;
    record.feedDeliveries = arrivals;
    for (const load of arrivals) {
      this.ledger.accrue("feed-haulage", load.haulageCost);
      record.feedLoads += 1;
      record.feedDeliveredKg += load.loadKg;
      this.lifetime.feedLoads += 1;
      this.lifetime.feedDeliveredKg += load.loadKg;
      this.lifetime.feedHaulageCost += load.haulageCost;
    }
  }

  private runDailyCare(day: number, record: DayRecord): void {
    const { config } = this;
    let sowFeedKg = 0;
    let growingFeedKg = 0;
    let feedCost = 0;
    let heatingCost = 0;
    let vaccinationCost = 0;

    // Haulage is paid when a load lands, and the plan knows which load every
    // kilogram eaten today came off. Charging it out with the feed is what puts
    // a share of the lorry on the animal that ate it.
    const haulageRate = this.feedPlan.haulagePerKgByDay[day] ?? 0;
    const haul = (ration: FeedRation, kg: number) => {
      record.feedByRation[ration] += kg;
      return kg * haulageRate;
    };

    for (const sow of this.sows) {
      const { kg, costPerKg, ration } = sow.dailyFeed(config);
      sowFeedKg += kg;
      const cost = kg * costPerKg;
      const haulage = haul(ration, kg);
      feedCost += cost;
      sow.costs.add("feed", "breeding", cost);
      sow.costs.add("transport", "breeding", haulage);
      this.breedingCosts.add("feed", "breeding", cost);
      this.breedingCosts.add("transport", "breeding", haulage);
    }
    for (const boar of this.boars) {
      const { kg, costPerKg, ration } = boar.dailyFeed(config);
      sowFeedKg += kg;
      const cost = kg * costPerKg;
      const haulage = haul(ration, kg);
      feedCost += cost;
      boar.costs.add("feed", "breeding", cost);
      boar.costs.add("transport", "breeding", haulage);
      this.breedingCosts.add("feed", "breeding", cost);
      this.breedingCosts.add("transport", "breeding", haulage);
    }

    for (const pig of this.pigs) {
      const stage = pig.costStage;
      // A pig picked out to breed is no longer a market pig: what she eats from
      // here on is the cost of replacing a sow, not of producing pork.
      const replacement = pig.destination === "breeding";
      const charge = (type: CostType, amount: number) => {
        pig.costs.add(type, stage, amount);
        if (replacement) this.breedingCosts.add(type, stage, amount);
      };

      const ration = pig.dailyFeed(config);
      if (ration.kg > 0) {
        const cost = ration.kg * ration.costPerKg;
        if (pig.stage === "gilt") sowFeedKg += ration.kg;
        else growingFeedKg += ration.kg;
        feedCost += cost;
        charge("feed", cost);
        charge("transport", haul(ration.ration, ration.kg));
      }

      const creep = pig.creepFeed(day, config);
      if (creep.kg > 0) {
        const cost = creep.kg * creep.costPerKg;
        growingFeedKg += creep.kg;
        feedCost += cost;
        charge("feed", cost);
        charge("transport", haul(creep.ration, creep.kg));
      }

      const ageDays = pig.ageDays(day);
      if (ageDays < config.health.heatedUntilAgeDays && config.health.heatingCostPerPigDay > 0) {
        heatingCost += config.health.heatingCostPerPigDay;
        charge("heating", config.health.heatingCostPerPigDay);
      }

      while (
        pig.vaccinationsGiven < this.vaccinations.length &&
        ageDays >= this.vaccinations[pig.vaccinationsGiven].ageDays
      ) {
        const dose = this.vaccinations[pig.vaccinationsGiven];
        vaccinationCost += dose.costPerPig;
        charge("health", dose.costPerPig);
        record.vaccinations[pig.stage] += 1;
        pig.vaccinationsGiven += 1;
      }
    }

    record.sowFeedKg = sowFeedKg;
    record.growingFeedKg = growingFeedKg;
    this.ledger.accrue("feed", feedCost);
    this.ledger.accrue("heating", heatingCost);
    this.ledger.accrue("vaccination", vaccinationCost);
  }

  /**
   * Head on the farm averaged over the month just gone, which is what the wage
   * bill is sized from. On the opening day there is no history to average, so
   * the stock standing there answers for itself.
   */
  private averageRecentHead(): number {
    const window = this.history.slice(-30);
    if (window.length === 0) return this.countHerd().total;
    return window.reduce((sum, day) => sum + day.counts.total, 0) / window.length;
  }

  /**
   * Stockpeople for a herd of this size. A post is taken on the month the work
   * appears, but only shed once the herd has fallen clearly below it, so the
   * wage bill does not flip back and forth with a batch-farrowing herd.
   */
  private payrollFor(averageHead: number): number {
    const needed = workersNeeded(averageHead, this.config);
    if (needed >= this.workersOnPayroll) return needed;
    const held = workersNeeded(averageHead * (1 + LABOUR_SHED_BAND), this.config);
    return Math.max(needed, Math.min(this.workersOnPayroll, held));
  }

  /** Breeding females on the farm now, plus every pig growing on to join them. */
  private breedingStrength(): { females: number; pipeline: number } {
    let pipeline = 0;
    for (const pig of this.pigs) {
      if (pig.alive && pig.destination === "breeding") pipeline += 1;
    }
    return { females: this.sows.filter((sow) => sow.alive).length, pipeline };
  }

  /**
   * Picks replacement gilts out of the female weaners as they reach selection
   * weight. The farm keeps filling the pipeline until the sow places plus a
   * small replacement buffer are covered.
   */
  private runSelection(day: number, date: string, record: DayRecord): void {
    const { config } = this;
    if (!config.herd.retainHomeBredGilts) return;

    const { females, pipeline } = this.breedingStrength();
    const places = config.herd.maxSows + this.pipelineBuffer - females - pipeline;
    if (places <= 0) return;

    // Each pig is looked over once, on the day it reaches selection weight.
    let allowance = places;

    for (const pig of this.pigs) {
      if (allowance <= 0) break;
      if (!pig.alive || pig.assessedForBreeding) continue;
      if (pig.stage === "piglet") continue;
      if (pig.weightKg < config.herd.giltSelectionWeightKg) continue;
      pig.assessedForBreeding = true;
      if (pig.sex !== "female" || pig.destination !== "market") continue;

      const litter = (pig.damTag ?? "founding") + ":" + pig.birthDay;
      const keptFromLitter = this.giltsKeptPerLitter.get(litter) ?? 0;
      if (keptFromLitter >= MAX_GILTS_PER_LITTER) continue;

      this.giltsKeptPerLitter.set(litter, keptFromLitter + 1);
      pig.destination = "breeding";
      allowance -= 1;
      record.giltsSelected += 1;
    }

    if (record.giltsSelected > 0) {
      this.lifetime.giltsSelected += record.giltsSelected;
      this.log(
        day,
        date,
        "selection",
        record.giltsSelected + " female pigs selected as replacement gilts",
      );
    }
  }

  private runGrowthAndSales(day: number, date: string, record: DayRecord): void {
    const { config } = this;
    let soldWeight = 0;
    let giltSaleValue = 0;
    let freeSowPlaces = config.herd.maxSows - this.sows.filter((sow) => sow.alive).length;

    for (const pig of this.pigs) {
      const was = pig.stage;
      pig.grow(config);
      if (pig.stage === was) continue;
      if (pig.stage === "grower") record.movedToGrower += 1;
      else if (pig.stage === "finisher") record.movedToFinisher += 1;
    }

    // Pigs are killed by cohort: litter mates born on one day go on one day,
    // when the cohort's average weight reaches the target. Some are drawn a
    // little light and some a little heavy, which is what a batch really does.
    const cohorts = new Map<number, GrowingPig[]>();
    for (const pig of this.pigs) {
      if (!pig.alive || !pig.readyForMarket()) continue;
      const members = cohorts.get(pig.cohort);
      if (members) members.push(pig);
      else cohorts.set(pig.cohort, [pig]);
    }

    for (const members of cohorts.values()) {
      const average =
        members.reduce((total, pig) => total + pig.weightKg, 0) / members.length;
      if (average < config.growth.saleWeightKg) continue;
      for (const pig of members) {
        pig.leave(day, "sold");
        this.noteExit(pig.generation, true);
        this.soldPigCosts.absorb(pig.costs);
        record.sold += 1;
        soldWeight += pig.weightKg;
      }
    }

    for (const pig of this.pigs) {
      if (!pig.alive) continue;
      if (!pig.readyToBreed(day, config)) continue;

      // A mature gilt either takes a sow place or is sold as breeding stock.
      if (freeSowPlaces > 0) {
        // She does not leave the farm, she changes role: the pig record closes
        // and the same animal carries on as a sow, keeping her tag, her lineage
        // and the cost of rearing her.
        this.sows.push(Sow.fromGilt(pig, day));
        pig.alive = false;
        pig.exitDay = day;
        freeSowPlaces -= 1;
        record.giltsPromoted += 1;
      } else {
        pig.leave(day, "sold-as-gilt");
        this.noteExit(pig.generation, true);
        giltSaleValue += config.herd.surplusGiltSaleValue;
        record.giltsSold += 1;
      }
    }

    if (record.giltsPromoted > 0) {
      this.lifetime.giltsPromoted += record.giltsPromoted;
      this.log(
        day,
        date,
        "promotion",
        record.giltsPromoted + " gilts joined the breeding herd",
      );
    }

    if (record.giltsSold > 0) {
      this.lifetime.giltsSold += record.giltsSold;
      this.ledger.accrue("gilt-sales", giltSaleValue);
      this.log(
        day,
        date,
        "sale",
        record.giltsSold + " surplus gilts sold as breeding stock: the herd is at capacity",
      );
    }

    if (record.sold === 0) return;
    // The abattoir pays for carcass, not for the pig that walked on. Liveweight
    // is dressed out before it meets the price.
    const soldDeadweight = deadweightKg(soldWeight, config);
    record.soldLiveweightKg = soldWeight;
    record.soldDeadweightKg = soldDeadweight;
    this.lifetime.sold += record.sold;
    this.lifetime.soldLiveweightKg += soldWeight;
    this.lifetime.soldDeadweightKg += soldDeadweight;
    this.ledger.accrue("pig-sales", soldDeadweight * config.finance.salePriceKg);
    this.runMarketHaulage(day, date, record);
    this.log(
      day,
      date,
      "sale",
      record.sold + " pigs sold at " + (soldWeight / record.sold).toFixed(1) + " kg average",
    );
  }

  /**
   * A pig that dies still ate. Its bill goes onto the pigs that did reach the
   * abattoir, because that is what producing them actually cost — a replacement
   * gilt's loss is already carried by the breeding herd instead.
   */
  private absorbLoss(pig: GrowingPig): void {
    if (pig.destination === "market") this.soldPigCosts.absorb(pig.costs);
  }

  private runMortality(day: number, date: string, record: DayRecord): void {
    for (const pig of this.pigs) {
      if (!pig.alive) continue;
      if (!this.rng.chance(this.hazard[pig.stage])) continue;
      pig.leave(day, "died");
      this.absorbLoss(pig);
      this.noteExit(pig.generation, false);
      if (pig.stage === "piglet") record.pigletDeaths += 1;
      else record.growingDeaths += 1;
    }
    this.lifetime.pigletDeaths += record.pigletDeaths;
    this.lifetime.growingDeaths += record.growingDeaths;
    const pigDeaths = record.pigletDeaths + record.growingDeaths;
    if (pigDeaths > 0) {
      this.log(
        day,
        date,
        "death",
        pigDeaths + " pigs lost (" + record.pigletDeaths + " pre-weaning)",
      );
    }

    for (const boar of this.boars) {
      if (!this.rng.chance(this.breedingHazard)) continue;
      boar.leave(day, "died");
      record.breedingDeaths += 1;
      this.log(day, date, "death", boar.tag + " died");
    }

    for (const sow of this.sows) {
      if (!this.rng.chance(this.breedingHazard)) continue;
      sow.leave(day, "died");
      this.noteExit(sow.generation, false);
      record.breedingDeaths += 1;
      this.log(day, date, "death", sow.tag + " died (parity " + sow.parity + ")");
      if (sow.litter.length === 0) continue;

      // Orphans go onto another nursing sow when one is available.
      const foster = this.sows.find(
        (candidate) => candidate.alive && candidate !== sow && candidate.state === "lactating",
      );
      const orphans = sow.litter.filter((piglet) => piglet.alive);
      if (foster) {
        for (const piglet of orphans) foster.litter.push(piglet);
        this.log(
          day,
          date,
          "weaning",
          orphans.length + " orphaned piglets fostered onto " + foster.tag,
        );
      } else {
        for (const piglet of orphans) {
          piglet.leave(day, "died");
          this.absorbLoss(piglet);
          this.noteExit(piglet.generation, false);
        }
        record.pigletDeaths += orphans.length;
        this.lifetime.pigletDeaths += orphans.length;
      }
      sow.litter = [];
    }
    this.lifetime.breedingDeaths += record.breedingDeaths;
  }

  private runCullingAndReplacement(day: number, date: string, record: DayRecord): void {
    const { config } = this;

    for (const sow of this.sows) {
      if (!sow.alive || !sow.readyToCull(config)) continue;
      sow.leave(day, "culled");
      this.noteExit(sow.generation, true);
      record.sowsCulled += 1;
      this.ledger.accrue("cull-sales", config.herd.cullSowSaleValue);
      this.log(day, date, "cull", sow.tag + " culled after parity " + sow.parity);
    }
    this.lifetime.sowsCulled += record.sowsCulled;

    // A boar is rotated off at the end of his working life. Standing one for
    // longer puts him over his own daughters, which is exactly what a closed
    // herd has to avoid as it expands.
    const workingLifeDays = Math.round(config.herd.boarWorkingLifeMonths * DAYS_PER_MONTH);
    for (const boar of this.boars) {
      if (!boar.alive || !boar.readyToRotate(day, workingLifeDays)) continue;
      boar.leave(day, "culled");
      record.boarsRotated += 1;
      this.ledger.accrue("cull-sales", config.herd.cullSowSaleValue);
      this.log(
        day,
        date,
        "cull",
        boar.tag +
          " rotated out after " +
          config.herd.boarWorkingLifeMonths +
          " months and " +
          boar.totalServices +
          " services",
      );
    }
    this.lifetime.boarsRotated += record.boarsRotated;

    // Boars cannot be bred out of the market pigs, so the team is always kept up
    // to the planned number — without one, the whole herd stops breeding.
    const boarsWanted = Math.round(config.stock.boars);
    const boarsAlive = this.boars.filter((boar) => boar.alive).length;
    for (let i = boarsAlive; i < boarsWanted; i += 1) {
      const tag = this.nextBoarTag();
      const boar = new Boar({
        id: tag,
        tag,
        birthDay: day - GILT_ENTRY_AGE_DAYS - 60,
        weightKg: BOAR_WEIGHT_KG,
        joinedDay: day,
      });
      boar.costs.add("purchase", "breeding", config.herd.boarPurchaseCost);
      this.breedingCosts.add("purchase", "breeding", config.herd.boarPurchaseCost);
      this.boars.push(boar);
      this.ledger.accrue("breeding-stock", config.herd.boarPurchaseCost);
      this.log(day, date, "purchase", "Replacement boar " + tag + " bought in");
    }

    // Once a boar's own daughters are coming to service, one boar is no longer a
    // breeding team: the farm stands a second, unrelated boar so those females
    // have a mate that is not their father.
    if (this.needsUnrelatedBoar()) {
      const tag = this.nextBoarTag();
      const boar = new Boar({
        id: tag,
        tag,
        birthDay: day - GILT_ENTRY_AGE_DAYS - 60,
        weightKg: BOAR_WEIGHT_KG,
        joinedDay: day,
      });
      boar.costs.add("purchase", "breeding", config.herd.boarPurchaseCost);
      this.breedingCosts.add("purchase", "breeding", config.herd.boarPurchaseCost);
      this.boars.push(boar);
      this.ledger.accrue("breeding-stock", config.herd.boarPurchaseCost);
      this.log(
        day,
        date,
        "purchase",
        "Unrelated boar " + tag + " bought in: home-bred females are coming to service",
      );
    }

    if (!config.herd.buyGiltsWhenShort) return;

    // Gilts are only bought when the home-bred pipeline cannot cover the places.
    const { females, pipeline } = this.breedingStrength();
    const shortfall = config.herd.maxSows - females - pipeline;
    if (shortfall <= 0) return;

    for (let i = 0; i < shortfall; i += 1) {
      const tag = this.nextSowTag();
      const gilt = new Sow({
        id: tag,
        tag,
        birthDay: day - GILT_ENTRY_AGE_DAYS,
        weightKg: config.herd.giltServiceWeightKg,
        state: "open",
        nextServiceDay: day + GILT_ACCLIMATISATION_DAYS,
      });
      gilt.costs.add("purchase", "breeding", config.herd.giltPurchaseCost);
      this.breedingCosts.add("purchase", "breeding", config.herd.giltPurchaseCost);
      this.sows.push(gilt);
      this.ledger.accrue("breeding-stock", config.herd.giltPurchaseCost);
    }
    record.giltsPurchased = shortfall;
    this.lifetime.giltsPurchased += shortfall;
    this.log(day, date, "purchase", shortfall + " replacement gilts bought in");
  }

  // ------------------------------------------------------------------ read-out

  private countHerd(): StageCounts {
    const counts = emptyCounts();
    for (const sow of this.sows) {
      if (!sow.alive) continue;
      counts.sows += 1;
      if (sow.state === "gestating") counts.gestatingSows += 1;
      else if (sow.state === "lactating") counts.lactatingSows += 1;
      else counts.openSows += 1;
    }
    counts.boars = this.boars.filter((boar) => boar.alive).length;
    for (const pig of this.pigs) {
      if (!pig.alive) continue;
      if (pig.stage === "piglet") counts.piglets += 1;
      else if (pig.stage === "weaner") counts.weaners += 1;
      else if (pig.stage === "grower") counts.growers += 1;
      else if (pig.stage === "finisher") counts.finishers += 1;
      else counts.gilts += 1;
      if (pig.destination === "breeding") counts.replacementPipeline += 1;
    }
    counts.growingTotal =
      counts.piglets + counts.weaners + counts.growers + counts.finishers + counts.gilts;
    counts.total = counts.growingTotal + counts.sows + counts.boars;
    return counts;
  }

  /** How the generations on the farm stack up, including the ones that overlap. */
  generationReport(): GenerationRow[] {
    const rows = new Map<number, GenerationRow>();
    const row = (generation: number) => {
      let existing = rows.get(generation);
      if (!existing) {
        existing = { generation, born: 0, alive: 0, breedingFemales: 0, sold: 0, died: 0 };
        rows.set(generation, existing);
      }
      return existing;
    };

    for (const [generation, stats] of this.generationStats) {
      const entry = row(generation);
      entry.born = stats.born;
      entry.sold = stats.sold;
      entry.died = stats.died;
    }
    for (const pig of this.pigs) {
      if (pig.alive) row(pig.generation).alive += 1;
    }
    for (const sow of this.sows) {
      if (!sow.alive) continue;
      const entry = row(sow.generation);
      entry.alive += 1;
      entry.breedingFemales += 1;
    }
    for (const boar of this.boars) {
      if (boar.alive) row(boar.generation).alive += 1;
    }

    return [...rows.values()].sort((a, b) => a.generation - b.generation);
  }

  /** What a market pig cost by stage, and what it earned. */
  costOfProduction(): CostOfProduction {
    const pigsSold = this.lifetime.sold;
    const directByStage = Object.fromEntries(
      COST_STAGES.map((stage) => [
        stage,
        pigsSold > 0 ? this.soldPigCosts.byStage[stage] / pigsSold : 0,
      ]),
    ) as Record<CostStage, number>;
    const directByType = Object.fromEntries(
      COST_TYPES.map((type) => [type, pigsSold > 0 ? this.soldPigCosts.byType[type] / pigsSold : 0]),
    ) as Record<CostType, number>;

    // Generated withdrawals ride in the overheads line for reporting, but taking
    // cash out of the business is not part of what a pig cost to produce.
    const overheads =
      this.ledger.totals.overheads -
      this.financingCosts +
      this.ledger.totals.labour +
      this.ledger.totals.contingency +
      this.ledger.totals.capital;
    // Running the breeding herd is a cost of producing a market pig, offset by
    // what that herd earns in its own right selling surplus gilts and cull sows.
    const breedingNetCost =
      this.breedingCosts.total -
      this.ledger.totals["gilt-sales"] -
      this.ledger.totals["cull-sales"];
    // soldPigCosts carries the pigs that died as well, so this is what a pig that
    // reached the abattoir cost, losses included.
    const directPerPig = pigsSold > 0 ? this.soldPigCosts.total / pigsSold : 0;
    const breedingCostPerPig = pigsSold > 0 ? breedingNetCost / pigsSold : 0;
    const allocatedOverheadPerPig = pigsSold > 0 ? overheads / pigsSold : 0;
    const fullCostPerPig = directPerPig + breedingCostPerPig + allocatedOverheadPerPig;
    const averageSaleWeightKg = pigsSold > 0 ? this.lifetime.soldLiveweightKg / pigsSold : 0;
    const averageDeadweightKg = pigsSold > 0 ? this.lifetime.soldDeadweightKg / pigsSold : 0;
    const revenuePerPig = averageDeadweightKg * this.config.finance.salePriceKg;

    return {
      pigsSold,
      averageSaleWeightKg,
      averageDeadweightKg,
      directByStage,
      directByType,
      directPerPig,
      breedingCostPerPig,
      allocatedOverheadPerPig,
      fullCostPerPig,
      revenuePerPig,
      marginPerPig: revenuePerPig - fullCostPerPig,
      fullCostPerKg: averageSaleWeightKg > 0 ? fullCostPerPig / averageSaleWeightKg : 0,
      fullCostPerDeadweightKg:
        averageDeadweightKg > 0 ? fullCostPerPig / averageDeadweightKg : 0,
    };
  }

  /** Everything knowable about the farm as it stands right now. */
  state(timestamp?: string): FarmState {
    const counts = this.countHerd();
    const date = format(this.dateOf(Math.max(this.day, 0)), "yyyy-MM-dd");
    const weightTotals: Record<PigStage, { sum: number; count: number }> = {
      piglet: { sum: 0, count: 0 },
      weaner: { sum: 0, count: 0 },
      grower: { sum: 0, count: 0 },
      finisher: { sum: 0, count: 0 },
      gilt: { sum: 0, count: 0 },
    };
    let liveweightKg = 0;
    for (const pig of this.pigs) {
      if (!pig.alive) continue;
      weightTotals[pig.stage].sum += pig.weightKg;
      weightTotals[pig.stage].count += 1;
      liveweightKg += pig.weightKg;
    }

    const herdValue =
      deadweightKg(liveweightKg, this.config) * this.config.finance.salePriceKg +
      (counts.sows + counts.boars) * this.config.herd.cullSowSaleValue;

    const last30Days = { income: 0, expenses: 0, net: 0 };
    for (const row of this.history.slice(-30)) {
      for (const [category, amount] of Object.entries(row.totals) as [
        keyof CategoryTotals,
        number,
      ][]) {
        if (
          category === "pig-sales" ||
          category === "gilt-sales" ||
          category === "cull-sales" ||
          category === "other-income"
        ) {
          last30Days.income += amount;
        } else {
          last30Days.expenses += amount;
        }
      }
    }
    last30Days.net = last30Days.income - last30Days.expenses;

    const average = (stage: PigStage) =>
      weightTotals[stage].count ? weightTotals[stage].sum / weightTotals[stage].count : 0;

    return {
      day: this.day,
      date,
      timestamp: timestamp ?? date + "T00:00",
      withinHorizon:
        this.day >= 0 && this.day < this.dayOf(addMonths(this.start, this.config.project.months)),
      herd: {
        ...counts,
        liveweightKg,
        maxSows: this.config.herd.maxSows,
        averageWeightKg: {
          piglet: average("piglet"),
          weaner: average("weaner"),
          grower: average("grower"),
          finisher: average("finisher"),
          gilt: average("gilt"),
        },
      },
      finance: {
        openingCash: this.ledger.openingCash,
        cash: this.ledger.cash,
        income: this.ledger.income,
        expenses: this.ledger.expenses,
        herdValue,
        netWorth: this.ledger.cash + herdValue,
        totals: { ...this.ledger.totals },
        last30Days,
      },
      lifetime: { ...this.lifetime },
      generations: this.generationReport(),
      costOfProduction: this.costOfProduction(),
      stock: this.stockRoster(),
      sows: this.sowRoster(),
      recentEvents: this.events.slice(-12).reverse(),
    };
  }

  /** Every live animal, sorted into a stable roster for point-in-time inspection. */
  stockRoster(): StockRow[] {
    const day = Math.max(this.day, 0);
    const rows: StockRow[] = [];

    for (const sow of this.sows) {
      if (!sow.alive) continue;
      rows.push({
        tag: sow.tag,
        kind: "sow",
        sex: sow.sex,
        ageDays: sow.ageDays(day),
        ageMonths: sow.ageMonths(day),
        weightKg: sow.weightKg,
        generation: sow.generation,
        status:
          sow.state === "gestating"
            ? "In pig"
            : sow.state === "lactating"
              ? "Suckling"
              : "Awaiting service",
      });
    }

    for (const boar of this.boars) {
      if (!boar.alive) continue;
      rows.push({
        tag: boar.tag,
        kind: "boar",
        sex: boar.sex,
        ageDays: boar.ageDays(day),
        ageMonths: boar.ageMonths(day),
        weightKg: boar.weightKg,
        generation: boar.generation,
        status: "Working boar",
      });
    }

    for (const pig of this.pigs) {
      if (!pig.alive) continue;
      rows.push({
        tag: pig.tag,
        kind: pig.stage,
        sex: pig.sex,
        ageDays: pig.ageDays(day),
        ageMonths: pig.ageMonths(day),
        weightKg: pig.weightKg,
        generation: pig.generation,
        status: pig.destination === "breeding" ? "Replacement" : "Market",
      });
    }

    return rows.sort(
      (a, b) =>
        STOCK_ORDER.indexOf(a.kind) - STOCK_ORDER.indexOf(b.kind) ||
        b.ageDays - a.ageDays ||
        a.tag.localeCompare(b.tag),
    );
  }

  private sowRoster(): SowRow[] {
    const day = Math.max(this.day, 0);
    return this.sows
      .filter((sow) => sow.alive)
      .map((sow) => {
        const target =
          sow.state === "gestating"
            ? sow.dueDay
            : sow.state === "lactating"
              ? sow.weanDay
              : sow.nextServiceDay;
        return {
          tag: sow.tag,
          state: sow.state,
          parity: sow.parity,
          ageMonths: sow.ageMonths(day),
          weightKg: sow.weightKg,
          generation: sow.generation,
          homeBred: sow.homeBred,
          litterSize: sow.litter.filter((piglet) => piglet.alive).length,
          totalWeaned: sow.totalWeaned,
          lifetimeCost: sow.costs.total,
          nextEvent:
            sow.state === "gestating" ? "Farrows" : sow.state === "lactating" ? "Weans" : "Served",
          daysToNextEvent: target === null ? null : Math.max(0, target - day),
        };
      })
      .sort((a, b) => (a.daysToNextEvent ?? 0) - (b.daysToNextEvent ?? 0));
  }
}
