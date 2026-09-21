import type { Workbook } from "exceljs";

import {
  currentProfitOrLoss,
  financingOf,
  inventoryAdjustedPnL,
  inventoryAdjustedProfit,
  reconcileProfit,
  type InventoryAdjustedPnL,
} from "../accounts";
import type { PlannerConfig } from "../config";
import {
  addTotals,
  CATEGORY_LABELS,
  emptyTotals,
  expensesOf,
  incomeOf,
  type CategoryTotals,
  type LedgerCategory,
} from "../sim";
import type { PlanSimulationResult } from "../simulation-result";
import {
  monthPeriods,
  provenance,
  reportingPeriod,
  wholePlanPeriod,
  yearPeriods,
  type ReportPeriod,
} from "./periods";
import { monthCellDate } from "./sheet";
import { addStatementSheet, type StatementRow } from "./statement";

/**
 * The projected profit and loss, month by month and year by year.
 *
 * Two statements of the same run, side by side and never added together. The
 * first is income less expenditure, which is the figure the plan has always
 * shown and the one the money page still reads. The second holds back the costs
 * that turned into animals still standing in a pen until those animals leave,
 * which is the only way to tell a farm that is losing money from a farm that is
 * building a herd.
 *
 * Neither is worked out here. `lib/accounts` owns both, and this arranges what
 * it returns into lines a farmer would ask for by name. That matters more than
 * it sounds: the moment a report does its own subtraction, the document a bank
 * is sent can disagree with the screen it was read off.
 */

/** The cost lines a farmer asks for by name. */
export type CostLine =
  | "feed"
  | "health"
  | "breeding"
  | "labour"
  | "transport"
  | "overheads";

/**
 * Which line each ledger category falls in.
 *
 * Written as a total function of the ledger rather than as six lists, so adding
 * a category to `lib/sim/ledger` is a type error here rather than a cost that
 * quietly stops being reported. Every expense has exactly one line, which is
 * what makes the six lines foot to the ledger's own total with no residual.
 */
const COST_LINE_OF = {
  "pig-sales": null,
  "gilt-sales": null,
  "cull-sales": null,
  "other-income": null,
  "feed-sow": "feed",
  "feed-creep": "feed",
  "feed-weaner": "feed",
  "feed-grower": "feed",
  "feed-finisher": "feed",
  bedding: "overheads",
  gas: "overheads",
  deliveries: "transport",
  vaccination: "health",
  processing: "health",
  veterinary: "health",
  labour: "labour",
  overheads: "overheads",
  transport: "transport",
  "breeding-stock": "breeding",
  semen: "breeding",
  contingency: "overheads",
  capital: "overheads",
} satisfies Record<LedgerCategory, CostLine | null>;

export const COST_LINE_LABELS: Record<CostLine, string> = {
  feed: "Feed",
  health: "Veterinary & health",
  breeding: "Breeding costs",
  labour: "Labour",
  transport: "Transport & procurement",
  overheads: "Overheads, bedding & utilities",
};

export const COST_LINES = Object.keys(COST_LINE_LABELS) as CostLine[];

/** What a line is made of, for the note that explains it. */
export function costLineContents(line: CostLine): string {
  return (Object.entries(COST_LINE_OF) as [LedgerCategory, CostLine | null][])
    .filter(([, key]) => key === line)
    .map(([category]) => CATEGORY_LABELS[category].toLowerCase())
    .join(", ");
}

export type CostLines = Record<CostLine, number> & { total: number };

