import { addDays, differenceInCalendarDays, format, parseISO } from "date-fns";

import type { PlannerConfig } from "../config";
import {
  Boar,
  CostRecord,
  GrowingPig,
  Sow,
  type PigStage,
  type AnimalDeparture,
} from "../sim/animals";
import { Books, emptyAccountingDay, type AccountingDay } from "../sim/accounting";
import type { RationTally, Trip, HaulagePlan } from "../sim/haulage";
import { emptyRations } from "../sim/haulage";
import { emptyTotals, Ledger, type CategoryTotals } from "../sim/ledger";
import { MortalityScheduler } from "../sim/mortality";
import type { Variation } from "../sim/variation";
import { EventLog, type DomainEvent, type EventType, type Posting } from "./events";
import { Housing, ROOM_IDS, type RoomId, type RoomLevel } from "./housing";
import { Batches } from "./batches";
import type { ExpectedFarmState, ExpectedGrowingGroup } from "./planning/forecast";
import { observeFarm } from "./planning/observe";
import {
  policyFor,
  type ProcurementDecision,
  type ProcurementPlanningContext,
  type ProcurementPolicy,
} from "./planning/procurement";
import { Supplies } from "./procurement";

/**
 * Cohort key made only from facts already present in the planner snapshot.
 *
 * `growthFactor` itself is an animal's fixed realised thriftiness. The forecaster
 * must not draw a future value, but once pigs are standing on the farm their
 * recent performance is no longer hypothetical. We aggregate it onto the same
 * coarse cohort dimensions the forecast already sees, rather than cloning every
 * animal into the planning model.
 */
function growthCohortKey(
  group: Pick<ExpectedGrowingGroup, "stage" | "destination" | "sex" | "ageDays">,
): string {
  return [group.stage, group.destination, group.sex, group.ageDays].join("|");
}

function withObservedGrowthFactors(
  day: number,
  farm: ExpectedFarmState,
  pigs: readonly GrowingPig[],
): ExpectedFarmState {
  const observed = new Map<string, { sum: number; head: number }>();

  for (const pig of pigs) {
    if (!pig.alive) continue;
    const key = growthCohortKey({
      stage: pig.stage,
      destination: pig.destination,
      sex: pig.sex,
      ageDays: pig.ageDays(day),
    });
    const row = observed.get(key) ?? { sum: 0, head: 0 };
    row.sum += pig.growthFactor;
    row.head += 1;
    observed.set(key, row);
  }

  return {
    ...farm,
    growing: farm.growing.map((group) => {
      const row = observed.get(growthCohortKey(group));
      return {
        ...group,
        growthFactor: row && row.head > 0 ? row.sum / row.head : 1,
      };
    }),
  };
}

/**
 * The mutable state of one simulated farm, and nothing else.
 *
 * The 1.x engine keeps all of this inside a single class whose one method runs
 * a day from end to end. That works and it is hard to extend: every new rule has
 * to be threaded into a procedure that is already doing nine things, and nothing
 * can be tested or reasoned about on its own.
 *
 * Here the state is a plain record and the rules are systems that operate on it.
 * A system takes the world and a day, changes the world, and emits the events
 * that say what it did. Adding a subsystem means adding a system and putting it
 * in the order; it does not mean editing the middle of a nine-hundred-line
 * method that six other subsystems also live in.
 */

/** The kinds of policy a planner actually sets, kept apart from the rules. */
export type Policies = {
  /** Places are a constraint rather than a note on a dashboard. */
  enforceHousing: boolean;
  /** A standing heat is an opportunity that closes, not a date that has passed. */
  enforceEstrusWindows: boolean;
  /** Feed is bought from what is in the bin today rather than with foresight. */
  operationalProcurement: boolean;
  /** Purchasing, inventory, cost and cash are four events rather than one. */
  accrualAccounting: boolean;
  /** A pig grows towards a size it finishes at rather than in a straight line. */
  matureGrowthCurve: boolean;
  /** Post-scan losses, complete litter outcomes and non-fatal treatment episodes. */
  realisticHealthAndReproduction: boolean;
};

/**
 * Which of the 2.0 subsystems this run has switched on. With all of them off the
 * engine is meant to reproduce the 1.x farm exactly, which is what makes the
 * parity harness worth running: every difference a switch makes is then that
 * switch's difference and not a porting accident.
 */
export function policiesFor(config: PlannerConfig): Policies {
  return {
    // Capacity enforcement is paused in production. The subsystem remains
    // available through EngineOptions policy overrides for development and
    // modelling tests, but ordinary V2 runs only report occupancy.
    enforceHousing: false,
    enforceEstrusWindows: config.reproduction.enforceEstrusWindows,
    operationalProcurement: config.feed.procurementMode === "operational",
    accrualAccounting: config.finance.accrualAccounting,
    matureGrowthCurve: config.growth.matureWeightKg > 0,
    // Perfect-foresight mode is the legacy parity/oracle run. Operational 2.0
    // is the actual farm model and carries the richer biological outcomes.
    realisticHealthAndReproduction: config.feed.procurementMode === "operational",
  };
}

