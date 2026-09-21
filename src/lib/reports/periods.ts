import { addMonths, format, parseISO } from "date-fns";

import { mergeAccounting, type PeriodAccounting } from "../accounts";
import type { PlannerConfig } from "../config";
import type { MonthlyProjection, ProjectionResult } from "../model";
import { addTotals, emptyTotals, type CategoryTotals } from "../sim";
import { inventoryTotal } from "../sim/accounting";
import type { PlanSimulationResult } from "../simulation-result";

/**
 * A stretch of the plan that a report puts in a column.
 *
 * Every report here reads months, plan years and the whole horizon, and all
 * three are the same thing at three lengths: a run of consecutive months, with
 * the ledger totals and the second set of books that belong to them. Rolling
 * them up once, here, is what stops a plan year on the profit statement being
 * assembled differently from a plan year on the herd plan.
 *
 * Nothing is recalculated. The totals are added, the books are merged through
 * `lib/accounts`, and the closing figures are read off the last month — which
 * is the same arithmetic `summariseYears` already does for the pages.
 */
export type ReportPeriod = {
  key: string;
  /** What a column heading calls it: "Jan 27", "Year 1", "Whole plan". */
  label: string;
  /** And what a page heading calls it: "January 2027", "Jan 2027 – Dec 2027". */
  span: string;
  /** First of the first month, and the last day of the period the plan covers. */
  startDate: string;
  endDate: string;
  /** The months it covers, in plan order. Never empty. */
  months: readonly MonthlyProjection[];
  /** Earned and consumed over the period. */
  totals: CategoryTotals;
  /** The same period through the second set of books. */
  accounting: PeriodAccounting;
  /**
   * What the farm was worth at cost going into the period and coming out of it.
   *
   * Carried on the period so that a trading statement can foot to the balance
   * sheet without either of them working the other one out. The two are the
   * same figure the money page shows as `month.netWorth`.
   */
  openingNetWorth: number;
  closingNetWorth: number;
  /**
   * Goods standing in the stores at each end, and what was owed for them.
   *
   * These are what reconciles the profit statement to the balance sheet. A
   * lorryload is bought on one day, eaten over the following weeks and paid for
   * on its own terms, and until all three have happened the farm's worth has
   * moved by something the profit statement has not seen yet.
   */
  openingStoreValue: number;
  closingStoreValue: number;
  openingPayables: number;
  closingPayables: number;
};

export type Grain = "month" | "year";

/**
 * What the farm was worth at cost before its first day ran: the cash entered on
 * the plan plus the starting stock at the value entered for it. The same figure
 * `lib/simulation` measures `changeInFarmWorth` against, read from one place so
 * an opening balance sheet and an opening profit statement cannot differ.
 */
export function openingWorthOf(result: PlanSimulationResult): number {
  return (
    result.config.project.openingCash + inventoryTotal(result.projection.accounting.opening)
  );
}

/** The last day of a month the plan actually simulated. */
function endOfMonth(result: PlanSimulationResult, month: MonthlyProjection): string {
  const simulated = result.timeline.months.find((entry) => entry.index === month.index);
  if (simulated) return simulated.endDate;
  // A month the timeline has no days for — an empty plan — ends where it starts.
  return month.date;
}

function periodOf(
  key: string,
  label: string,
  months: readonly MonthlyProjection[],
  endDate: string,
  /** The plan as a whole, for reading what stood before this period opened. */
  result: PlanSimulationResult,
): ReportPeriod {
  const totals = emptyTotals();
  for (const month of months) addTotals(totals, month.totals);
  const first = months[0];
  const last = months[months.length - 1];
  const before = result.projection.months[first.index - 1] ?? null;
  return {
    openingNetWorth: before ? before.netWorth : openingWorthOf(result),
    closingNetWorth: last.netWorth,
    openingStoreValue: before ? before.storeValue : 0,
    closingStoreValue: last.storeValue,
    openingPayables: before ? before.payables : 0,
    closingPayables: last.payables,
    key,
    label,
    span:
      months.length === 1
        ? format(parseISO(first.date), "MMMM yyyy")
        : format(parseISO(first.date), "MMM yyyy") +
          " – " +
          format(parseISO(last.date), "MMM yyyy"),
    startDate: first.date,
    endDate,
    months,
    totals,
    accounting: mergeAccounting(months.map((month) => month.accounting)),
  };
}

/** One column per month of the plan. */
export function monthPeriods(result: PlanSimulationResult): ReportPeriod[] {
  return result.projection.months.map((month) =>
    periodOf(month.date, month.month, [month], endOfMonth(result, month), result),
  );
}

/**
 * One column per plan year. The years come off the projection rather than being
 * cut again here, so a report and the money page agree on where a year ends —
 * including the last one, which on a horizon that is not a whole number of years
 * is shorter than the rest.
 */
export function yearPeriods(result: PlanSimulationResult): ReportPeriod[] {
  const byIndex = new Map(result.projection.months.map((month) => [month.index, month]));
  const periods: ReportPeriod[] = [];
  for (const year of result.projection.years) {
    const months = year.months
      .map((index) => byIndex.get(index))
      .filter((month): month is MonthlyProjection => month !== undefined);
    if (months.length === 0) continue;
    periods.push(
      periodOf(
        year.key,
        year.label,
        months,
        endOfMonth(result, months[months.length - 1]),
        result,
      ),
    );
  }
  return periods;
}

/** The whole horizon as one period, which is what a report's last column is. */
export function wholePlanPeriod(result: PlanSimulationResult): ReportPeriod | null {
  const months = result.projection.months;
  if (months.length === 0) return null;
  return periodOf(
    "whole-plan",
    "Whole plan",
    months,
    endOfMonth(result, months[months.length - 1]),
    result,
  );
}

export function periodsAt(result: PlanSimulationResult, grain: Grain): ReportPeriod[] {
  return grain === "month" ? monthPeriods(result) : yearPeriods(result);
}

/**
 * The stretch of time a report covers, for the line under its title and for the
 * card that offers it. Read off the plan's own start and horizon rather than off
 * the months, so a report says what it set out to cover even when it has nothing
 * in it yet.
 */
export function reportingPeriod(config: PlannerConfig): string {
  const start = parseISO(config.project.startDate);
  const end = addMonths(start, Math.max(1, config.project.months) - 1);
  return format(start, "MMM yyyy") + " – " + format(end, "MMM yyyy");
}

/** Everything a report's title block says about where the figures came from. */
export function provenance(config: PlannerConfig, generatedAt: Date): string {
  return (
    `${config.project.months}-month simulated plan from ${config.project.startDate} · ` +
    `${config.project.currency} · seed ${config.project.seed} · ` +
    `${config.project.variation === "settled" ? "settled planning case" : "one drawn outcome"} · ` +
    `prepared ${generatedAt.toLocaleDateString("en-GB")}`
  );
}

/** The whole-plan ledger totals, for anything that wants the horizon at once. */
export function horizonTotals(projection: ProjectionResult): CategoryTotals {
  const totals = emptyTotals();
  for (const month of projection.months) addTotals(totals, month.totals);
  return totals;
}