/** One period as a trading statement, read both ways. */
export type TradingStatement = {
  key: string;
  label: string;
  span: string;
  startDate: string;
  endDate: string;
  revenue: {
    pigSales: number;
    giltSales: number;
    cullSales: number;
    /** Other income with any generated funding injection taken back out. */
    otherIncome: number;
    total: number;
  };
  operatingCosts: CostLines;
  /** Income less expenditure: the statement the plan has always shown. */
  operatingProfit: number;
  /** The same period with unsold animals held back. See `lib/accounts`. */
  inventoryAdjusted: InventoryAdjustedPnL;
  /** What the second statement sees that the first does not. */
  changeInFarmInventory: number;
  /**
   * Money the funding buttons moved, which is not trading and is kept out of
   * every profit figure above. Shown so a reader can see that it was.
   */
  financing: { in: number; out: number };
  netCashFlow: number;
  closingCash: number;
  /**
   * How the period's profit becomes the movement in the balance sheet.
   *
   * The identity a reader is entitled to check is that closing net worth is
   * opening net worth plus what the farm made plus what its owner put in. It
   * does not close on its own, and the reason is timing rather than error: a
   * lorryload of feed is bought on one day, eaten over the following weeks and
   * paid for on its own terms. Between those dates the farm is holding
   * something the trading statement has not charged for yet, and on the 1.x
   * engine — which pays for feed as it is eaten — that is the whole of the gap.
   *
   * Printing the term rather than leaving it as a rounding difference is the
   * point. It is the difference between a statement that foots and a statement
   * that nearly foots, and the second is the one nobody can sign.
   */
  reconciliation: {
    openingNetWorth: number;
    /** The inventory-adjusted profit, which is what moves net worth. */
    profit: number;
    /** What the owner put in, less what was taken out. */
    financingNet: number;
    /** Goods bought and not yet charged, less what is still owed for them. */
    goodsHeldTiming: number;
    closingNetWorth: number;
  };
};

/**
 * The timing term that closes the gap between the trading statement and the
 * balance sheet.
 *
 * Derived rather than plugged: it is what the cash book and the profit and loss
 * disagree about over the period, plus the movement in goods standing in the
 * stores, less the movement in what is owed for them. On the accrual engine
 * every one of those cancels and the term is zero; on the 1.x engine, which
 * posts a cost on the day it is paid, it is the movement in the stores.
 */
function goodsHeldTiming(period: ReportPeriod): number {
  const cashTotals = emptyTotals();
  for (const month of period.months) addTotals(cashTotals, month.cashTotals);
  const incomeTiming = incomeOf(cashTotals) - incomeOf(period.totals);
  const expenseTiming = expensesOf(period.totals) - expensesOf(cashTotals);
  const store = period.closingStoreValue - period.openingStoreValue;
  const owed = period.closingPayables - period.openingPayables;
  return incomeTiming + expenseTiming + store - owed;
}

function costLinesOf(totals: CategoryTotals, financingOut: number): CostLines {
  const lines: CostLines = {
    feed: 0,
    health: 0,
    breeding: 0,
    labour: 0,
    transport: 0,
    overheads: 0,
    total: 0,
  };
  for (const [category, line] of Object.entries(COST_LINE_OF) as [
    LedgerCategory,
    CostLine | null,
  ][]) {
    if (line === null) continue;
    lines[line] += totals[category];
    lines.total += totals[category];
  }
  // A generated withdrawal was posted to fixed overheads so the cash book would
  // balance. Taking a surplus out of the business is not a cost of keeping pigs.
  lines.overheads -= financingOut;
  lines.total -= financingOut;
  return lines;
}

export function tradingStatement(period: ReportPeriod): TradingStatement {
  const { totals, accounting } = period;
  const financing = financingOf(accounting);
  const revenue = {
    pigSales: totals["pig-sales"],
    giltSales: totals["gilt-sales"],
    cullSales: totals["cull-sales"],
    // And a generated injection was posted to other income, for the same
    // reason. The owner putting money in is income on nobody's statement.
    otherIncome: totals["other-income"] - financing.in,
    total: 0,
  };
  revenue.total =
    revenue.pigSales + revenue.giltSales + revenue.cullSales + revenue.otherIncome;

  const months = period.months;
  return {
    key: period.key,
    label: period.label,
    span: period.span,
    startDate: period.startDate,
    endDate: period.endDate,
    revenue,
    operatingCosts: costLinesOf(totals, financing.out),
    // The one calculation, not a second one that ought to agree with it.
    operatingProfit: currentProfitOrLoss(totals, accounting),
    inventoryAdjusted: inventoryAdjustedPnL(totals, accounting),
    changeInFarmInventory: reconcileProfit(totals, accounting).changeInFarmInventory,
    financing,
    netCashFlow: months.reduce((sum, month) => sum + month.netCashFlow, 0),
    closingCash: months[months.length - 1].closingCash,
    reconciliation: {
      openingNetWorth: period.openingNetWorth,
      profit: inventoryAdjustedProfit(totals, accounting),
      financingNet: financing.in - financing.out,
      goodsHeldTiming: goodsHeldTiming(period),
      closingNetWorth: period.closingNetWorth,
    },
  };
}

