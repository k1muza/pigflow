import { addDays, addMonths, differenceInCalendarDays, format, parseISO } from "date-fns";

import {
  BIRTH_WEIGHT_KG,
  BOAR_WEIGHT_KG,
  DAYS_PER_MONTH,
  GILT_ACCLIMATISATION_DAYS,
  GILT_ENTRY_AGE_DAYS,
  MATURE_SOW_WEIGHT_KG,
  SERVICES_PER_BOAR_PER_WEEK,
  ANCESTRY_EXCLUSION_DEPTH,
  expectedGiltServiceAgeDays,
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
  FEED_RATIONS,
} from "./animals";
import {
  emptyRations,
  emptyStoreSeries,
  EMPTY_HAULAGE,
  planHaulage,
  STORE_IDS,
  type HaulagePlan,
  type RationTally,
  type StoreId,
  type StoreSeries,
  type Trip,
} from "./haulage";
import { emptyTotals, Ledger, type CategoryTotals, type LedgerCategory } from "./ledger";
import { MortalityScheduler } from "./mortality";
import { sowRosterOf, stockRosterOf } from "./roster";
import { variationFor, type Variation } from "./variation";

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
  | "service"
  | "return"
  | "scan"
  | "processing"
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
  /** Of those returns, the ones that came back late rather than on the cycle. */
  irregularReturns: number;
  /** Sows scanned today, whatever the scan found. */
  scans: number;
  /** Piglets processed today, job by job. */
  processing: Record<string, number>;
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
  /** Of those services, the ones put to bought-in semen rather than to a boar. */
  aiServices: number;
  /** Stockpeople the herd needs at this size. */
  workers: number;
  vaccinations: Record<PigStage, number>;
  sowFeedKg: number;
  growingFeedKg: number;
  /** Gas burnt and bedding used today, which are stores like the feed bins. */
  gasKg: number;
  /** Heaters alight tonight, which is what the gas is actually burnt by. */
  gasHeaters: number;
  beddingKg: number;
  /** What the herd ate today, ration by ration. */
  feedByRation: RationTally;
  /** Lorries through the gate today, each with the order it carried. */
  deliveries: Trip[];
  lorriesIn: number;
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
  /** Services put to bought-in semen, and what the herd spent on them. */
  aiServices: number;
  aiCost: number;
  /** Returns to heat, split by whether she came back on the cycle or past it. */
  regularReturns: number;
  irregularReturns: number;
  /** Scans done, and what they found. */
  scans: number;
  pregnanciesConfirmed: number;
  scannedEmpty: number;
  /** Lorries through the gate since the plan started, and what they cost. */
  lorries: number;
  feedDeliveredKg: number;
  haulageCost: number;
  /** Runs to the abattoir since the plan started, and what they cost. */
  marketTrips: number;
  marketHaulageCost: number;
  servicesMissedForBoarCapacity: number;
  /** Services deferred because every mate standing was one of the female's own sires. */
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

/** One store, as the farm would find it if it looked: how much, and worth what. */
export type StoreLevel = {
  id: string;
  label: string;
  unit: string;
  quantity: number;
  /** What it cost to buy, which is what it is worth standing there. */
  value: number;
  /** What the store holds, when it is limited by something other than money. */
  capacity: number | null;
  /** Days the herd can go on this at the rate it is using it now. */
  daysOfCover: number | null;
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
    /** Livestock plus what is standing in the stores. */
    herdValue: number;
    /** Of that, the feed, gas and bedding bought and not yet used. */
    storeValue: number;
    netWorth: number;
    totals: CategoryTotals;
    last30Days: { income: number; expenses: number; net: number };
  };
  /** What is standing in each store at the close of the day being read. */
  stores: StoreLevel[];
  lifetime: LifetimeTotals;
  generations: GenerationRow[];
  costOfProduction: CostOfProduction;
  stock: StockRow[];
  sows: SowRow[];
  recentEvents: FarmEvent[];
};

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


/** The note on a cash movement, if the owner wrote one. */
function noteOf(note: string): string {
  return note.trim() ? `: ${note.trim()}` : "";
}

/** What each store is called on a delivery note. */
export const STORE_LABELS: Record<StoreId, string> = {
  sow: "sow & gilt feed",
  creep: "creep feed",
  weaner: "weaner feed",
  grower: "grower feed",
  finisher: "finisher feed",
  gas: "gas",
  bedding: "bedding",
};

/**
 * A lorry's delivery note: what came, and what was on it. A mixed run reads as
 * the order it was — so the event log shows one movement carrying four rations
 * and a bottle of gas, rather than five lorries that each brought one thing.
 */
export function tripNote(trip: Trip): string {
  const order = trip.lines
    .filter((line) => line.kg >= 0.5)
    .map((line) => STORE_LABELS[line.store] + " " + Math.round(line.kg) + " kg")
    .join(", ");
  const heading = trip.kind === "bedding" ? "Bedding lorry in" : "Lorry in";
  return heading + ", " + Math.round(trip.payloadKg) + " kg: " + order;
}

/** Plans kept against the config that produced them; a few is plenty. */
const PLAN_CACHE_SIZE = 8;
/** A farm that hauls nothing, used while the haulage itself is being worked out. */
export const EMPTY_PLANS: HaulagePlan = EMPTY_HAULAGE;

