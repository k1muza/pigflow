import { addMonths, differenceInCalendarDays, format, parseISO } from "date-fns";

import type { PlannerConfig } from "../config";
import { Farm, STORE_LABELS } from "./farm";
import type { DayRecord, FarmEvent, FarmSnapshot, StageCounts } from "./farm";
import {
  addTotals,
  cashTotalsOf,
  emptyTotals,
  expensesOf,
  incomeOf,
  type CategoryTotals,
} from "./ledger";
import type { StageValues } from "./accounting";
import type { PigStage } from "./animals";

export * from "./animals";
export * from "./farm";
export * from "./haulage";
export * from "./ledger";
export { dailyHazard, Rng } from "./rng";

/** Last day index inside the planning horizon. */
export function horizonDay(config: PlannerConfig): number {
  const start = parseISO(config.project.startDate);
  return differenceInCalendarDays(addMonths(start, config.project.months), start) - 1;
}

/** Builds a farm and runs it to the given day index. */
export function runFarm(config: PlannerConfig, throughDay = horizonDay(config)): Farm {
  return new Farm(config).advanceTo(throughDay);
}

/**
 * Runs the farm up to a wall-clock moment and reports what is standing on it.
 * Events resolve to whole days, so a timestamp reads the state of its own day.
 */
export function farmStateAt(config: PlannerConfig, timestamp: string) {
  const farm = new Farm(config);
  const moment = parseISO(timestamp);
  const requested = Number.isNaN(moment.getTime()) ? 0 : farm.dayOf(moment);
  const day = Math.min(Math.max(requested, -1), horizonDay(config));
  return farm.advanceTo(day).state(timestamp);
}

/**
 * Every line the farm wrote as it ran, start to finish. The running log is
 * capped so that a long plan does not carry the whole of it in memory for the
 * sake of the last dozen lines; this asks for all of it, which is the point of
 * a log you are going to read.
 */
export function farmEventLog(config: PlannerConfig): FarmEvent[] {
  const farm = new Farm(config, undefined, { keepEveryEvent: true });
  farm.advanceTo(horizonDay(config));
  return farm.events;
}

/** One kind of animal standing on the farm, and what that group is worth. */
export type HerdGroup = {
  label: string;
  count: number;
  /** What the group is carried at, on the basis the balance sheet foots to. */
  value: number;
};

/**
 * The herd split into the groups a stockperson counts it in, each group priced.
 *
 * A head count says how big a herd is and nothing about what it is worth, and
 * the two are not the same shape: two hundred piglets are worth less than
 * twenty finishers. So the groups carry both.
 *
 * The price is what the books carry the animal at, which is the one figure a
 * farmer can check against what they typed. An animal the farm started with is
 * carried at what its owner said it was worth, plus what has been spent on it
 * since; one born here is carried at what it has cost to rear. Priced instead
 * at what a cull or an abattoir would pay, a sow entered at 300 showed as 200
 * and a boar entered at 10 showed as 200 — the panel quietly revaluing what the
 * farmer had just told it.
 *
 * Added up, the groups come to the livestock line of {@link farmWorthLines}: a
 * panel that splits a total has to foot to it.
 */
export function herdGroups(counts: StageCounts, values: StageValues): HerdGroup[] {
  return [
    { label: "Piglets", count: counts.piglets, value: values.piglets },
    { label: "Weaners", count: counts.weaners, value: values.weaners },
    { label: "Growers", count: counts.growers, value: values.growers },
    { label: "Finishers", count: counts.finishers, value: values.finishers },
    { label: "Gilts", count: counts.gilts, value: values.gilts },
    { label: "Sows in pig", count: counts.gestatingSows, value: values.gestatingSows },
    { label: "Sows suckling", count: counts.lactatingSows, value: values.lactatingSows },
    { label: "Sows to serve", count: counts.openSows, value: values.openSows },
    { label: "Boars", count: counts.boars, value: values.boars },
  ];
}

/** One line of the little balance sheet a day of the plan closes with. */
export type WorthLine = {
  label: string;
  amount: number;
  /** The line the ones above it add up to, rather than another asset. */
  total?: boolean;
};