/** The whole report: the same statement at both lengths. */
export type ProfitAndLossReport = {
  config: PlannerConfig;
  period: string;
  months: TradingStatement[];
  years: TradingStatement[];
  /** The horizon as one column, or null for a plan with no months in it. */
  wholePlan: TradingStatement | null;
};

export function profitAndLossReport(result: PlanSimulationResult): ProfitAndLossReport {
  const whole = wholePlanPeriod(result);
  return {
    config: result.config,
    period: reportingPeriod(result.config),
    months: monthPeriods(result).map(tradingStatement),
    years: yearPeriods(result).map(tradingStatement),
    wholePlan: whole ? tradingStatement(whole) : null,
  };
}

// ------------------------------------------------------------- the worksheets

export const PROFIT_AND_LOSS_ROWS: StatementRow<TradingStatement>[] = [
  { kind: "section", label: "TRADING INCOME" },
  { kind: "line", label: "Pig sales", value: (p) => p.revenue.pigSales },
  { kind: "line", label: "Breeding gilt sales", value: (p) => p.revenue.giltSales },
  { kind: "line", label: "Cull sow sales", value: (p) => p.revenue.cullSales },
  { kind: "line", label: "Other operating income", value: (p) => p.revenue.otherIncome },
  { kind: "total", label: "Total trading income", value: (p) => p.revenue.total },
  { kind: "blank" },
  { kind: "section", label: "OPERATING COSTS" },
  ...COST_LINES.map(
    (line): StatementRow<TradingStatement> => ({
      kind: "line",
      label: COST_LINE_LABELS[line],
      value: (p) => p.operatingCosts[line],
    }),
  ),
  { kind: "total", label: "Total operating costs", value: (p) => p.operatingCosts.total },
  { kind: "blank" },
  { kind: "result", label: "OPERATING PROFIT / (LOSS)", value: (p) => p.operatingProfit },
  { kind: "blank" },
  { kind: "section", label: "THE SAME PERIOD, INVENTORY-ADJUSTED (EXPERIMENTAL)" },
  {
    kind: "line",
    label: "Cost of market pigs sold",
    value: (p) => p.inventoryAdjusted.costOfSales.marketPigCost,
  },
  {
    kind: "line",
    label: "Cost of breeding gilts sold",
    value: (p) => p.inventoryAdjusted.costOfSales.giltCost,
  },
  {
    kind: "line",
    label: "Carrying value of breeding stock sold",
    value: (p) => p.inventoryAdjusted.costOfSales.breedingStockCost,
  },
  {
    kind: "total",
    label: "Cost of livestock sold",
    value: (p) => p.inventoryAdjusted.costOfSales.total,
  },
  { kind: "subtotal", label: "Gross profit", value: (p) => p.inventoryAdjusted.grossProfit },
  { kind: "blank" },
  {
    kind: "line",
    label: "Breeding herd upkeep",
    value: (p) => p.inventoryAdjusted.operatingExpenses.breedingHerd,
  },
  { kind: "line", label: "Labour", value: (p) => p.inventoryAdjusted.operatingExpenses.labour },
  {
    kind: "line",
    label: "Overheads",
    value: (p) => p.inventoryAdjusted.operatingExpenses.overheads,
  },
  {
    kind: "line",
    label: "Breeding stock depreciation",
    value: (p) => p.inventoryAdjusted.operatingExpenses.depreciation,
  },
  {
    kind: "line",
    label: "Mortality write-offs",
    value: (p) => p.inventoryAdjusted.operatingExpenses.mortalityLosses,
  },
  {
    kind: "line",
    label: "Other operating costs",
    value: (p) => p.inventoryAdjusted.operatingExpenses.other,
  },
  {
    kind: "total",
    label: "Total operating expenses",
    value: (p) => p.inventoryAdjusted.operatingExpenses.total,
  },
  {
    kind: "result",
    label: "INVENTORY-ADJUSTED OPERATING PROFIT / (LOSS)",
    value: (p) => p.inventoryAdjusted.operatingProfit,
  },
  {
    kind: "memo",
    label: "Difference: what the farm put into itself, at cost",
    value: (p) => p.changeInFarmInventory,
  },
  { kind: "blank" },
  { kind: "section", label: "FINANCING MOVEMENTS — NOT TRADING INCOME OR EXPENDITURE" },
  { kind: "memo", label: "Funding injected", value: (p) => p.financing.in },
  { kind: "memo", label: "Funding withdrawn", value: (p) => p.financing.out },
  { kind: "memo", label: "Net cash flow for the period", value: (p) => p.netCashFlow },
  { kind: "memo", label: "Closing cash balance", value: (p) => p.closingCash },
  { kind: "blank" },
  { kind: "section", label: "RECONCILIATION TO THE PROJECTED BALANCE SHEET" },
  {
    kind: "line",
    label: "Farm net worth brought forward",
    value: (p) => p.reconciliation.openingNetWorth,
  },
  {
    kind: "line",
    label: "Inventory-adjusted profit / (loss) for the period",
    value: (p) => p.reconciliation.profit,
  },
  {
    kind: "line",
    label: "Funding injected less withdrawn",
    value: (p) => p.reconciliation.financingNet,
  },
  {
    kind: "line",
    label: "Timing: goods held in store, less amounts owed for them",
    value: (p) => p.reconciliation.goodsHeldTiming,
  },
  {
    kind: "total",
    label: "Farm net worth carried forward",
    value: (p) => p.reconciliation.closingNetWorth,
  },
];

