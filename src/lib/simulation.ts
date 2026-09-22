import { addMonths, parseISO } from "date-fns";

import { plannerSchema, type PlannerConfig } from "./config";
import { Engine, engineHorizonDay } from "./engine/engine";
import { engineEventLog, engineSnapshot, engineState } from "./engine/read";
import {
  HousingPlanner,
  type HousingHerdView,
  type HousingNeedsResult,
  type HousingPolicy,
} from "./housing";
import {
  buildWarnings,
  summariseMonth,
  summariseYears,
  type MonthlyProjection,
  type ProjectionResult,
  type ProjectionSummary,
  type WarnableRun,
} from "./model";
import {
  Farm,
  horizonDay,
  timelineOf,
  type DayRecord,
  type FarmEvent,
  type FarmSnapshot,
  type FarmState,
  type FarmTimeline,
  type SowRow,
  type StockRow,
} from "./sim";
import { inventoryTotal, type AccountingBalances } from "./sim/accounting";
import { addTotals, emptyTotals } from "./sim/ledger";
import { inventoryAdjustedProfit, mergeAccounting } from "./accounts";

/**
 * One run of a plan, and every way the product reads it.
 *
 * Before this, a settled config was simulated once for the cashflow projection,
 * again for the simulator's timeline, and a third time to answer "what was
 * standing here on the 15th of June" — three runs of the same farm, agreeing
 * with each other perfectly and costing three times as much. Picking another
 * date on the calendar started a fourth. On a 2.0 plan with a couple of hundred
 * sows one run is over two minutes, so this was not a rounding error.
 *
 * So the engine runs once, here, and everything a page shows is derived from
 * that run: the monthly projection, the calendar, the month roll-up and the
 * state of the farm on any day of the plan.
 */

/**
 * The parts of a run the read models need, with the two engines behind one
 * shape. Nothing above this line knows which engine is running, which is the
 * point: a React component choosing between `Farm` and `Engine` is how the
 * simulator came to show 1.x numbers for a 2.0 plan in the first place.
 */
type PlanRun = {
  readonly horizonDay: number;
  readonly history: readonly DayRecord[];
  readonly lifetime: WarnableRun & { litters: number; weaned: number };
  /** What the farm was holding before day one: its opening balance sheet. */
  readonly openingBalances: AccountingBalances;
  /** The day the run has reached. */
  readonly day: number;
  dayOf(date: Date): number;
  advanceTo(day: number): void;
  /** The farm as it stands, bar the rosters. */
  snapshot(timestamp?: string): FarmSnapshot;
  /** The farm as it stands, rosters and all. */
  state(timestamp?: string): FarmState;
  events(): FarmEvent[];
  /**
   * The animals themselves, as they stand this morning. Read by the housing
   * planner and by nothing else: it is the one question that cannot be answered
   * from a day's record, because what a farm has to be built to hold depends on
   * which animals they are and not only on how many.
   */
  herd(): HousingHerdView;
};

type RunOptions = { keepEveryEvent?: boolean };

function legacyRun(config: PlannerConfig, options: RunOptions = {}): PlanRun {
  const farm = new Farm(config, undefined, options);
  const openingBalances = farm.books.opening;
  const horizon = horizonDay(config);
  return {
    horizonDay: horizon,
    openingBalances,
    get history() {
      return farm.history;
    },
    get lifetime() {
      return farm.lifetime;
    },
    get day() {
      return farm.day;
    },
    dayOf: (date) => farm.dayOf(date),
    advanceTo: (day) => {
      farm.advanceTo(day);
    },
    snapshot: (timestamp) => farm.snapshot(timestamp),
    state: (timestamp) => farm.state(timestamp),
    events: () => farm.events,
    herd: () => farm,
  };
}

function engineRun(config: PlannerConfig, options: RunOptions = {}): PlanRun {
  const engine = new Engine(config, options);
  const world = engine.world;
  const horizon = engineHorizonDay(config);
  return {
    horizonDay: horizon,
    openingBalances: world.books.opening,
    get history() {
      return world.history;
    },
    get lifetime() {
      return world.lifetime;
    },
    get day() {
      return world.day;
    },
    dayOf: (date) => world.dayOf(date),
    advanceTo: (day) => {
      engine.advanceTo(day);
    },
    snapshot: (timestamp) => engineSnapshot(engine, timestamp),
    state: (timestamp) => engineState(engine, timestamp),
    events: () => engineEventLog(world.log.events),
    herd: () => world,
  };
}

/** The engine the plan is set to, built but not yet run. */
function runFor(config: PlannerConfig, options: RunOptions = {}): PlanRun {
  return config.project.engine === "2.0" ? engineRun(config, options) : legacyRun(config, options);
}