/**
 * What the farm is worth at the close of a day, as lines that add up to it.
 *
 * The same three questions a farmer asks of a balance sheet — what is standing
 * in the yards, what is standing in the stores, what is in the bank — and then
 * what that comes to once the feed bill is taken off it.
 *
 * Every line is at cost, which is the only basis on which the sheet can agree
 * with itself and with what was typed into it. It used to price the livestock
 * at what it would fetch while taking the suppliers at what is owed them, so
 * one column held two readings of the farm and the animals a farmer had just
 * valued came back at a different figure. Read at cost, the starting flock on
 * day one is exactly what the farmer entered, and every animal since is what it
 * has cost to rear.
 *
 * The debt line is left out on the days there is none, which on the 1.x farm is
 * every day — it pays for its feed as the lorry lands.
 */
export function farmWorthLines(finance: FarmSnapshot["finance"]): WorthLine[] {
  const { inventory, breedingAssets, liabilities } = finance.valuation;
  const livestock =
    inventory.marketLivestock +
    inventory.replacementGilts +
    breedingAssets.sows +
    breedingAssets.boars;
  const owed = liabilities.payables + liabilities.other;
  const lines: WorthLine[] = [
    { label: "Livestock", amount: livestock },
    { label: "Feed and supplies in store", amount: inventory.feed + inventory.supplies },
    // Signed rather than split into cash and an overdraft: the farmer reads one
    // bank balance, and the net worth is the same figure either way.
    { label: "Cash in the bank", amount: finance.cash },
  ];
  if (owed > 0) lines.push({ label: "Owed for goods delivered", amount: -owed });
  lines.push({ label: "Net worth", amount: finance.valuation.netWorth, total: true });
  return lines;
}

/** One line of "what the farm did" over a stretch of days. */
export type FarmPeriodEvent = {
  type:
    | "vaccination"
    | "service"
    | "conception"
    | "growth"
    | "farrowing"
    | "weaning"
    | "sale"
    | "selection"
    | "promotion"
    | "loss"
    | "cull"
    | "purchase"
    | "processing"
    | "scan"
    | "feed";
  label: string;
  count: number;
};

/**
 * Thousands separators without Intl. These labels are built on the server and
 * again in the browser, and the two do not always agree on how to group a
 * number — which shows up as a hydration mismatch rather than a wrong figure.
 */
