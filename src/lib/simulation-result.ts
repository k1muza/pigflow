import { differenceInCalendarDays, parseISO } from "date-fns";

import type { PlannerConfig } from "./config";
import type { HousingNeedsResult, HousingSimulationResult } from "./housing";
import type { ProjectionResult } from "./model";
import type { PedigreeRecord } from "./pedigree";
import type { GrowthSimulationSummary } from "./growth-observer";
import type { PlanSimulation } from "./simulation";
import { farmValuation, ZERO_BALANCES, type StageValues } from "./sim/accounting";
import type {
  CostOfProduction,
  FarmSnapshot,
  FarmTimeline,
  PigStage,
  StoreLevel,
} from "./sim";

/**
 * A finished plan in a shape that can cross a worker boundary.
 *
 * {@link PlanSimulation} is a live thing: it holds the farm that produced it and
 * answers questions by reading it. None of that survives `postMessage`, and
 * none of it should — a `Farm` sent to React would be a dead copy of a mutable
 * object, which is worse than useless. So the worker runs the plan and sends
 * this instead: everything the pages read, and nothing that has to be run again
 * to be understood.
 */

/**
 * What the simulator shows for one day of the plan.
 *
 * Narrower than a {@link FarmSnapshot}: the rosters, the lifetime totals, the
 * generation table and the running event log are not on this because no page
 * reads them off a day, and a plan has a day for every day it ran. What is left
 * is what the day panel puts on screen.
 */
export type DaySnapshot = {
  day: number;
  date: string;
  /** Every live animal's weight added up, which is what the herd is worth.  */
  liveweightKg: number;
  /** What a pig of each stage weighs on average. */
  averageWeightKg: Record<PigStage, number>;
  /** What each group of the herd is carried at, which prices its line. */
  valueAtCost: StageValues;
  finance: FarmSnapshot["finance"];
  stores: StoreLevel[];
  costOfProduction: CostOfProduction;
};

/**
 * Every day of the plan, held as columns rather than as a day per object.
 *
 * A day is about eighty numbers wrapped in a hundred key names, and a five year
 * plan has eighteen hundred days of them. Sent as objects that is nine megabytes
 * and a tenth of a second of structured clone — paid on the main thread, on
 * arrival, which is the one place this refactor is trying to keep free. Held as
 * one `Float64Array` it is the same figures in seven hundred kilobytes, and it
 * is transferable, so it arrives without being copied at all.
 *
 * The strings — store ids, labels, units — do not vary from day to day, so they
 * are kept once, on {@link template}, and a day is read by writing its numbers
 * back into a copy of it.
 */
export type DayColumns = {
  /** A day of the plan with its strings in place and its numbers meaningless. */
  template: DaySnapshot;
  /** Where each number of a day lives in {@link template}, in column order. */
  fields: readonly string[];
  /** The date of each day, in plan order. */
  dates: readonly string[];
  /** `fields.length` numbers per day, one day after another. A null reads NaN. */
  values: Float64Array;
};

/** What the worker sends back, and what every page of a plan is read from. */
export type ProductionMortalityStage = "piglet" | "weaner" | "grower" | "finisher";

export type StageMortalityResult = {
  stage: ProductionMortalityStage;
  entered: number;
  deaths: number;
  observedRatePct: number;
  configuredRatePct: number;
};

export type MortalityResult = {
  stages: StageMortalityResult[];
  totalDeaths: number;
};

export type PlanSimulationResult = {
  /** The config as the engine parsed it, so a page reads what actually ran. */
  config: PlannerConfig;
  /** Last day index inside the horizon. */
  horizonDay: number;
  /** The monthly cashflow. */
  projection: ProjectionResult;
  /** The whole plan day by day, and the same days grouped into months. */
  timeline: FarmTimeline;
  /** Day 0 to the horizon, in columns. See {@link daySnapshotAt}. */
  days: DayColumns;
  /**
   * What this plan would have to be housed in: pens, rooms and buildings by
   * housing type, worked out from the same daily state everything else here was.
   * Null when the run was asked not to work it out.
   */
  housing: HousingNeedsResult | null;
  /**
   * Where every animal stood in the plan's own pens, as movements and occupancy.
   *
   * Events rather than days: a reading of every pen on every morning of a
   * five-year plan is tens of megabytes of saying that nothing moved, and this
   * is a few thousand lines saying what did. Any day of it is rebuilt with
   * `farmStateOnDay`. Null on a plan with no physical housing.
   */
  physicalHousing: HousingSimulationResult | null;
  /** Production-stage mortality, using actual stage-at-death records from this run. */
  mortality: MortalityResult;
  /** Observed growth checkpoints, completed-stage performance and market distribution. */
  growth: GrowthSimulationSummary | null;
  /** Whole-run ancestry, including animals that left before the horizon. */
  pedigree: PedigreeRecord[];
};

