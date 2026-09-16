import { addMonths, differenceInCalendarDays, format, parseISO } from "date-fns";

import type { PlannerConfig } from "../config";
import { Farm } from "./farm";
import type { DayRecord, StockAgeGroup } from "./farm";
import type { PigStage } from "./animals";

export * from "./animals";
export * from "./farm";
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

export type FarmWeek = {
  week: number;
  startDate: string;
  day: number;
  date: string;
  total: number;
  groups: StockAgeGroup[];
  events: FarmWeekEvent[];
};

export type FarmWeekEvent = {
  type:
    | "vaccination"
    | "service"
    | "farrowing"
    | "weaning"
    | "sale"
    | "selection"
    | "promotion"
    | "loss"
    | "cull"
    | "purchase";
  label: string;
  count: number;
};

const STAGE_NAMES: Record<PigStage, string> = {
  piglet: "piglets",
  weaner: "weaners",
  grower: "growers",
  finisher: "finishers",
  gilt: "gilts",
};

function weekEvents(days: DayRecord[]): FarmWeekEvent[] {
  const sum = (pick: (day: DayRecord) => number) =>
    days.reduce((total, day) => total + pick(day), 0);
  const events: FarmWeekEvent[] = [];
  const push = (event: FarmWeekEvent) => {
    if (event.count > 0) events.push(event);
  };

  for (const stage of Object.keys(STAGE_NAMES) as PigStage[]) {
    const count = sum((day) => day.vaccinations[stage]);
    push({ type: "vaccination", label: `Vaccinate ${count} ${STAGE_NAMES[stage]}`, count });
  }

  const services = sum((day) => day.services);
  push({ type: "service", label: `Service ${services} ${services === 1 ? "sow" : "sows"}`, count: services });

  const farrowings = sum((day) => day.farrowings);
  const bornAlive = sum((day) => day.bornAlive);
  push({
    type: "farrowing",
    label: `${farrowings} ${farrowings === 1 ? "sow farrows" : "sows farrow"} · ${bornAlive} born alive`,
    count: farrowings,
  });

  const weaned = sum((day) => day.weaned);
  push({ type: "weaning", label: `Wean ${weaned} piglets`, count: weaned });

  const sold = sum((day) => day.sold);
  push({ type: "sale", label: `Sell ${sold} market pigs`, count: sold });
  const giltsSold = sum((day) => day.giltsSold);
  push({ type: "sale", label: `Sell ${giltsSold} breeding gilts`, count: giltsSold });

  const selected = sum((day) => day.giltsSelected);
  push({ type: "selection", label: `Select ${selected} replacement gilts`, count: selected });
  const promoted = sum((day) => day.giltsPromoted);
  push({ type: "promotion", label: `Move ${promoted} gilts into the sow herd`, count: promoted });

  const losses = sum((day) => day.pigletDeaths + day.growingDeaths + day.breedingDeaths);
  push({ type: "loss", label: `Record ${losses} stock losses`, count: losses });
  const culled = sum((day) => day.sowsCulled);
  push({ type: "cull", label: `Cull ${culled} ${culled === 1 ? "sow" : "sows"}`, count: culled });
  const purchased = sum((day) => day.giltsPurchased);
  push({ type: "purchase", label: `Buy ${purchased} replacement gilts`, count: purchased });

  return events;
}

/**
 * Week-end stock snapshots for the whole plan. The farm advances once from left
 * to right, so a long timeline does not rebuild the simulation for every week.
 */
export function farmWeeklyTimeline(config: PlannerConfig): FarmWeek[] {
  const farm = new Farm(config);
  const finalDay = horizonDay(config);
  const weeks: FarmWeek[] = [];

  for (let firstDay = 0, week = 1; firstDay <= finalDay; firstDay += 7, week += 1) {
    const day = Math.min(firstDay + 6, finalDay);
    farm.advanceTo(day);
    const groups = farm.stockAgeGroups();
    const days = farm.history.slice(firstDay, day + 1);
    weeks.push({
      week,
      startDate: format(farm.dateOf(firstDay), "yyyy-MM-dd"),
      day,
      date: format(farm.dateOf(day), "yyyy-MM-dd"),
      total: groups.reduce((sum, group) => sum + group.count, 0),
      groups,
      events: weekEvents(days),
    });
  }

  return weeks;
}
