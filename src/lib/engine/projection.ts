import { addMonths, parseISO } from "date-fns";

import type { PlannerConfig } from "../config";
import {
  buildWarnings,
  summariseMonth,
  summariseYears,
  type MonthlyProjection,
  type ProjectionResult,
  type ProjectionSummary,
} from "../model";
import type { DayRecord } from "../sim";
import { Engine, engineHorizonDay } from "./engine";

/**
 * The 2.0 engine's run, rolled up into the same monthly projection the rest of
 * the product reads.
 *
 * Keeping the shape identical is deliberate. The cashflow page, the workbook,
 * the comparison tool and the funding planner should not have to know which
 * engine produced a plan — and if they did, no one could put the two side by
 * side, which is the only way a rewrite gets validated. The daily record the 2.0
 * engine writes is a superset of the 1.x one, so it rolls up through exactly the
 * same code.
 */
export function engineProjection(config: PlannerConfig): ProjectionResult {
  const engine = new Engine(config).advanceTo(engineHorizonDay(config));
  const world = engine.world;

  const start = parseISO(config.project.startDate);
  const byDay = new Map(world.history.map((day) => [day.day, day]));
  const months: MonthlyProjection[] = [];

  for (let index = 0; index < config.project.months; index += 1) {
    const monthStart = addMonths(start, index);
    const firstDay = world.dayOf(monthStart);
    const lastDay = world.dayOf(addMonths(start, index + 1)) - 1;
    const days: DayRecord[] = [];
    for (let day = firstDay; day <= lastDay; day += 1) {
      const record = byDay.get(day);
      if (record) days.push(record);
    }
    months.push(summariseMonth(index, monthStart, days));
  }

  const valuation = engine.valuation();
  const sum = (pick: (month: MonthlyProjection) => number) =>
    months.reduce((total, month) => total + pick(month), 0);

  const totalCost = sum((month) => month.totalCost);
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
  const years = config.project.months / 12;

  const summary: ProjectionSummary = {
    totalRevenue: sum((month) => month.revenue),
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
      averageSows > 0 && years > 0 ? world.lifetime.weaned / (averageSows * years) : 0,
    littersPerSowYear:
      averageSows > 0 && years > 0 ? world.lifetime.litters / (averageSows * years) : 0,
    averageSows,
    finalSows: months.at(-1)?.sows ?? 0,
    peakHeadCount: Math.max(0, ...months.map((month) => month.peakHead)),
    firstPositiveMonth:
      months.find((month) => month.closingCash >= 0 && month.index > 0)?.month ?? null,
    herdValueAtEnd: valuation.herdValue,
    netWorthAtEnd: valuation.netWorth,
  };

  return {
    months,
    years: summariseYears(months, start),
    summary,
    generations: engine.generationReport(),
    costOfProduction: engine.costOfProduction(),
    warnings: buildWarnings(config, summary, world.lifetime),
  };
}