const NOTES = [
  "Funding injections and withdrawals are excluded from both profit figures above. They appear at the foot of the statement because they move cash — not because they are income or expenditure.",
  "The inventory-adjusted reading is experimental. It restates the same run with the rearing cost of unsold animals held on the balance sheet until those animals are sold, die or are written off. It is not a second forecast.",
  "Costs are shown when incurred, not when paid. Where the plan buys on supplier terms, the cash book in the funding cashflow workbook differs from this statement by the amount owed.",
  "Gross profit is total trading income less the cost of livestock sold, and belongs to the inventory-adjusted reading only.",
  "Overheads, bedding & utilities covers " + costLineContents("overheads") + ".",
  "The reconciliation at the foot closes the trading statement onto the projected balance sheet. The timing line is goods bought and not yet consumed less what is still owed for them: on a plan that pays for feed as it is eaten, that is the whole of the difference between profit and the movement in net worth.",
];

export function addProfitAndLossSheets(
  workbook: Workbook,
  report: ProfitAndLossReport,
  generatedAt: Date,
): void {
  const name = report.config.project.name;
  const subtitle = provenance(report.config, generatedAt);
  const withWhole = (periods: TradingStatement[]) =>
    report.wholePlan ? [...periods, report.wholePlan] : periods;

  addStatementSheet(workbook, {
    name: "P&L Annual",
    tabColor: "17324D",
    title: `${name} — projected profit & loss`,
    subtitle,
    heading: (period) => period.label,
    periods: withWhole(report.years),
    rows: PROFIT_AND_LOSS_ROWS,
    labelWidth: 46,
    columnWidth: 18,
    footer: "Projected profit & loss — annual",
    totalsLastColumn: report.wholePlan !== null,
    notes: NOTES,
  });

  addStatementSheet(workbook, {
    name: "P&L Monthly",
    tabColor: "2A78D6",
    title: `${name} — projected profit & loss, month by month`,
    subtitle,
    // The last column covers the whole horizon, so it is named rather than
    // dated: a plan total headed "Jan-27" reads as another January.
    heading: (period) =>
      period.key === "whole-plan" ? "Plan total" : monthCellDate(period.startDate),
    periods: withWhole(report.months),
    rows: PROFIT_AND_LOSS_ROWS,
    labelWidth: 46,
    footer: "Projected profit & loss — monthly",
    totalsLastColumn: report.wholePlan !== null,
    notes: NOTES,
  });
}