const planCache = new Map<string, HaulagePlan>();

/**
 * The lorry trips a plan needs. Working them out means knowing what the herd ate
 * on every day of the plan, which takes a run of the farm in its own right — so
 * the answer is kept against the plan that produced it. Without the cache, every
 * farm built from the same plan would pay for the same extra run.
 *
 * Anchoring the schedule to the end of the horizon is what keeps it stable: read
 * the farm on any date and the trips behind that date are the same trips.
 */
export function feedPlanFor(config: PlannerConfig): HaulagePlan {
  const key = JSON.stringify(config);
  const cached = planCache.get(key);
  if (cached) return cached;

  const start = parseISO(config.project.startDate);
  const horizon = differenceInCalendarDays(addMonths(start, config.project.months), start) - 1;
  const probe = new Farm(config, EMPTY_PLANS).advanceTo(horizon);

  // Every store's draw, day by day, on the same calendar — which is what lets
  // the lorry be loaded with all of them at once instead of one at a time.
  const use: StoreSeries = emptyStoreSeries();
  for (const store of STORE_IDS) use[store] = new Array<number>(probe.history.length).fill(0);
  for (const [day, record] of probe.history.entries()) {
    for (const ration of FEED_RATIONS) use[ration][day] = record.feedByRation[ration];
    use.gas[day] = record.gasKg;
    use.bedding[day] = record.beddingKg;
  }
  const plan = planHaulage(use, config);

  if (planCache.size >= PLAN_CACHE_SIZE) {
    const oldest = planCache.keys().next().value;
    if (oldest !== undefined) planCache.delete(oldest);
  }
  planCache.set(key, plan);
  return plan;
}

/**
 * The name a stud line goes under. It cannot collide with a boar tag, so a
 * female's sire line reads the same whether the sire was standing here or
 * arrived in a flask.
 */
/**
 * The cash line each ration is charged to. Every store is its own line, because
 * a herd that cannot see what its finisher feed costs against its sow feed
 * cannot act on either.
 */
const RATION_CATEGORY: Record<FeedRation, LedgerCategory> = {
  sow: "feed-sow",
  creep: "feed-creep",
  weaner: "feed-weaner",
  grower: "feed-grower",
  finisher: "feed-finisher",
};

/** Whether a job on the schedule is done to this pig at all. */
function appliesTo(job: Vaccination, pig: GrowingPig): boolean {
  if (job.appliesTo === "all") return true;
  return job.appliesTo === (pig.sex === "male" ? "males" : "females");
}

function studTag(index: number): string {
  return "AI-" + String(index + 1).padStart(2, "0");
}

/**
 * The sires standing behind a piglet of this dam: the boar or stud that got it,
 * then hers, cut off at the depth matings are barred to. Keeping only that much
 * is what bounds the line — nothing further back can block a mating, so nothing
 * further back is worth carrying on every animal in a five thousand sow herd.
 */