export type SimulatePlanOptions = {
  /**
   * Keep a reading of the farm for every day of the plan, so that any date can
   * be opened without running it again. On by default; the projection turns it
   * off, because a cashflow has no use for the state of a Tuesday and the
   * comparison tool projects a dozen plans in a row.
   */
  snapshots?: boolean;
  /** Keep the whole event log rather than the tail of it. */
  keepEveryEvent?: boolean;
  /**
   * Work out what the plan would have to be housed in as it runs.
   *
   * It has to happen during the run: the housing planner allocates pens one
   * morning at a time and the whole point of it is the mornings a month end
   * never sees. Defaulted to whatever the day readings are doing, so the
   * projection-only callers — the cashflow, the comparison tool — pay for
   * neither, and a full reading of a plan gets both.
   */
  housing?: boolean;
  /** The housing rules to plan against. The manual's profile by default. */
  housingPolicy?: HousingPolicy;
};

/** What the one run behind a plan cost, and what had to be run again. */
export type PlanSimulationStats = {
  /** Days stepped by the run. */
  days: number;
  /** Day readings kept, so a calendar click is a lookup rather than a run. */
  snapshots: number;
  /**
   * Extra runs made to stand the farm back up on a day the run has already
   * gone past. With the days kept, only a roster asks for one, and nothing on
   * screen reads a roster — so in the product this stays at zero. See
   * {@link PlanSimulation.stateAt}.
   */
  replays: number;
};

export type PlanSimulation = {
  readonly config: PlannerConfig;
  /** Last day index inside the horizon, in the terms the chosen engine counts. */
  readonly horizonDay: number;
  /** The run, day by day, as the engine wrote it. */
  readonly history: readonly DayRecord[];
  /** The monthly cashflow the plan is read from. */
  readonly projection: ProjectionResult;
  /** The whole plan day by day, and the same days grouped into months. */
  readonly timeline: FarmTimeline;
  /** Every line the plan wrote, capped unless the run was asked to keep it all. */
  readonly events: FarmEvent[];
  /**
   * What this plan would have to be housed in: pens, rooms and buildings by
   * housing type. Null when the run was not asked to work it out.
   */
  readonly housing: HousingNeedsResult | null;
  /**
   * The farm at a wall-clock moment, bar the rosters. Events resolve to whole
   * days, so a timestamp reads its own day, and a day outside the horizon reads
   * the nearest one inside it.
   */
  snapshotAt(timestamp: string): FarmSnapshot;
  /**
   * The same, with every animal standing on the farm written out.
   *
   * `stock` and `sows` — the animal-by-animal rosters — are the one part of a
   * day that is too big to keep for every day of a plan, so they are worked out
   * when they are read and not before. Nothing in the product reads them; a test
   * that does pays for a run to the day it asked about.
   */
  stateAt(timestamp: string): FarmState;
  readonly stats: PlanSimulationStats;
};

/**
 * Runs the plan's chosen engine once, over the whole horizon, and hands back
 * everything the product reads off it.
 */
