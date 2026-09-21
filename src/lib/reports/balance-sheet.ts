import type { Workbook } from "exceljs";

import type { PlannerConfig } from "../config";
import { farmValuation, ZERO_BALANCES, type FarmValuation } from "../sim/accounting";
import { daySnapshotAt, type PlanSimulationResult } from "../simulation-result";
import { monthPeriods, provenance, reportingPeriod, yearPeriods, type ReportPeriod } from "./periods";
import { monthCellDate } from "./sheet";
import { addStatementSheet, type StatementRow } from "./statement";

/**
 * The projected balance sheet, at cost.
 *
 * Same basis as the experimental farm worth view, and for the same reason: an
 * unsold pig has earned the farm nothing, so it is carried at what has been
 * spent on it and not at what the abattoir would pay. Valuing the standing herd
 * at sale price would book the profit before the lorry came, and would make a
 * plan that is merely full of pigs look like a plan that is making money.
 *
 * Nothing is valued here. Every month end is the valuation the run itself
 * closed that day with — {@link FarmValuation}, assembled by `lib/sim/accounting`
 * from the animals, the stores and the ledger — read back out of the simulation
 * result. The closing sheet is therefore the same object the money page shows as
 * `projection.farmWorth`, not a second reading of it.
 *
 * Buildings are not on it. The model carries the places a farm has as a
 * constraint on the herd rather than as an asset, so a sheet that listed them
 * would be listing something the simulation never costed.
 */

/** The farm at one moment, and what to call that moment. */
export type BalanceSheetPoint = {
  key: string;
  label: string;
  /** What the period covers, for a heading that is read rather than scanned. */
  span: string;
  /** The first day of the period, and the day the position is as at. */
  startDate: string;
  date: string;
  worth: FarmValuation;
};

export type BalanceSheetReport = {
  config: PlannerConfig;
  period: string;
  /** What the farm was standing on before the first day ran. */
  opening: BalanceSheetPoint;
  months: BalanceSheetPoint[];
  /** Each plan year at its close. */
  years: BalanceSheetPoint[];
  /** The last month end, which is the plan's closing position. */
  closing: BalanceSheetPoint;
};

/** The balance sheet the plan opened on, before a single day was simulated. */
function openingPoint(result: PlanSimulationResult): BalanceSheetPoint {
  const config = result.config;
  const first = result.projection.months[0];
  return {
    key: "opening",
    label: "Opening",
    span: "Before day one",
    startDate: config.project.startDate,
    date: config.project.startDate,
    // The opening herd and stores as the second set of books recorded them, at
    // the cash the farmer said they were starting with. Assembled through the
    // same helper every other column uses, so the opening column cannot be on a
    // different basis from the ones beside it.
    worth: farmValuation({
      cash: config.project.openingCash,
      feedValue: 0,
      suppliesValue: 0,
      balances: first ? first.accounting.opening : ZERO_BALANCES,
      payables: 0,
    }),
  };
}

/** Where a period closed, read off the day the plan actually ended it on. */
function pointOf(result: PlanSimulationResult, period: ReportPeriod): BalanceSheetPoint {
  return {
    key: period.key,
    label: period.label,
    span: period.span,
    startDate: period.startDate,
    date: period.endDate,
    worth: daySnapshotAt(result, period.endDate + "T23:00").finance.valuation,
  };
}

export function balanceSheetReport(result: PlanSimulationResult): BalanceSheetReport {
  const months = monthPeriods(result).map((period) => pointOf(result, period));
  const opening = openingPoint(result);
  return {
    config: result.config,
    period: reportingPeriod(result.config),
    opening,
    months,
    years: yearPeriods(result).map((period) => pointOf(result, period)),
    closing: months[months.length - 1] ?? opening,
  };
}

// ------------------------------------------------------------- the worksheets

export const BALANCE_SHEET_ROWS: StatementRow<BalanceSheetPoint>[] = [
  { kind: "section", label: "ASSETS" },
  { kind: "line", label: "Cash at bank", value: (p) => p.worth.cash },
  { kind: "line", label: "Feed in store", value: (p) => p.worth.inventory.feed },
  {
    kind: "line",
    label: "Other supplies and freight held",
    value: (p) => p.worth.inventory.supplies,
  },
  {
    kind: "line",
    label: "Market livestock, at cost",
    value: (p) => p.worth.inventory.marketLivestock,
  },
  {
    kind: "line",
    label: "Replacement gilts, at cost",
    value: (p) => p.worth.inventory.replacementGilts,
  },
  { kind: "line", label: "Breeding sows", value: (p) => p.worth.breedingAssets.sows },
  { kind: "line", label: "Boars", value: (p) => p.worth.breedingAssets.boars },
  { kind: "total", label: "Total assets", value: (p) => p.worth.totalAssets },
  { kind: "blank" },
  { kind: "section", label: "LIABILITIES" },
  { kind: "line", label: "Owed to suppliers", value: (p) => p.worth.liabilities.payables },
  {
    kind: "line",
    label: "Overdraft / funding deficit",
    value: (p) => p.worth.liabilities.overdraft,
  },
  { kind: "line", label: "Other liabilities", value: (p) => p.worth.liabilities.other },
  { kind: "total", label: "Total liabilities", value: (p) => p.worth.totalLiabilities },
  { kind: "blank" },
  { kind: "result", label: "FARM NET WORTH", value: (p) => p.worth.netWorth },
];

const NOTES = [
  "Every figure is at cost. Unsold livestock is carried at what has been spent rearing it, never at expected sale price: an animal still in a pen has earned nothing, and valuing it at what the abattoir might pay would book the profit before the lorry came.",
  "A bank balance below zero is shown as an overdraft on the liabilities side rather than as negative cash, so a plan being funded reads as borrowed against rather than as smaller than it is. Net worth is the same figure either way.",
  "Buildings and land are not included. The model carries the places a farm has as a constraint on herd size rather than as an asset, so it has never costed them.",
  "The opening column is the position before the first simulated day: the cash entered on the plan and the starting stock at the value entered for it.",
];

export function addBalanceSheetSheets(
  workbook: Workbook,
  report: BalanceSheetReport,
  generatedAt: Date,
): void {
  const name = report.config.project.name;
  const subtitle = provenance(report.config, generatedAt);

  addStatementSheet(workbook, {
    name: "Balance Sheet",
    tabColor: "8E7CC3",
    title: `${name} — projected balance sheet`,
    subtitle,
    heading: (point) => point.label,
    // Opening beside each year end and the closing position: the comparison a
    // reader makes first is what the plan started with against what it ends on.
    periods: [report.opening, ...report.years],
    rows: BALANCE_SHEET_ROWS,
    labelWidth: 38,
    columnWidth: 18,
    footer: "Projected balance sheet — annual",
    notes: NOTES,
  });

  addStatementSheet(workbook, {
    name: "Balance Sheet Monthly",
    tabColor: "B4A7D6",
    title: `${name} — projected balance sheet, month end by month end`,
    subtitle,
    heading: (point) =>
      point.key === "opening" ? "Opening" : monthCellDate(point.startDate),
    periods: [report.opening, ...report.months],
    rows: BALANCE_SHEET_ROWS,
    labelWidth: 38,
    footer: "Projected balance sheet — monthly",
    notes: NOTES,
  });
}