/** Every switch off: the 1.x farm, run by the 2.0 engine. */
export const LEGACY_POLICIES: Policies = {
  enforceHousing: false,
  enforceEstrusWindows: false,
  operationalProcurement: false,
  accrualAccounting: false,
  matureGrowthCurve: false,
  realisticHealthAndReproduction: false,
};

export type EngineDayRecord = {
  day: number;
  date: string;
  farrowings: number;
  bornAlive: number;
  stillborn: number;
  mummified: number;
  pregnancyLosses: number;
  treatments: number;
  weaned: number;
  sold: number;
  soldLiveweightKg: number;
  soldDeadweightKg: number;
  giltsSelected: number;
  giltsPromoted: number;
  giltsSold: number;
  conceptions: number;
  returnsToHeat: number;
  irregularReturns: number;
  scans: number;
  processing: Record<string, number>;
  movedToGrower: number;
  movedToFinisher: number;
  pigletDeaths: number;
  growingDeaths: number;
  breedingDeaths: number;
  sowsCulled: number;
  giltsPurchased: number;
  boarsRotated: number;
  services: number;
  aiServices: number;
  workers: number;
  vaccinations: Record<PigStage, number>;
  sowFeedKg: number;
  growingFeedKg: number;
  gasKg: number;
  gasHeaters: number;
  beddingKg: number;
  feedByRation: RationTally;
  deliveries: Trip[];
  lorriesIn: number;
  feedDeliveredKg: number;
  marketTrips: number;

  // ---- what 2.0 adds -----------------------------------------------------
  /** Head standing in each room when the day opened. */
  occupancy: Record<RoomId, number>;
  /** Animal-days the growing houses stood over their places today. */
  animalDaysOverCapacity: number;
  /** Batches refused a place today for the first time, and pigs still waiting. */
  movementsBlocked: number;
  pigsHeld: number;
  /** Pens broken in two because the next house had room for only part of one. */
  batchesSplit: number;
  /** At sale weight, and standing somewhere that is not the finishing house. */
  heldAtSaleWeight: number;
  /** Litters weaned early to free a crate for a sow with nowhere to farrow. */
  weanedEarlyForSpace: number;
  /** Pigs lost to crowding over and above the plan's own stage rates. */
  crowdingDeaths: number;
  /** Standing heats that closed unserved, and those of them nobody saw. */
  heatsMissed: number;
  heatsUndetected: number;
  /** Feed the herd asked for and the stores could not give it. */
  feedShortfallKg: number;
  /** Loads sent for at a premium because a store had already run dry. */
  emergencyOrders: number;
  /** Premium paid on emergency goods and journeys received today. */
  emergencyPremium: number;

  counts: StageCounts;
  /** What the day earned and consumed. */
  totals: CategoryTotals;
  /** What actually moved through the bank, which is not the same thing. */
  cashTotals: CategoryTotals;
  netCashFlow: number;
  closingCash: number;
  /** Owed to suppliers at the close of the day. */
  payables: number;
  /** Goods standing in the stores at the close, at what they cost to buy. */
  storeValue: number;
  /** What the day did to the farm's unsold stock and its breeding assets. */
  accounting: AccountingDay;
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
  replacementPipeline: number;
  growingTotal: number;
  total: number;
};

export type EngineLifetime = {
  litters: number;
  bornAlive: number;
  stillborn: number;
  mummified: number;
  pregnancyLosses: number;
  treatments: number;
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
  aiServices: number;
  /** Of those, the ones semen stood in for a boar the farm could not give her. */
  aiFallbackServices: number;
  aiCost: number;
  regularReturns: number;
  irregularReturns: number;
  scans: number;
  pregnanciesConfirmed: number;
  scannedEmpty: number;
  lorries: number;
  feedDeliveredKg: number;
  haulageCost: number;
  marketTrips: number;
  marketHaulageCost: number;
  servicesMissedForBoarCapacity: number;
  servicesMissedForGenetics: number;
  heatsMissed: number;
  heatsUndetected: number;
  movementsBlocked: number;
  blockedAnimalDays: number;
  batchesSplit: number;
  /** Pig-days spent at sale weight waiting for a finishing place. */
  heldAtSaleWeightDays: number;
  animalDaysOverCapacity: number;
  weanedEarlyForSpace: number;
  crowdingDeaths: number;
  feedShortfallKg: number;
  emergencyOrders: number;
  emergencyPremium: number;
};