/**
 * Gathers a finished simulation into the shape that crosses to the main thread.
 *
 * Reading every day of the plan out of the simulation is the point: after this
 * the farm can be let go, and picking a date on the calendar is an index into
 * an array rather than anything that runs.
 */
export function planResultOf(simulation: PlanSimulation): PlanSimulationResult {
  const days: DaySnapshot[] = [];
  for (const day of simulation.timeline.days) {
    days.push(daySnapshotOf(simulation.snapshotAt(day.date + "T23:00")));
  }
  return {
    config: simulation.config,
    horizonDay: simulation.horizonDay,
    projection: simulation.projection,
    timeline: simulation.timeline,
    days: packDays(days),
    housing: simulation.housing,
    physicalHousing: simulation.physicalHousing,
    mortality: mortalityResultOf(simulation),
    growth: simulation.growth,
    pedigree: simulation.pedigree,
  };
}

/** Stage-level production mortality read from the finished run. */
function mortalityResultOf(simulation: PlanSimulation): MortalityResult {
  const { config, history } = simulation;
  const stages: ProductionMortalityStage[] = ["piglet", "weaner", "grower", "finisher"];
  const opening = { piglet: 0, weaner: 0, grower: 0, finisher: 0 };
  if (config.stock.starting.length > 0) {
    for (const animal of config.stock.starting) {
      if (animal.type === "piglet" || animal.type === "weaner" || animal.type === "grower" || animal.type === "finisher") opening[animal.type] += 1;
    }
  } else {
    opening.piglet = config.stock.piglets;
    opening.weaner = config.stock.weaners;
    opening.grower = config.stock.growers;
    opening.finisher = config.stock.finishers;
  }
  const sum = (pick: (day: PlanSimulation["history"][number]) => number) => history.reduce((total, day) => total + pick(day), 0);
  const entered = {
    piglet: opening.piglet + sum((day) => day.bornAlive),
    weaner: opening.weaner + sum((day) => day.weaned),
    grower: opening.grower + sum((day) => day.movedToGrower),
    finisher: opening.finisher + sum((day) => day.movedToFinisher),
  };
  const configured = {
    piglet: config.reproduction.preWeanMortalityPct,
    weaner: config.growth.weanerMortalityPct,
    grower: config.growth.growerMortalityPct,
    finisher: config.growth.finisherMortalityPct,
  };
  const rows = stages.map((stage) => {
    const deaths = sum((day) => day.deathsByStage[stage]);
    return { stage, entered: entered[stage], deaths, observedRatePct: entered[stage] > 0 ? (deaths / entered[stage]) * 100 : 0, configuredRatePct: configured[stage] };
  });
  return { stages: rows, totalDeaths: rows.reduce((total, row) => total + row.deaths, 0) };
}

/** The part of a farm reading that a day of the simulator shows. */
function daySnapshotOf(state: FarmSnapshot): DaySnapshot {
  return {
    day: state.day,
    date: state.date,
    liveweightKg: state.herd.liveweightKg,
    averageWeightKg: state.herd.averageWeightKg,
    valueAtCost: state.herd.valueAtCost,
    finance: state.finance,
    stores: state.stores,
    costOfProduction: state.costOfProduction,
  };
}

/**
 * The buffers inside a result that can be handed over rather than copied. Pass
 * these as `postMessage`'s second argument; the sender loses them, which is
 * exactly right for a result it is finished with.
 */
export function planResultTransfers(result: PlanSimulationResult): Transferable[] {
  return [result.days.values.buffer as ArrayBuffer];
}

// ----------------------------------------------------------------- reading it

/**
 * Which day of the plan a wall-clock moment falls on. Events resolve to whole
 * days, so a timestamp reads its own day, and a moment outside the plan reads
 * the nearest day inside it.
 */