function grouped(value: number): string {
  return Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

const STAGE_NAMES: Record<PigStage, string> = {
  piglet: "piglets",
  weaner: "weaners",
  grower: "growers",
  finisher: "finishers",
  gilt: "gilts",
};

/** "1 gilt", "4 gilts" — the names above are plural, and one of a thing is not. */
function head(count: number, plural: string): string {
  return count + " " + (count === 1 ? plural.replace(/s$/, "") : plural);
}

/**
 * How the sows were served, and by what. A herd running both channels wants to
 * see the split rather than a total, because the two are not the same cost and
 * not the same genetics.
 */
function serviceLabel(services: number, byAi: number): string {
  const sows = services === 1 ? "sow" : "sows";
  if (byAi === 0) return `Service ${services} ${sows}`;
  if (byAi === services) return `Serve ${services} ${sows} by AI`;
  return `Service ${services} ${sows} · ${byAi} by AI, ${services - byAi} to the boar`;
}

/** Rolls a run of days up into the handful of things worth reading about them. */
function periodEvents(days: DayRecord[]): FarmPeriodEvent[] {
  const sum = (pick: (day: DayRecord) => number) =>
    days.reduce((total, day) => total + pick(day), 0);
  const events: FarmPeriodEvent[] = [];
  const push = (event: FarmPeriodEvent) => {
    if (event.count > 0) events.push(event);
  };

  for (const stage of Object.keys(STAGE_NAMES) as PigStage[]) {
    const count = sum((day) => day.vaccinations[stage]);
    push({ type: "vaccination", label: `Vaccinate ${head(count, STAGE_NAMES[stage])}`, count });
  }

  const services = sum((day) => day.services);
  const aiServices = sum((day) => day.aiServices);
  push({ type: "service", label: serviceLabel(services, aiServices), count: services });

  // What those services came to, read a cycle after they were made.
  const conceptions = sum((day) => day.conceptions);
  push({
    type: "conception",
    label: `${conceptions} ${conceptions === 1 ? "sow is" : "sows are"} confirmed in pig`,
    count: conceptions,
  });
  // A return that came back on the cycle is a service that did not take; one
  // that came back late is an embryo lost. They cost a herd differently, so the
  // day says which it was rather than reporting one number for both.
  const returns = sum((day) => day.returnsToHeat);
  const irregular = sum((day) => day.irregularReturns);
  push({
    type: "service",
    label:
      `${returns} ${returns === 1 ? "sow returns" : "sows return"} to heat, to be served again` +
      (irregular > 0 ? ` · ${irregular} late` : ""),
    count: returns,
  });

  const scans = sum((day) => day.scans);
  push({
    type: "scan",
    label: `Scan ${head(scans, "sows")} · ${conceptions} in pig`,
    count: scans,
  });

  const farrowings = sum((day) => day.farrowings);
  const bornAlive = sum((day) => day.bornAlive);
  push({
    type: "farrowing",
    label: `${farrowings} ${farrowings === 1 ? "sow farrows" : "sows farrow"} · ${bornAlive} born alive`,
    count: farrowings,
  });

  const weaned = sum((day) => day.weaned);
  push({ type: "weaning", label: `Wean ${head(weaned, "piglets")}`, count: weaned });

  // Growing pigs crossing from one stage into the next.
  const toGrower = sum((day) => day.movedToGrower);
  push({
    type: "growth",
    label: `${toGrower} ${toGrower === 1 ? "weaner becomes a grower" : "weaners become growers"}`,
    count: toGrower,
  });
  const toFinisher = sum((day) => day.movedToFinisher);
  push({
    type: "growth",
    label: `${toFinisher} ${toFinisher === 1 ? "grower becomes a finisher" : "growers become finishers"}`,
    count: toFinisher,
  });

  const sold = sum((day) => day.sold);
  push({ type: "sale", label: `Sell ${head(sold, "market pigs")}`, count: sold });
  const giltsSold = sum((day) => day.giltsSold);
  push({ type: "sale", label: `Sell ${head(giltsSold, "breeding gilts")}`, count: giltsSold });

  const selected = sum((day) => day.giltsSelected);
  push({ type: "selection", label: `Select ${head(selected, "replacement gilts")}`, count: selected });
  const promoted = sum((day) => day.giltsPromoted);
  push({ type: "promotion", label: `Move ${head(promoted, "gilts")} into the sow herd`, count: promoted });

  // One day shows the lorry itself, order list and all; a whole month shows how
  // many times it came.
  if (days.length === 1) {
    for (const trip of days[0].deliveries) {
      const order = trip.lines
        .filter((line) => line.kg >= 0.5)
        .map((line) => `${STORE_LABELS[line.store]} ${grouped(line.kg)} kg`)
        .join(", ");
      push({
        type: "feed",
        label: `${trip.kind === "bedding" ? "Bedding lorry" : "Lorry"} in, ${grouped(trip.payloadKg)} kg: ${order}`,
        count: 1,
      });
    }
  } else {
    const loads = sum((day) => day.lorriesIn);
    const loadKg = sum((day) => day.feedDeliveredKg);
    push({
      type: "feed",
      label: `Take in ${loads} ${loads === 1 ? "lorry" : "lorries"} · ${grouped(loadKg)} kg of feed`,
      count: loads,
    });
  }


  // Iron, identification, castration and the rest, each named and counted.
  const jobs = new Map<string, number>();
  for (const day of days) {
    for (const [job, count] of Object.entries(day.processing)) {
      jobs.set(job, (jobs.get(job) ?? 0) + count);
    }
  }
  for (const [job, count] of jobs) {
    push({ type: "processing", label: `${job} · ${head(count, "piglets")}`, count });
  }

  const losses = sum((day) => day.pigletDeaths + day.growingDeaths + day.breedingDeaths);
  // "loss" does not lose its s the way the other names do.
  push({
    type: "loss",
    label: `Record ${losses} stock ${losses === 1 ? "loss" : "losses"}`,
    count: losses,
  });
  const culled = sum((day) => day.sowsCulled);
  push({ type: "cull", label: `Cull ${culled} ${culled === 1 ? "sow" : "sows"}`, count: culled });
  const purchased = sum((day) => day.giltsPurchased);
  push({ type: "purchase", label: `Buy ${head(purchased, "replacement gilts")}`, count: purchased });

  return events;
}

/** A single dated square on the calendar, and everything its panel shows. */
export type FarmCalendarDay = {
  day: number;
  date: string;
  /** Head standing on the farm when the day closed. */
  total: number;
  sold: number;
  bornAlive: number;
  deaths: number;
  /** Lorries through the gate, whatever they were carrying. */
  lorriesIn: number;
  cashIn: number;
  cashOut: number;
  netCashFlow: number;
  closingCash: number;
  /** The herd split by stage and by what each sow is doing on the day. */
  counts: StageCounts;
  events: FarmPeriodEvent[];
};

/**
 * A timeline period's money, read off the cash book. On the 1.x farm the cash
 * book and the profit and loss are the same numbers; reading through
 * {@link cashTotalsOf} is what keeps a panel headed "money in and out" honest
 * when the same timeline is fed by an engine for which they are not.
 */

/** A month of the plan, for reading the same timeline zoomed out. */
export type FarmCalendarMonth = {
  index: number;
  /** First day of the month, and the last day of it the plan covers. */
  date: string;
  endDate: string;
  label: string;
  total: number;
  sold: number;
  bornAlive: number;
  weaned: number;
  deaths: number;
  /** Lorries through the gate, whatever they were carrying. */
  lorriesIn: number;
  /** The month's receipts and payments, line by line. */
  totals: CategoryTotals;
  cashIn: number;
  cashOut: number;
  netCashFlow: number;
  closingCash: number;
  events: FarmPeriodEvent[];
};

export type FarmTimeline = {
  days: FarmCalendarDay[];
  months: FarmCalendarMonth[];
};

/**
 * The whole plan day by day, and the same days grouped into months, off a 1.x
 * farm of its own. The pages read a plan through `lib/simulation`, which runs
 * whichever engine the plan is set to once and takes the timeline off that; this
 * is the 1.x reference the tests hold it against.
 */
export function farmTimeline(config: PlannerConfig): FarmTimeline {
  const farm = new Farm(config);
  farm.advanceTo(horizonDay(config));
  return timelineOf(config, farm.history, (date) => farm.dayOf(date));
}

/**
 * The same timeline, built off a daily record rather than off a farm.
 *
 * The 2.0 engine writes a superset of the 1.x day, so the calendar, the month
 * roll-up and every sentence in a day's panel come out of this one function for
 * either engine. Reading a plan is not something an engine should have an
 * opinion about: two implementations of this would differ on the small things —
 * which day a month ends on, whether a lorry is listed or counted — and a person
 * comparing the two would be reading the difference between two read-outs rather
 * than between two farms.
 */
export function timelineOf(
  config: PlannerConfig,
  history: readonly DayRecord[],
  dayOf: (date: Date) => number,
): FarmTimeline {
  const days: FarmCalendarDay[] = history.map((record) => ({
    day: record.day,
    date: record.date,
    total: record.counts.total,
    sold: record.sold,
    bornAlive: record.bornAlive,
    deaths: record.pigletDeaths + record.growingDeaths + record.breedingDeaths,
    lorriesIn: record.lorriesIn,
    cashIn: incomeOf(cashTotalsOf(record)),
    cashOut: expensesOf(cashTotalsOf(record)),
    netCashFlow: record.netCashFlow,
    closingCash: record.closingCash,
    counts: record.counts,
    events: periodEvents([record]),
  }));

  const start = parseISO(config.project.startDate);
  const months: FarmCalendarMonth[] = [];
  // The history is in day order and the months are walked in day order with it,
  // so each month's run of days is found by carrying on from where the last one
  // ended. Filtering the whole history once a month reads the same days over
  // again — sixty times for a five year plan, and the last month of it pays for
  // all five years.
  let from = 0;
  for (let index = 0; index < config.project.months; index += 1) {
    const monthStart = addMonths(start, index);
    const firstDay = dayOf(monthStart);
    const lastDay = dayOf(addMonths(start, index + 1)) - 1;
    while (from < history.length && history[from].day < firstDay) from += 1;
    let to = from;
    while (to < history.length && history[to].day <= lastDay) to += 1;
    const records = history.slice(from, to);
    from = to;
    if (records.length === 0) continue;
    const sum = (pick: (day: DayRecord) => number) =>
      records.reduce((total, day) => total + pick(day), 0);
    const last = records[records.length - 1];
    const totals = emptyTotals();
    for (const record of records) addTotals(totals, cashTotalsOf(record));
    months.push({
      index,
      date: format(monthStart, "yyyy-MM-dd"),
      endDate: last.date,
      label: format(monthStart, "MMMM yyyy"),
      total: last.counts.total,
      sold: sum((day) => day.sold),
      bornAlive: sum((day) => day.bornAlive),
      weaned: sum((day) => day.weaned),
      deaths: sum((day) => day.pigletDeaths + day.growingDeaths + day.breedingDeaths),
      lorriesIn: sum((day) => day.lorriesIn),
      totals,
      cashIn: incomeOf(totals),
      cashOut: expensesOf(totals),
      netCashFlow: sum((day) => day.netCashFlow),
      closingCash: last.closingCash,
      events: periodEvents(records),
    });
  }

  return { days, months };
}