export function emptyCounts(): StageCounts {
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

export function emptyVaccinations(): Record<PigStage, number> {
  return { piglet: 0, weaner: 0, grower: 0, finisher: 0, gilt: 0 };
}

export function emptyRooms(): Record<RoomId, number> {
  return { farrowing: 0, weaner: 0, grower: 0, finisher: 0 };
}

export function emptyLifetime(): EngineLifetime {
  return {
    litters: 0,
    bornAlive: 0,
    stillborn: 0,
    mummified: 0,
    pregnancyLosses: 0,
    treatments: 0,
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
    servicesAttempted: 0,
    aiServices: 0,
    aiFallbackServices: 0,
    aiCost: 0,
    regularReturns: 0,
    irregularReturns: 0,
    scans: 0,
    pregnanciesConfirmed: 0,
    scannedEmpty: 0,
    lorries: 0,
    feedDeliveredKg: 0,
    haulageCost: 0,
    marketTrips: 0,
    marketHaulageCost: 0,
    servicesMissedForBoarCapacity: 0,
    servicesMissedForGenetics: 0,
    heatsMissed: 0,
    heatsUndetected: 0,
    movementsBlocked: 0,
    blockedAnimalDays: 0,
    batchesSplit: 0,
    heldAtSaleWeightDays: 0,
    animalDaysOverCapacity: 0,
    weanedEarlyForSpace: 0,
    crowdingDeaths: 0,
    feedShortfallKg: 0,
    emergencyOrders: 0,
    emergencyPremium: 0,
  };
}

export function emptyDayRecord(day: number, date: string): EngineDayRecord {
  return {
    day,
    date,
    farrowings: 0,
    bornAlive: 0,
    stillborn: 0,
    mummified: 0,
    pregnancyLosses: 0,
    treatments: 0,
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
    occupancy: emptyRooms(),
    animalDaysOverCapacity: 0,
    movementsBlocked: 0,
    pigsHeld: 0,
    batchesSplit: 0,
    heldAtSaleWeight: 0,
    weanedEarlyForSpace: 0,
    crowdingDeaths: 0,
    heatsMissed: 0,
    heatsUndetected: 0,
    feedShortfallKg: 0,
    emergencyOrders: 0,
    emergencyPremium: 0,
    counts: emptyCounts(),
    totals: emptyTotals(),
    cashTotals: emptyTotals(),
    netCashFlow: 0,
    closingCash: 0,
    payables: 0,
    storeValue: 0,
    accounting: emptyAccountingDay(),
  };
}

/** Everything one simulated farm is, at the moment a system is looking at it. */
export class World {
  readonly config: PlannerConfig;
  readonly policies: Policies;
  readonly start: Date;

  // ---- the animals --------------------------------------------------------
  sows: Sow[] = [];
  boars: Boar[] = [];
  pigs: GrowingPig[] = [];
  /**
   * Who left the farm on the day just closed, and why.
   *
   * Written where the herd is pruned and replaced every morning, so it holds one
   * day and never grows. It is the only way an observer watching the run from
   * outside can tell a sale from a death: both take an animal off the board at
   * the same moment, and the pen they empty is emptied for very different
   * reasons. No system in the engine reads it.
   */
  departures: AnimalDeparture[] = [];

  // ---- the resources ------------------------------------------------------
  readonly ledger: Ledger;
  readonly housing: Housing;
  /** The pens the farm moves and sells by, and what they were split from. */
  readonly batches = new Batches();
  readonly supplies: Supplies;
  /** The rule that decides what the farm buys, and when. */
  readonly procurement: ProcurementPolicy;
  readonly mortality: MortalityScheduler;
  readonly variation: Variation;
  readonly haulage: HaulagePlan;
  readonly deliveriesByDay = new Map<number, Trip[]>();

  // ---- the record ---------------------------------------------------------
  readonly log: EventLog;
  readonly history: EngineDayRecord[] = [];
  readonly lifetime = emptyLifetime();
  day = -1;
  /** The day being built, so a system can note what it did without threading it. */
  record: EngineDayRecord = emptyDayRecord(-1, "");

  // ---- cost attribution ---------------------------------------------------
  readonly soldPigCosts = new CostRecord();
  readonly breedingCosts = new CostRecord();
  /** The second set of books: what the farm owns, as against what it earned. */
  readonly books = new Books();
  financingCosts = 0;
  readonly generationStats = new Map<number, { born: number; sold: number; died: number }>();

  // ---- cursors and counters the systems keep between days -----------------
  readonly packLeft = new Map<string, { left: number; openedOn: number }>();
  readonly giltsKeptPerLitter = new Map<string, number>();
  boarCursor = 0;
  studCursor = 0;
  workersOnPayroll = 0;
  nextMonthlyChargeDay = 0;
  monthsCharged = 0;
  /** The month index charged today, or null — the financing posts against it. */
  chargedMonth: number | null = null;
  sowSequence = 0;
  boarSequence = 0;
  pigSequence = 0;
  /** Set for the day by the nutrition system, read by the growth system. */
  vaccinationSchedule: PlannerConfig["health"]["vaccinations"];
  /**
   * The last procurement decision the log reported, so an identical "no order"
   * is not written out every morning of a three-year plan.
   */
  lastProcurementDecision: ProcurementDecision | null = null;
  /** The day the planner last said it expected to send the next load. */
  expectedNextDispatchDay: number | null = null;

  constructor(init: {
    config: PlannerConfig;
    policies: Policies;
    variation: Variation;
    haulage: HaulagePlan;
    eventLimit: number;
    /** Overrides the policy the config names, for the tuning bench and tests. */
    procurement?: ProcurementPolicy;
  }) {
    this.config = init.config;
    this.policies = init.policies;
    this.variation = init.variation;
    this.haulage = init.haulage;
    this.start = parseISO(init.config.project.startDate);
    this.ledger = new Ledger(init.config.project.openingCash);
    this.housing = new Housing(init.config, init.policies.enforceHousing);
    this.supplies = new Supplies(
      init.config,
      init.policies.operationalProcurement,
      init.policies.accrualAccounting,
    );
    this.procurement = init.procurement ?? policyFor();
    this.mortality = new MortalityScheduler(init.config);
    this.log = new EventLog(init.eventLimit);
    this.vaccinationSchedule = [...init.config.health.vaccinations].sort(
      (a, b) => a.ageDays - b.ageDays,
    );
    for (const trip of init.haulage.trips) {
      const sameDay = this.deliveriesByDay.get(trip.day);
      if (sameDay) sameDay.push(trip);
      else this.deliveriesByDay.set(trip.day, [trip]);
    }
  }

  /**
   * The farm as the procurement planner is allowed to see it: the stores as
   * they stand, and an expected picture of the herd built by walking it.
   *
   * Nothing here is a reference into the world. That is the point — a policy
   * given this context cannot reach a scheduled death, a pending random draw or
   * any other fact today's farm has no way of knowing.
   */
  procurementContext(day: number): ProcurementPlanningContext {
    return {
      // The demand forecaster must use the policy the world is actually
      // running, not a stale experimental flag retained in an in-memory plan.
      config: {
        ...this.config,
        housing: { ...this.config.housing, enforceCapacity: this.policies.enforceHousing },
      },
      stores: this.supplies.snapshot(day, this.ledger.cash),
      farm: withObservedGrowthFactors(
        day,
        observeFarm(day, { sows: this.sows, boars: this.boars, pigs: this.pigs }),
        this.pigs,
      ),
    };
  }

  dateOf(day: number): Date {
    return addDays(this.start, day);
  }

  dayOf(date: Date): number {
    return differenceInCalendarDays(date, this.start);
  }

  /** Emits a domain event onto the record, and hands it back for chaining. */
  emit(
    type: EventType,
    message: string,
    detail: {
      entities?: readonly string[];
      cause?: string;
      changes?: Record<string, number | string>;
      postings?: readonly Posting[];
      stage?: PigStage;
      room?: RoomId;
    } = {},
  ): DomainEvent {
    return this.log.emit({
      day: this.day,
      date: format(this.dateOf(Math.max(this.day, 0)), "yyyy-MM-dd"),
      type,
      message,
      ...detail,
    });
  }

  // ---- naming -------------------------------------------------------------

  nextSowTag(): string {
    this.sowSequence += 1;
    return "SOW-" + String(this.sowSequence).padStart(3, "0");
  }

  nextBoarTag(): string {
    this.boarSequence += 1;
    return "BOAR-" + String(this.boarSequence).padStart(2, "0");
  }

  nextPigTag(): string {
    this.pigSequence += 1;
    return "PIG-" + String(this.pigSequence).padStart(5, "0");
  }

  noteBirth(generation: number): void {
    const stats = this.generationStats.get(generation) ?? { born: 0, sold: 0, died: 0 };
    stats.born += 1;
    this.generationStats.set(generation, stats);
  }

  noteExit(generation: number, sold: boolean): void {
    const stats = this.generationStats.get(generation) ?? { born: 0, sold: 0, died: 0 };
    if (sold) stats.sold += 1;
    else stats.died += 1;
    this.generationStats.set(generation, stats);
  }

  /** Head on the farm right now, by stage and by what each sow is doing. */
  countHerd(): StageCounts {
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

  /** How full every room is, and what its places have cost the farm so far. */
  housingReport(): RoomLevel[] {
    return this.housing.report();
  }

  /** Rooms, in the order the housing feedback chain runs through them. */
  get rooms(): readonly RoomId[] {
    return ROOM_IDS;
  }
}