export function simulatePlan(
  input: PlannerConfig,
  options: SimulatePlanOptions = {},
): PlanSimulation {
  const config = plannerSchema.parse(input);
  const run = runFor(config, { keepEveryEvent: options.keepEveryEvent });
  const horizon = run.horizonDay;
  const keepSnapshots = options.snapshots !== false;
  const planner =
    (options.housing ?? keepSnapshots)
      ? new HousingPlanner(config, options.housingPolicy)
      : null;

  const stats: PlanSimulationStats = { days: 0, snapshots: 0, replays: 0 };

  /**
   * The one run, taken out to the end of the horizon.
   *
   * Stepped a day at a time when the days are being kept, and in one go when
   * they are not; either way the farm is advanced the way it has always been
   * advanced, so the plan comes out the same. It is not run until something
   * asks for a part of it that needs the whole horizon, so that a caller after
   * one day of the plan pays for one day of it.
   */
  const snapshots: FarmSnapshot[] = [];
  function toHorizon(): void {
    if (run.day >= horizon) return;
    if (keepSnapshots || planner !== null) {
      if (keepSnapshots && snapshots.length === 0) snapshots.push(run.snapshot());
      for (let day = run.day + 1; day <= horizon; day += 1) {
        run.advanceTo(day);
        if (keepSnapshots) snapshots.push(run.snapshot());
        // After the day has closed, so the housing planner sees the herd the
        // day ended with rather than one that still has the morning's dead in it.
        planner?.observe(day, run.herd());
      }
    } else {
      run.advanceTo(horizon);
    }
    stats.days = horizon + 1;
    stats.snapshots = snapshots.length;
  }

  let projection: ProjectionResult | null = null;
  let timeline: FarmTimeline | null = null;
  let terminal: FarmSnapshot | null = null;
  let housing: HousingNeedsResult | null = null;

  /** The farm as it stood when the run finished. */
  const terminalSnapshot = () => (terminal ??= snapshots.at(-1) ?? run.snapshot());

  /**
   * A roster for a day the run has already gone past. The run itself can answer
   * for its own last day; anything earlier needs the herd as it stood then,
   * which only a farm advanced to that day has. The replay is forward-only and
   * kept between calls, so a set of dates read in order costs one of them.
   */
  const rosterCache = new Map<number, { stock: StockRow[]; sows: SowRow[] }>();
  let cursor: PlanRun | null = null;

  function rostersAt(day: number): { stock: StockRow[]; sows: SowRow[] } {
    const cached = rosterCache.get(day);
    if (cached) return cached;

    let source: PlanRun;
    if (day === run.day) {
      source = run;
    } else {
      if (cursor === null || cursor.day > day) {
        cursor = runFor(config);
        stats.replays += 1;
      }
      cursor.advanceTo(day);
      source = cursor;
    }

    const state = source.state();
    const rosters = { stock: state.stock, sows: state.sows };
    // A handful of days is all a reader ever holds open at once.
    if (rosterCache.size >= 8) rosterCache.delete(rosterCache.keys().next().value as number);
    rosterCache.set(day, rosters);
    return rosters;
  }

  /** Which day of the plan a moment falls on, clamped to the horizon. */
  function dayFor(timestamp: string): number {
    const moment = parseISO(timestamp);
    const requested = Number.isNaN(moment.getTime()) ? 0 : run.dayOf(moment);
    return Math.min(Math.max(requested, -1), horizon);
  }

  /**
   * A farm standing on a given day, for when no day readings are being kept.
   * Forward is free; backwards is a fresh run.
   */
  function standOn(day: number): PlanRun {
    if (run.day <= day) {
      run.advanceTo(day);
      stats.days = run.day + 1;
      return run;
    }
    if (cursor === null || cursor.day > day) {
      cursor = runFor(config);
      stats.replays += 1;
    }
    cursor.advanceTo(day);
    return cursor;
  }

  /** A kept day reading, dressed back up as the state of the farm on that day. */
  function stateOf(snapshot: FarmSnapshot, day: number, timestamp: string): FarmState {
    const state = { ...snapshot, timestamp } as FarmState;
    let rosters: { stock: StockRow[]; sows: SowRow[] } | null = null;
    const load = () => (rosters ??= rostersAt(day));
    Object.defineProperty(state, "stock", {
      enumerable: true,
      configurable: true,
      get: () => load().stock,
    });
    Object.defineProperty(state, "sows", {
      enumerable: true,
      configurable: true,
      get: () => load().sows,
    });
    return state;
  }

  return {
    config,
    horizonDay: horizon,
    get history() {
      toHorizon();
      return run.history;
    },
    get projection() {
      toHorizon();
      return (projection ??= projectionOf(config, run, terminalSnapshot()));
    },
    get timeline() {
      toHorizon();
      return (timeline ??= timelineOf(config, run.history, (date) => run.dayOf(date)));
    },
    get events() {
      toHorizon();
      return run.events();
    },
    get housing() {
      if (planner === null) return null;
      toHorizon();
      return (housing ??= planner.plan());
    },
    snapshotAt(timestamp: string): FarmSnapshot {
      const day = dayFor(timestamp);
      if (keepSnapshots) {
        toHorizon();
        return { ...snapshots[day + 1], timestamp };
      }
      return standOn(day).snapshot(timestamp);
    },
    stateAt(timestamp: string): FarmState {
      const day = dayFor(timestamp);
      if (keepSnapshots) {
        toHorizon();
        return stateOf(snapshots[day + 1], day, timestamp);
      }
      return standOn(day).state(timestamp);
    },
    stats,
  };
}

/**
 * The run rolled up into the monthly cashflow the plan is read from.
 *
 * One roll-up for both engines. The daily record 2.0 writes is a superset of
 * the 1.x one, and the two summaries were the same code written twice — which
 * is a thing that stays true only until someone changes one of them.
 */