function sireLineFor(mother: Sow): string[] {
  const line = mother.lastSireTag === null ? [] : [mother.lastSireTag];
  return [...line, ...mother.sireLine].slice(0, ANCESTRY_EXCLUSION_DEPTH);
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
  /** How much of the log is kept. The whole of it, when it is to be read. */
  private readonly eventLimit: number;
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
    lorries: 0,
    feedDeliveredKg: 0,
    haulageCost: 0,
    marketTrips: 0,
    marketHaulageCost: 0,
    servicesAttempted: 0,
    aiServices: 0,
    aiCost: 0,
    regularReturns: 0,
    irregularReturns: 0,
    scans: 0,
    pregnanciesConfirmed: 0,
    scannedEmpty: 0,
    servicesMissedForBoarCapacity: 0,
    servicesMissedForGenetics: 0,
  };

  sows: Sow[] = [];
  boars: Boar[] = [];
  pigs: GrowingPig[] = [];

  /** Index of the last simulated day; -1 before the start date. */
  day = -1;

  /** The lorry trips this plan needs, worked out before the first day is run. */
  readonly haulage: HaulagePlan;
  private readonly deliveriesByDay = new Map<number, Trip[]>();
  /** Whether this plan rolls for its outcomes or takes its rates exactly. */
  private readonly variation: Variation;
  /** Books every loss in advance instead of rolling for one each morning. */
  private readonly mortality: MortalityScheduler;
  private readonly vaccinations: Vaccination[];
  /**
   * What is left of each pack opened, by job, and the day it was broached. A
   * vial is opened for one piglet and the rest of it goes to the next one
   * through the gate — until either it runs out or its days do.
   */
  private readonly packLeft = new Map<string, { left: number; openedOn: number }>();
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
  /** Where the AI stud panel stands in its own rotation. */
  private studCursor = 0;
  /** Stockpeople currently on the payroll; re-read once a month, not daily. */
  private workersOnPayroll = 0;
  private sowSequence = 0;
  private boarSequence = 0;
  private pigSequence = 0;

  /**
   * A feed plan may be handed in; without one the farm works its own out, which
   * takes a run of its own (see {@link feedPlanFor}).
   */
  constructor(input: PlannerConfig, plans?: HaulagePlan, options?: { keepEveryEvent?: boolean }) {
    this.eventLimit = options?.keepEveryEvent === true ? Infinity : MAX_EVENTS;
    this.config = plannerSchema.parse(input);
    this.start = parseISO(this.config.project.startDate);
    this.variation = variationFor(
      this.config.project.variation,
      this.config.project.seed,
      {
        litter: LITTER_SIZE_DEVIATION,
        gestation: GESTATION_DEVIATION_DAYS,
        weanToService: WEAN_TO_SERVICE_DEVIATION_DAYS,
      },
    );
    this.ledger = new Ledger(this.config.project.openingCash);
    this.haulage = plans ?? feedPlanFor(this.config);
    for (const trip of this.haulage.trips) {
      const sameDay = this.deliveriesByDay.get(trip.day);
      if (sameDay) sameDay.push(trip);
      else this.deliveriesByDay.set(trip.day, [trip]);
    }
    this.vaccinations = [...this.config.health.vaccinations].sort(
      (a, b) => a.ageDays - b.ageDays,
    );
    this.mortality = new MortalityScheduler(this.config);
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

  /**
   * What this dose costs beyond itself. A job bought by the dose costs nothing
   * extra; one that comes in a pack costs the whole pack the moment a pack has
   * to be opened, and the doses left in it are drawn on until they run out.
   */
  private packWaste(dose: Vaccination, day: number): number {
    if (dose.dosesPerPack <= 1) return 0;
    const open = this.packLeft.get(dose.id);
    // What limits a vaccine is the clock, not the shelf: a pack broached weeks
    // ago has doses left in it and none of them are any use.
    const stillGood =
      open !== undefined &&
      open.left >= 1 &&
      (dose.openPackKeepsDays <= 0 || day <= open.openedOn + dose.openPackKeepsDays);
    if (stillGood) {
      this.packLeft.set(dose.id, { left: open.left - 1, openedOn: open.openedOn });
      return 0;
    }
    // A fresh pack is opened: the rest of it is paid for now, used or not.
    this.packLeft.set(dose.id, { left: dose.dosesPerPack - 1, openedOn: day });
    return dose.costPerPig * (dose.dosesPerPack - 1);
  }

  /**
   * How many heaters burn tonight, and how many piglets are under them.
   *
   * A suckler is in its dam's crate, so a litter cannot share a lamp with the
   * litter next door: every litter lights at least one of its own, and a litter
   * bigger than a lamp covers lights a second. Once weaned they are penned in
   * groups, so the rest of the heated pigs share what their number needs.
   */
  private heatersAlight(day: number): { heaters: number; underHeat: number } {
    const { health } = this.config;
    if (health.heatedUntilAgeDays <= 0 || health.gasKgPerHeaterDay <= 0) {
      return { heaters: 0, underHeat: 0 };
    }
    const perLamp = Math.max(health.pigletsPerHeater, 1);

    /** Head in each farrowing crate that still has a litter in it. */
    const crates = new Map<string, number>();
    let inPens = 0;
    let underHeat = 0;
    for (const pig of this.pigs) {
      if (pig.ageDays(day) >= health.heatedUntilAgeDays) continue;
      underHeat += 1;
      if (pig.weanedOnDay === null) {
        const crate = (pig.damTag ?? "?") + "@" + pig.birthDay;
        crates.set(crate, (crates.get(crate) ?? 0) + 1);
      } else {
        inPens += 1;
      }
    }

    let heaters = Math.ceil(inPens / perLamp);
    for (const head of crates.values()) heaters += Math.ceil(head / perLamp);
    return { heaters, underHeat };
  }

  /**
   * Every store as it stands at the close of a day: what is in it, what that is
   * worth, and how long the herd can go on it. The cover is read off the last
   * week's use rather than the day's, because a day on which nothing was drawn
   * would otherwise read as an endless supply.
   */
  private storeLevels(day: number): StoreLevel[] {
    if (day < 0) return [];
    const { config } = this;
    const recentUse = (pick: (record: DayRecord) => number) => {
      const window = this.history.slice(-7);
      if (window.length === 0) return 0;
      return window.reduce((sum, record) => sum + pick(record), 0) / window.length;
    };
    const cover = (quantity: number, perDay: number) =>
      perDay > 1e-9 ? quantity / perDay : null;

    const price: Record<FeedRation, number> = {
      sow: config.feed.sowFeedCostKg,
      creep: config.feed.creepFeedCostKg,
      weaner: config.feed.weanerFeedCostKg,
      grower: config.feed.growerFeedCostKg,
      finisher: config.feed.finisherFeedCostKg,
    };
    const rationLabel: Record<FeedRation, string> = {
      sow: "Sow & gilt feed",
      creep: "Creep feed",
      weaner: "Weaner feed",
      grower: "Grower feed",
      finisher: "Finisher feed",
    };

    const levels: StoreLevel[] = FEED_RATIONS.map((ration) => {
      const quantity = this.haulage.stockByDay[ration]?.[day] ?? 0;
      return {
        id: "feed-" + ration,
        label: rationLabel[ration],
        unit: "kg",
        quantity,
        value: quantity * price[ration],
        // A bin has a size, and it is what decides how much of a lorry with room
        // to spare can be tipped into it on the way past.
        capacity: config.feed.binCapacityKg,
        daysOfCover: cover(quantity, recentUse((record) => record.feedByRation[ration])),
      };
    });

    const gasHeld = this.haulage.stockByDay.gas?.[day] ?? 0;
    levels.push({
      id: "gas",
      label: "Heating gas",
      unit: "kg",
      quantity: gasHeld,
      value: gasHeld * config.health.gasCostPerKg,
      capacity: config.health.gasCanisterKg * config.health.gasCanisters,
      daysOfCover: cover(gasHeld, recentUse((record) => record.gasKg)),
    });

    const beddingHeld = this.haulage.stockByDay.bedding?.[day] ?? 0;
    levels.push({
      id: "bedding",
      label: "Bedding",
      unit: "kg",
      quantity: beddingHeld,
      value: beddingHeld * config.housing.beddingCostPerKg,
      capacity: config.housing.beddingStoreKg,
      daysOfCover: cover(beddingHeld, recentUse((record) => record.beddingKg)),
    });

    return levels;
  }

  /**
   * What the stores hold at the close of a day, priced at what it cost to buy.
   * Feed in a bin is worth what was paid for it, not what it might be sold for:
   * a farm does not trade its own feed.
   */
  private storeValue(day: number): number {
    if (day < 0) return 0;
    const { config } = this;
    const price: Record<FeedRation, number> = {
      sow: config.feed.sowFeedCostKg,
      creep: config.feed.creepFeedCostKg,
      weaner: config.feed.weanerFeedCostKg,
      grower: config.feed.growerFeedCostKg,
      finisher: config.feed.finisherFeedCostKg,
    };
    let value = 0;
    for (const ration of FEED_RATIONS) {
      value += (this.haulage.stockByDay[ration]?.[day] ?? 0) * price[ration];
    }
    value += (this.haulage.stockByDay.gas?.[day] ?? 0) * config.health.gasCostPerKg;
    value +=
      (this.haulage.stockByDay.bedding?.[day] ?? 0) * config.housing.beddingCostPerKg;
    return value;
  }

  /** Marks a pig as already through the vaccinations its age has passed. */
  private catchUpVaccinations(pig: GrowingPig, day: number): void {
    const age = pig.ageDays(day);
    let given = 0;
    while (given < this.vaccinations.length && age >= this.vaccinations[given].ageDays) given += 1;
    pig.vaccinationsGiven = given;
  }

  /**
   * Every pig is drawn its own thriftiness and its own first-heat timing, keyed
   * to its tag. They are traits rather than events, so the tag alone is the key:
   * this pig is this hardy in every plan that ever contains her.
   */
  private growthDraw(tag: string): { growthFactor: number; estrusOffsetDays: number } {
    return {
      growthFactor: this.variation.growthFactor(GROWTH_FACTOR_DEVIATION, [tag]),
      estrusOffsetDays: this.variation.estrusOffsetDays(GILT_HEAT_WINDOW_DAYS, [tag]),
    };
  }

  private createPiglet(mother: Sow, birthDay: number, weightKg: number): GrowingPig {
    const tag = this.nextPigTag();
    const piglet = new GrowingPig({
      id: tag,
      tag,
      sex: this.variation.sex([tag]),
      birthDay,
      weightKg,
      stage: "piglet",
      generation: mother.generation + 1,
      damTag: mother.tag,
      sireLine: sireLineFor(mother),
      ...this.growthDraw(tag),
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
        const litterSize = this.variation.litterSize(reproduction.bornAlivePerLitter, [
          sow.tag,
          "opening",
        ]);
        const gain = (growth.weaningWeightKg - BIRTH_WEIGHT_KG) / reproduction.weaningAgeDays;
        for (let p = 0; p < litterSize; p += 1) {
          const piglet = this.createPiglet(sow, -pigletAge, BIRTH_WEIGHT_KG + gain * pigletAge);
          this.catchUpVaccinations(piglet, 0);
          sow.litter.push(piglet);
          this.pigs.push(piglet);
        }
        // Booked for only the part of the suckling stage still ahead of them.
        this.mortality.enterStage(sow.litter, "piglet", 0);
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

    // Starting gilts are maiden females already close to service weight, and
    // already cycling — a farm does not buy in gilts that have never stood.
    const startingGilts: GrowingPig[] = [];
    const serviceAge = expectedGiltServiceAgeDays(this.config);
    for (let i = 0; i < Math.round(stock.gilts); i += 1) {
      const tag = this.nextPigTag();
      const weightKg = Math.max(
        growth.saleWeightKg,
        herd.giltServiceWeightKg - 4 - (i % 6) * 4,
      );
      const ageOnDayZero = Math.round(serviceAge - 10 - (i % 6) * 8);
      const gilt = new GrowingPig({
        id: tag,
        tag,
        sex: "female",
        birthDay: -ageOnDayZero,
        weightKg,
        stage: "gilt",
        ...this.growthDraw(tag),
      });
      gilt.destination = "breeding";
      gilt.weanedOnDay = -Math.round(serviceAge - 40);
      // The heats she has already had, so she comes to service on her own cycle
      // rather than starting one the day the plan opens.
      const sincePuberty = ageOnDayZero - herd.giltPubertyAgeDays - gilt.estrusOffsetDays;
      if (sincePuberty >= 0) gilt.firstHeatDay = -sincePuberty;
      this.catchUpVaccinations(gilt, 0);
      this.pigs.push(gilt);
      startingGilts.push(gilt);
    }
    this.mortality.enterStage(startingGilts, "gilt", 0);

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

    const placed: GrowingPig[] = [];
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
        sex: this.variation.sex([tag]),
        birthDay: -Math.round(ageDays),
        weightKg,
        stage,
        ...this.growthDraw(tag),
      });
      pig.weanedOnDay = -Math.round(daysInStage);
      this.catchUpVaccinations(pig, 0);
      this.pigs.push(pig);
      placed.push(pig);
    }
    this.mortality.enterStage(placed, stage, 0);
  }

  // -------------------------------------------------------------- daily update

  private log(day: number, date: string, type: FarmEventType, message: string): void {
    this.events.push({ day, date, type, message });
    if (this.events.length > this.eventLimit) this.events.shift();
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
      irregularReturns: 0,
      scans: 0,
      processing: {},
      movedToGrower: 0,
      movedToFinisher: 0,
      pigletDeaths: 0,
      growingDeaths: 0,
      breedingDeaths: 0,
      sowsCulled: 0,
      giltsPurchased: 0,
      boarsRotated: 0,
      services: 0,
      aiServices: 0,
      workers: 0,
      vaccinations: emptyVaccinations(),
      sowFeedKg: 0,
      growingFeedKg: 0,
      gasKg: 0,
      gasHeaters: 0,
      beddingKg: 0,
      feedByRation: emptyRations(),
      deliveries: [],
      lorriesIn: 0,
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
    this.runDeliveries(day, date, record);
    this.runDailyCare(day, date, record);
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

      // She comes back in heat on the day the service she did not hold brings
      // her back — the next cycle, or a week or two past it if she lost it after
      // it had started. That is the day the farm sees, and the day it records.
      if (sow.returnDay !== null && day >= sow.returnDay) {
        sow.returnDay = null;
        record.returnsToHeat += 1;
        if (sow.lastReturnIrregular) {
          record.irregularReturns += 1;
          this.lifetime.irregularReturns += 1;
        } else {
          this.lifetime.regularReturns += 1;
        }
        this.log(
          day,
          date,
          "return",
          sow.tag +
            " returned to heat " +
            (sow.lastReturnIrregular ? "irregularly" : "regularly") +
            ", " +
            (sow.lastSireTag === null ? "unserved" : "served by " + sow.lastSireTag),
        );
      }

      // The scan, which is the only thing on the farm that can tell an empty sow
      // from one in pig before she either farrows or comes back.
      if (sow.scanDay !== null && day >= sow.scanDay) {
        sow.scanDay = null;
        const inPig = sow.state === "gestating";
        record.scans += 1;
        this.lifetime.scans += 1;
        if (inPig) {
          record.conceptions += 1;
          this.lifetime.pregnanciesConfirmed += 1;
        } else {
          this.lifetime.scannedEmpty += 1;
        }
        if (config.reproduction.pregnancyScanCost > 0) {
          this.ledger.accrue("veterinary", config.reproduction.pregnancyScanCost);
          this.breedingCosts.add("health", "breeding", config.reproduction.pregnancyScanCost);
          sow.costs.add("health", "breeding", config.reproduction.pregnancyScanCost);
        }
        this.log(
          day,
          date,
          "scan",
          sow.tag +
            (inPig
              ? " scanned in pig, due day " + (sow.dueDay ?? 0)
              : " scanned not in pig, back to service"),
        );
      }

      if (sow.state === "gestating" && sow.dueDay !== null && day >= sow.dueDay) {
        const litterSize = this.variation.litterSize(config.reproduction.bornAlivePerLitter, [
          sow.tag,
          day,
        ]);
        const piglets: GrowingPig[] = [];
        for (let i = 0; i < litterSize; i += 1) {
          const piglet = this.createPiglet(sow, day, BIRTH_WEIGHT_KG);
          piglets.push(piglet);
          this.pigs.push(piglet);
        }
        sow.farrow(day, piglets, config);
        this.mortality.enterStage(piglets, "piglet", day);
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
          this.variation.weanToServiceDays(config.reproduction.weanToServiceDays, [
            sow.tag,
            day,
          ]),
        );
        // They are through the suckling stage, so anything it still had booked
        // against them goes back on its slate. A heavy piglet can wean straight
        // past the weaner house, so they are re-booked by the stage they land in.
        for (const piglet of weaned) this.mortality.release(piglet);
        this.bookByStage(weaned, day);
        record.weaned += weaned.length;
        this.lifetime.weaned += weaned.length;
        this.log(day, date, "weaning", sow.tag + " weaned " + weaned.length + " piglets");
      }
    }

    // Services are limited by the mates the farm can actually put to a sow:
    // the boars standing, plus bought-in semen if the plan buys any.
    const waiting = this.sows.filter((sow) => sow.dueForService(day));
    if (waiting.length === 0) return;
    if (this.boars.length === 0 && !config.service.useAi) {
      this.lifetime.servicesMissedForBoarCapacity += waiting.length;
      if (day % 30 === 0) {
        this.log(day, date, "capacity", waiting.length + " sows are waiting: no boar on the farm");
      }
      return;
    }

    let missed = 0;
    let missedForGenetics = 0;
    for (const sow of waiting) {
      const sire = this.pickSire(sow, day);
      if (!sire) {
        if (this.everyMateIsHerAncestor(sow)) missedForGenetics += 1;
        else missed += 1;
        continue;
      }
      if (sire.boar) {
        sire.boar.servicesThisWeek += 1;
        sire.boar.totalServices += 1;
      } else {
        record.aiServices += 1;
        this.lifetime.aiServices += 1;
        this.lifetime.aiCost += config.service.aiCostPerService;
        this.ledger.accrue("semen", config.service.aiCostPerService);
        this.breedingCosts.add("health", "breeding", config.service.aiCostPerService);
        sow.costs.add("health", "breeding", config.service.aiCostPerService);
      }
      this.lifetime.servicesAttempted += 1;
      record.services += 1;

      // Every figure this service needs is keyed to the sow and the day she was
      // served, so it is hers whatever else the farm did that morning.
      const served = [sow.tag, day];
      const held = this.variation.conceives(
        this.conceptionRate(sire.boar === null) / 100,
        served,
      );
      // Taken whether or not it is needed. A drawn plan no longer cares — a key
      // is not a place in a queue — but a settled one does: its shares come out
      // exactly only if every service asks.
      const irregular = this.variation.returnsIrregular(
        config.reproduction.irregularReturnSharePct,
        served,
      );
      sow.serve(
        day,
        held,
        this.variation.gestationDays(config.reproduction.gestationDays, served),
        sire.tag,
        {
          returnDays: this.variation.returnDays(irregular, served),
          irregular,
          scanDays: config.reproduction.pregnancyScanDays,
        },
      );
      this.log(day, date, "service", this.serviceLine(sow, sire));
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
   * The mate this female is put to today, or null when the farm has none to give
   * her. AI is only reached for when the plan buys semen, and then in two ways:
   * as policy, for the share of services the plan puts to it, and as the release
   * valve when the boar team is worked out or every boar standing is one of her
   * own sires. A closed herd that would otherwise have had to stand — and feed —
   * another boar can buy a dose instead.
   */
  private pickSire(sow: Sow, day: number): { tag: string; boar: Boar | null } | null {
    const { service } = this.config;
    if (!service.useAi) {
      const boar = this.pickBoar(sow);
      return boar ? { tag: boar.tag, boar } : null;
    }
    // The draw is taken on every service while a share is set, so that a settled
    // plan puts exactly that share of them to semen rather than drifting with
    // however often the boars happen to be free.
    if (this.variation.usesAi(service.aiSharePct, [sow.tag, day])) {
      const stud = this.pickStud(sow);
      if (stud) return { tag: stud, boar: null };
    }
    const boar = this.pickBoar(sow);
    if (boar) return { tag: boar.tag, boar };
    const stud = this.pickStud(sow);
    return stud ? { tag: stud, boar: null } : null;
  }

  /**
   * The next stud line in the panel that is not already behind this female. A
   * stud is barred for the same generations a boar is: semen arriving under the
   * same name as her sire is the same mating, however it got there.
   */
  private pickStud(sow: Sow): string | null {
    const panel = Math.max(1, Math.round(this.config.service.aiStudPanelSize));
    for (let offset = 0; offset < panel; offset += 1) {
      const tag = studTag((this.studCursor + offset) % panel);
      if (sow.relatedTo(tag)) continue;
      this.studCursor = (this.studCursor + offset + 1) % panel;
      return tag;
    }
    return null;
  }

  /**
   * One service, written the way a service card reads: who was served, by what,
   * and at which parity. A herd's breeding cycle starts here, so this is the
   * line the rest of a sow's record hangs off.
   */
  private serviceLine(sow: Sow, sire: { tag: string; boar: Boar | null }): string {
    const parity = "parity " + (sow.parity + 1);
    if (sire.boar) return sow.tag + " served by " + sire.tag + ", natural, " + parity;
    const { aiInseminationsPerService: doses, aiCostPerService } = this.config.service;
    return (
      sow.tag +
      " inseminated with " +
      sire.tag +
      ", AI " +
      doses +
      (doses === 1 ? " dose, " : " doses, ") +
      parity +
      ", " +
      aiCostPerService +
      " " +
      this.config.project.currency
    );
  }

  /** The rate a service holds at, which AI may be better or worse at than a boar. */
  private conceptionRate(byAi: boolean): number {
    const { reproduction, service } = this.config;
    if (!byAi) return reproduction.farrowingSuccessPct;
    const rate = reproduction.farrowingSuccessPct + service.aiConceptionDeltaPct;
    return Math.min(100, Math.max(0, rate));
  }

  /**
   * The next boar in the rotation who is not among this female's sires. Working the
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
      if (sow.relatedTo(boar.tag)) continue;
      this.boarCursor = (this.boarCursor + offset + 1) % team.length;
      return boar;
    }
    return null;
  }

  /** True when every mate the farm could offer this female is one of her sires. */
  private everyMateIsHerAncestor(sow: Sow): boolean {
    if (sow.sireLine.length === 0) return false;
    const team = this.boars.filter((boar) => boar.alive);
    if (team.length === 0 || !team.every((boar) => sow.relatedTo(boar.tag))) return false;
    // Semen only counts as a mate she cannot have if the whole panel stands
    // behind her too, which takes a panel narrower than the generations barred.
    if (!this.config.service.useAi) return true;
    return this.pickStud(sow) === null;
  }

  /**
   * True when some breeding female on the farm — in the herd or growing towards
   * it — would have no mate but her own sire. That is the point at which a
   * closed herd has to stand a second, unrelated boar.
   */
  private needsUnrelatedBoar(): boolean {
    // A farm that buys semen has a cheaper answer than another boar, and uses it.
    if (this.config.service.useAi) return false;
    const team = this.boars.filter((boar) => boar.alive);
    if (team.length === 0) return false;
    const blocked = (female: Sow | GrowingPig) =>
      female.sireLine.length > 0 && team.every((boar) => female.relatedTo(boar.tag));
    for (const sow of this.sows) if (sow.alive && blocked(sow)) return true;
    // Only gilts already on the developer ration count. Buying a boar the day a
    // weaner is picked out would stand him — and feed him — for half a year
    // before the first of those females is old enough to serve.
    for (const pig of this.pigs) {
      if (pig.alive && pig.stage === "gilt" && blocked(pig)) return true;
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

  /**
   * Takes in the lorries the plan has standing for today and pays for the
   * journeys. A trip is charged once, whatever it is carrying: a run that
   * brought four rations and a gas bottle is one movement and one bill.
   */
  private runDeliveries(day: number, date: string, record: DayRecord): void {
    const arrivals = this.deliveriesByDay.get(day);
    if (!arrivals) return;
    record.deliveries = arrivals;
    for (const trip of arrivals) {
      this.ledger.accrue("deliveries", trip.cost);
      record.lorriesIn += 1;
      this.lifetime.lorries += 1;
      this.lifetime.haulageCost += trip.cost;
      for (const line of trip.lines) {
        if (line.store === "gas" || line.store === "bedding") continue;
        record.feedDeliveredKg += line.kg;
        this.lifetime.feedDeliveredKg += line.kg;
      }
      this.log(day, date, "purchase", tripNote(trip));
    }
  }

  private runDailyCare(day: number, date: string, record: DayRecord): void {
    const { config } = this;
    let sowFeedKg = 0;
    let growingFeedKg = 0;
    const feedSpend = emptyRations();
    let gasKg = 0;
    let gasCost = 0;
    let vaccinationCost = 0;
    let processingCost = 0;

    // A lamp is alight or it is not, so the night's gas is settled before any
    // piglet is charged for it, and then split between the piglets under it. A
    // pen that is half empty warms at the same rate as a full one, which makes
    // it dearer a head — as it is on the farm.
    const { heaters, underHeat } = this.heatersAlight(day);
    record.gasHeaters = heaters;
    const gasPerPig =
      underHeat > 0 ? (heaters * config.health.gasKgPerHeaterDay) / underHeat : 0;

    // Haulage is paid when a lorry lands, and the plan knows which lorry every
    // kilogram eaten today came in on. Charging it out with the feed is what
    // puts a share of the journey on the animal that ate it. A trip's cost is
    // spread over its whole payload, so what a kilogram carries depends on how
    // full the lorry that brought it was as well as on the day.
    const haul = (ration: FeedRation, kg: number) => {
      record.feedByRation[ration] += kg;
      return kg * (this.haulage.haulagePerKgByDay[ration]?.[day] ?? 0);
    };

    for (const sow of this.sows) {
      const { kg, costPerKg, ration } = sow.dailyFeed(config);
      sowFeedKg += kg;
      const cost = kg * costPerKg;
      const haulage = haul(ration, kg);
      feedSpend[ration] += cost;
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
      feedSpend[ration] += cost;
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
        feedSpend[ration.ration] += cost;
        charge("feed", cost);
        charge("transport", haul(ration.ration, ration.kg));
      }

      const creep = pig.creepFeed(day, config);
      if (creep.kg > 0) {
        const cost = creep.kg * creep.costPerKg;
        growingFeedKg += creep.kg;
        feedSpend[creep.ration] += cost;
        charge("feed", cost);
        charge("transport", haul(creep.ration, creep.kg));
      }

      const ageDays = pig.ageDays(day);
      if (ageDays < config.health.heatedUntilAgeDays && gasPerPig > 0) {
        const kg = gasPerPig;
        const cost = kg * config.health.gasCostPerKg;
        gasKg += kg;
        gasCost += cost;
        charge("heating", cost);
        charge("transport", kg * (this.haulage.haulagePerKgByDay.gas?.[day] ?? 0));
      }

      while (
        pig.vaccinationsGiven < this.vaccinations.length &&
        ageDays >= this.vaccinations[pig.vaccinationsGiven].ageDays
      ) {
        const dose = this.vaccinations[pig.vaccinationsGiven];
        // The cursor moves past every job whether or not this pig is one it is
        // done to, so a gilt does not queue behind the castrations forever.
        pig.vaccinationsGiven += 1;
        if (!appliesTo(dose, pig)) continue;
        const cost = dose.costPerPig + this.packWaste(dose, day);
        if (dose.kind === "processing") {
          processingCost += cost;
          record.processing[dose.name] = (record.processing[dose.name] ?? 0) + 1;
        } else {
          vaccinationCost += cost;
        }
        charge("health", cost);
        record.vaccinations[pig.stage] += 1;
      }
    }

    // Bedding goes under every animal housed, so it is charged on the head
    // standing rather than on the calendar, and drawn from a store like the rest.
    const head = this.countHerd().total;
    const beddingKg = head * config.housing.beddingKgPerHeadDay;
    const beddingCost = beddingKg * config.housing.beddingCostPerKg;

    record.sowFeedKg = sowFeedKg;
    record.growingFeedKg = growingFeedKg;
    record.gasKg = gasKg;
    record.beddingKg = beddingKg;
    for (const ration of FEED_RATIONS) {
      this.ledger.accrue(RATION_CATEGORY[ration], feedSpend[ration]);
    }
    this.ledger.accrue("gas", gasCost);
    this.ledger.accrue("bedding", beddingCost);
    // The journeys that brought the gas and the bedding are paid for as they
    // land, in runDeliveries, the same way the feed is.
    this.ledger.accrue("vaccination", vaccinationCost);
    this.ledger.accrue("processing", processingCost);

    // Processing is a job done to a batch, so it is logged as one: a line per
    // job per day rather than a line per piglet, which would bury everything
    // else a day did under a litter's worth of iron injections.
    for (const [job, count] of Object.entries(record.processing)) {
      this.log(day, date, "processing", job + " done to " + count + (count === 1 ? " piglet" : " piglets"));
    }
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

    const movedOn: GrowingPig[] = [];
    for (const pig of this.pigs) {
      const was = pig.stage;
      pig.grow(config);
      if (pig.stage === was) continue;
      if (pig.stage === "grower") record.movedToGrower += 1;
      else if (pig.stage === "finisher") record.movedToFinisher += 1;
      // It left the old stage on its feet, so that stage takes its loss back.
      this.mortality.release(pig);
      movedOn.push(pig);
    }
    this.bookByStage(movedOn, day);

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
        this.mortality.release(pig);
        pig.leave(day, "sold");
        this.noteExit(pig.generation, true);
        this.soldPigCosts.absorb(pig.costs);
        record.sold += 1;
        soldWeight += pig.weightKg;
      }
    }

    for (const pig of this.pigs) {
      if (!pig.alive) continue;
      pig.noteFirstHeat(day, config);
      if (!pig.readyToBreed(day, config)) continue;

      // A mature gilt either takes a sow place or is sold as breeding stock.
      if (freeSowPlaces > 0) {
        // She does not leave the farm, she changes role: the pig record closes
        // and the same animal carries on as a sow, keeping her tag, her lineage
        // and the cost of rearing her.
        this.mortality.release(pig);
        this.sows.push(Sow.fromGilt(pig, day));
        pig.alive = false;
        pig.exitDay = day;
        freeSowPlaces -= 1;
        record.giltsPromoted += 1;
      } else {
        this.mortality.release(pig);
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
  /**
   * Books a set of pigs into whichever stage each has just landed in. They are
   * grouped first because a stage is charged on the whole lot arriving at once:
   * that is what lets the fraction of a death a small cohort owes be carried on
   * to the next cohort rather than rounded away.
   */
  private bookByStage(pigs: readonly GrowingPig[], day: number): void {
    if (pigs.length === 0) return;
    const byStage = new Map<PigStage, GrowingPig[]>();
    for (const pig of pigs) {
      if (!pig.alive) continue;
      const group = byStage.get(pig.stage);
      if (group) group.push(pig);
      else byStage.set(pig.stage, [pig]);
    }
    for (const [stage, group] of byStage) this.mortality.enterStage(group, stage, day);
  }

  private absorbLoss(pig: GrowingPig): void {
    if (pig.destination === "market") this.soldPigCosts.absorb(pig.costs);
  }

  private runMortality(day: number, date: string, record: DayRecord): void {
    for (const pig of this.pigs) {
      if (!pig.alive) continue;
      if (!this.mortality.isDue(pig, day)) continue;
      this.mortality.settle(pig);
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

    // Sows and boars carry one risk between them, so they go to the scheduler
    // together. It knows how long each of them has stood, which is what settles
    // who goes rather than simply who is frailest on paper.
    const breeders: (Sow | Boar)[] = [
      ...this.sows.filter((sow) => sow.alive),
      ...this.boars.filter((boar) => boar.alive),
    ];
    const doomed = new Set<Sow | Boar>(this.mortality.claimBreedingDeaths(breeders));

    for (const boar of this.boars) {
      if (!doomed.has(boar)) continue;
      boar.leave(day, "died");
      record.breedingDeaths += 1;
      this.log(day, date, "death", boar.tag + " died");
    }

    for (const sow of this.sows) {
      if (!doomed.has(sow)) continue;
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

    // What is standing in the stores on this day. A farm that has just taken a
    // lorry has not lost the money: it has turned it into feed it has not eaten
    // yet, and a plan that counts only the cash understates what it is worth.
    const storeValue = this.storeValue(this.day);

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
        herdValue: herdValue + storeValue,
        storeValue,
        netWorth: this.ledger.cash + herdValue + storeValue,
        totals: { ...this.ledger.totals },
        last30Days,
      },
      stores: this.storeLevels(this.day),
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
    return stockRosterOf(this.sows, this.boars, this.pigs, this.day);
  }

  private sowRoster(): SowRow[] {
    return sowRosterOf(this.sows, this.day);
  }
}