export function dayIndexAt(result: PlanSimulationResult, timestamp: string): number {
  const moment = parseISO(timestamp);
  if (Number.isNaN(moment.getTime())) return 0;
  const start = parseISO(result.config.project.startDate);
  const day = differenceInCalendarDays(moment, start);
  return Math.min(Math.max(day, 0), result.days.dates.length - 1);
}

/** What the farm looked like on the day a moment falls on. */
export function daySnapshotAt(result: PlanSimulationResult, timestamp: string): DaySnapshot {
  return daySnapshotByIndex(result, dayIndexAt(result, timestamp));
}

/** The nth day of the plan, read back out of the columns. */
export function daySnapshotByIndex(result: PlanSimulationResult, index: number): DaySnapshot {
  return unpackDay(result.days, index);
}

// ------------------------------------------------------------------ the codec

/**
 * Every place a number sits inside a day, as a dotted path.
 *
 * Walked off a day rather than written out by hand: the day model is a fixed
 * shape of numbers, and a list of eighty field names kept in step with it by
 * hand is a list that goes out of step with it. A `null` counts as a number —
 * a store's capacity is one on the days it has one — and travels as NaN.
 */
function numberFields(value: unknown, prefix: string, into: string[]): void {
  if (value === null || typeof value === "number") {
    into.push(prefix);
    return;
  }
  if (typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    numberFields(child, prefix === "" ? key : prefix + "." + key, into);
  }
}

function readPath(day: DaySnapshot, path: string): number {
  let value: unknown = day;
  for (const key of path.split(".")) {
    if (value === null || typeof value !== "object") return Number.NaN;
    value = (value as Record<string, unknown>)[key];
  }
  // A field that is null on this day, or missing from it, reads as no figure.
  return typeof value === "number" ? value : Number.NaN;
}

function writePath(day: DaySnapshot, path: string, figure: number): void {
  const keys = path.split(".");
  let target = day as unknown as Record<string, unknown>;
  for (const key of keys.slice(0, -1)) target = target[key] as Record<string, unknown>;
  target[keys[keys.length - 1]] = Number.isNaN(figure) ? null : figure;
}

/** Turns a day per object into a column per figure. */
export function packDays(days: readonly DaySnapshot[]): DayColumns {
  // The last day of the plan is the fullest: every store the farm ever opened
  // is standing by then, and the layout has to have a column for each of them.
  const sample = days.at(-1) ?? emptyDay();
  const fields: string[] = [];
  numberFields(sample, "", fields);

  const values = new Float64Array(days.length * fields.length);
  for (const [index, day] of days.entries()) {
    const row = index * fields.length;
    for (let field = 0; field < fields.length; field += 1) {
      values[row + field] = readPath(day, fields[field]);
    }
  }

  return {
    template: structuredClone(sample),
    fields,
    dates: days.map((day) => day.date),
    values,
  };
}

/** Turns one column-wise day back into the object a panel reads. */
export function unpackDay(columns: DayColumns, index: number): DaySnapshot {
  const day = structuredClone(columns.template);
  const row = index * columns.fields.length;
  for (let field = 0; field < columns.fields.length; field += 1) {
    writePath(day, columns.fields[field], columns.values[row + field]);
  }
  day.date = columns.dates[index];
  return day;
}

/** A day of nothing, for a plan with no days in it. */
function emptyDay(): DaySnapshot {
  return {
    day: 0,
    date: "",
    liveweightKg: 0,
    averageWeightKg: { piglet: 0, weaner: 0, grower: 0, finisher: 0, gilt: 0 },
    valueAtCost: {
      gestatingSows: 0,
      lactatingSows: 0,
      openSows: 0,
      boars: 0,
      piglets: 0,
      weaners: 0,
      growers: 0,
      finishers: 0,
      gilts: 0,
    },
    finance: {
      openingCash: 0,
      cash: 0,
      income: 0,
      expenses: 0,
      herdValue: 0,
      storeValue: 0,
      netWorth: 0,
      totals: {} as DaySnapshot["finance"]["totals"],
      last30Days: { income: 0, expenses: 0, net: 0 },
      valuation: farmValuation({
        cash: 0,
        feedValue: 0,
        suppliesValue: 0,
        balances: ZERO_BALANCES,
        payables: 0,
      }),
    },
    stores: [],
    costOfProduction: {} as CostOfProduction,
  };
}