function projectionOf(
  config: PlannerConfig,
  run: PlanRun,
  terminal: FarmSnapshot,
): ProjectionResult {
  const start = parseISO(config.project.startDate);
  const byDay = new Map(run.history.map((day) => [day.day, day]));
  const months: MonthlyProjection[] = [];

  // The herd and the stores the plan opened with, which is what the first month
  // is measured against. Every month after it opens where the one before closed.
  let opening = run.openingBalances;
  for (let index = 0; index < config.project.months; index += 1) {
    const monthStart = addMonths(start, index);
    const firstDay = run.dayOf(monthStart);
    const lastDay = run.dayOf(addMonths(start, index + 1)) - 1;
    const days: DayRecord[] = [];
    for (let day = firstDay; day <= lastDay; day += 1) {
      const record = byDay.get(day);
      if (record) days.push(record);
    }
    const month = summariseMonth(index, monthStart, days, opening);
    opening = month.accounting.closing;
    months.push(month);
  }

  const sum = (pick: (month: MonthlyProjection) => number) =>
    months.reduce((total, month) => total + pick(month), 0);

  const totalCost = sum((month) => month.totalCost);
  // Every store's goods plus the trips that brought them: what the farm spends
  // to keep something in front of the animals.
  const totalFeedCost = sum(
    (month) =>
      month.totals["feed-sow"] +
      month.totals["feed-creep"] +
      month.totals["feed-weaner"] +
      month.totals["feed-grower"] +
      month.totals["feed-finisher"] +
      month.totals.deliveries,
  );
  const operatingCostExcludingCapital = totalCost - sum((month) => month.totals.capital);
  const lowestCash = Math.min(
    config.project.openingCash,
    ...months.map((month) => month.closingCash),
  );
  const sowMonths = months.reduce((total, month) => total + month.sows, 0);
  const averageSows = months.length > 0 ? sowMonths / months.length : 0;
  // The high-water mark of the breeding herd, and when it was set. A herd that
  // fills its places and is then drawn down by culling ends below capacity
  // without ever having failed to reach it; both readings come from here.
  const peakSows = months.reduce((most, month) => Math.max(most, month.sows), 0);
  const peakSowMonth = months.find((month) => month.sows === peakSows) ?? null;
  const years = config.project.months / 12;
  const lifetime = run.lifetime;
  const totalRevenue = sum((month) => month.revenue);

  // The whole horizon through the second set of books, and the balance sheet it
  // ends on. The terminal reading already carries the closing valuation; what
  // the flows add is where it came from.
  const horizonAccounting = mergeAccounting(months.map((month) => month.accounting));
  const horizonTotals = emptyTotals();
  for (const month of months) addTotals(horizonTotals, month.totals);
  const farmWorth = terminal.finance.valuation;
  const openingWorth = config.project.openingCash + inventoryTotal(run.openingBalances);

  const summary: ProjectionSummary = {
    totalRevenue,
    totalFeedCost,
    totalVeterinaryCost: sum((month) => month.totals.veterinary + month.totals.vaccination),
    totalCost,
    totalPigsSold: sum((month) => month.pigsSold),
    totalBornAlive: sum((month) => month.bornAlive),
    totalWeaned: sum((month) => month.weaned),
    totalDeaths: sum((month) => month.deaths),
    closingCash: months.at(-1)?.closingCash ?? config.project.openingCash,
    lowestCash,
    peakFundingNeed: Math.max(0, -lowestCash),
    feedShareOfOperatingCost:
      operatingCostExcludingCapital > 0 ? totalFeedCost / operatingCostExcludingCapital : 0,
    pigsWeanedPerSowYear:
      averageSows > 0 && years > 0 ? lifetime.weaned / (averageSows * years) : 0,
    littersPerSowYear:
      averageSows > 0 && years > 0 ? lifetime.litters / (averageSows * years) : 0,
    averageSows,
    finalSows: months.at(-1)?.sows ?? 0,
    peakSows,
    peakSowsMonth: peakSowMonth?.month ?? null,
    sowCapacityReachedMonth:
      months.find((month) => month.sows >= config.herd.maxSows)?.month ?? null,
    peakHeadCount: Math.max(0, ...months.map((month) => month.peakHead)),
    firstPositiveMonth:
      months.find((month) => month.closingCash >= 0 && month.index > 0)?.month ?? null,
    herdValueAtEnd: terminal.finance.herdValue,
    netWorthAtEnd: terminal.finance.netWorth,
    // Read from `lib/accounts` rather than added up again here: every page and
    // the workbook show this same figure, and they can only do that if there is
    // one of it.
    inventoryAdjustedProfit: inventoryAdjustedProfit(horizonTotals, horizonAccounting),
    farmWorthAtEnd: farmWorth.netWorth,
    changeInFarmWorth: farmWorth.netWorth - openingWorth,
    marketLivestockValueAtEnd: farmWorth.inventory.marketLivestock,
    breedingHerdValueAtEnd:
      farmWorth.breedingAssets.sows +
      farmWorth.breedingAssets.boars +
      farmWorth.inventory.replacementGilts,
    feedInventoryValueAtEnd: farmWorth.inventory.feed,
  };

  return {
    months,
    years: summariseYears(months, start),
    summary,
    accounting: horizonAccounting,
    farmWorth,
    generations: terminal.generations,
    costOfProduction: terminal.costOfProduction,
    warnings: buildWarnings(config, summary, lifetime),
  };
}
