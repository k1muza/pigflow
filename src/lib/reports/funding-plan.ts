import type { Workbook } from "exceljs";

import type { PlannerConfig } from "../config";
import { planFunding, type FundingPlan } from "../funding";
import type { MonthlyProjection } from "../model";
import type { PlanSimulationResult } from "../simulation-result";
import { provenance, reportingPeriod } from "./periods";
import {
  applyBase,
  COLORS,
  columnLetter,
  FONT,
  forCells,
  LANDSCAPE_PAGE,
  MONEY_FORMAT,
  monthCellDate,
  PORTRAIT_PAGE,
  ruleRow,
  solidFill,
  styleSection,
  styleTableHeader,
  styleTitle,
  styleTotal,
} from "./sheet";

/**
 * The projected cash deficit, turned into a schedule somebody could take to a
 * bank.
 *
 * It answers the four questions a lender asks in the order they ask them: how
 * much of this is the farmer's own money, when does the plan run out of it, how
 * much is wanted and when, and when does it start paying for itself. The
 * schedule itself comes from {@link planFunding} in `lib/funding`, beside the
 * cash-injection planner the money page uses, so there is one place that knows
 * how a shortfall becomes a drawdown.
 *
 * It changes nothing. The plan was simulated with whatever cash movements it
 * actually carries, and this describes what that run would have needed —
 * putting the tranches into the plan and running it again is a separate act,
 * and it is the funding controls on the money page that do it.
 */

/** One row of the month-by-month working behind the schedule. */
export type FundingMonth = {
  index: number;
  date: string;
  label: string;
  cashIn: number;
  cashOut: number;
  netCashFlow: number;
  /** Where the month closes with no funding at all. */
  unfundedBalance: number;
  /** Drawn this month, and everything drawn up to and including it. */
  injected: number;
  facilityDrawn: number;
  /** And where it closes with the schedule in place. */
  fundedBalance: number;
};

export type FundingPlanReport = {
  config: PlannerConfig;
  period: string;
  plan: FundingPlan;
  months: FundingMonth[];
};

export function fundingPlanReport(result: PlanSimulationResult): FundingPlanReport {
  const config = result.config;
  const plan = planFunding(config, result.projection);
  const drawnBy = new Map<number, number>();
  for (const tranche of plan.tranches) {
    drawnBy.set(tranche.monthIndex, (drawnBy.get(tranche.monthIndex) ?? 0) + tranche.amount);
  }

  let facilityDrawn = 0;
  const months = result.projection.months.map((month: MonthlyProjection): FundingMonth => {
    facilityDrawn += drawnBy.get(month.index) ?? 0;
    return {
      index: month.index,
      date: month.date,
      label: month.month,
      cashIn: month.cashIn,
      cashOut: month.cashOut,
      netCashFlow: month.netCashFlow,
      unfundedBalance: month.closingCash,
      injected: drawnBy.get(month.index) ?? 0,
      facilityDrawn,
      // Every tranche stays in the business, so a month's funded balance is its
      // own balance lifted by everything drawn on or before it. Nothing is
      // serviced or repaid here; see the note on the sheet.
      fundedBalance: month.closingCash + facilityDrawn,
    };
  });

  return { config, period: reportingPeriod(config), plan, months };
}

// ------------------------------------------------------------- the worksheets

const NOTES = [
  "THIS IS NOT THE COST OF ESTABLISHING THE PROJECT. The figure above funds the operating cash requirement of the plan as modelled, plus whatever the plan itself charges to capital. Housing, land, water and borehole, electrical reticulation, feed handling equipment, effluent works, vehicles, professional fees and the interest and arrangement costs of the facility are none of them modelled, and none of them are in it. Add them to the figure above to arrive at a total project cost.",
  "The projected balance sheet excludes buildings and land for the same reason: the model carries the places a farm has as a constraint on herd size rather than as an asset it has costed. A unit's fixed assets and the borrowing against them both sit outside this plan.",
  "The schedule is derived from the projected cash requirement of the plan as it stands. It is a proposal, not part of the simulation: adding these injections to the plan and running it again is a separate step, on the financial planning page.",
  "Tranches are sized to carry the plan through the leanest month of the following year and rounded up to a round figure, so that a plan which is slightly short for many months in a row asks for money once rather than every month.",
  "No interest, arrangement fee or repayment is modelled. A schedule that guessed at them would be a worse answer dressed as a better one; price the facility with your lender and read the cost back into the plan as an overhead.",
  "Funding injections are not income. They appear nowhere in the projected profit and loss.",
];

function addScheduleSheet(
  workbook: Workbook,
  report: FundingPlanReport,
  generatedAt: Date,
): void {
  const { plan, config } = report;
  const currency = config.project.currency;
  const sheet = workbook.addWorksheet("Funding Plan", {
    properties: { tabColor: { argb: "B45309" } },
    views: [{ showGridLines: false }],
    pageSetup: { ...PORTRAIT_PAGE, fitToHeight: 1 },
  });
  sheet.columns = [{ width: 34 }, { width: 20 }, { width: 20 }, { width: 46 }];
  styleTitle(
    sheet,
    `${config.project.name} — proposed funding plan`,
    provenance(config, generatedAt),
    "D",
  );

  let row = 6;
  const heading = (label: string) => {
    sheet.getCell(row, 1).value = label;
    styleSection(sheet.getRow(row), 4);
    row += 1;
  };
  const fact = (label: string, value: string | number, note = "") => {
    sheet.getCell(row, 1).value = label;
    sheet.getCell(row, 2).value = value;
    if (typeof value === "number") sheet.getCell(row, 2).numFmt = MONEY_FORMAT;
    sheet.getCell(row, 2).alignment = { horizontal: "right", vertical: "middle" };
    sheet.getCell(row, 2).font = { name: FONT, size: 10, bold: true, color: { argb: COLORS.navy } };
    if (note) sheet.getCell(row, 4).value = note;
    ruleRow(sheet, row, 4);
    row += 1;
  };

  heading("WHAT THIS FACILITY COVERS");
  fact(
    "Capital works costed in this plan",
    plan.capitalExpenditure,
    plan.fundsCapitalWorks
      ? "Charged to capital by the plan and therefore inside the requirement below."
      : "Nothing has been entered, so the requirement below is working capital only.",
  );
  fact(
    "Establishment costs NOT included",
    "See note",
    "Housing, land, water and borehole, electrical reticulation, feed bins and mills, effluent works, vehicles, professional fees and finance charges. The model treats housing as a limit on herd size rather than as an asset, so it never costs it and the balance sheet never carries it.",
  );

  row += 1;
  heading("THE POSITION");
  fact("Opening capital available", plan.openingCapital, "Cash the plan starts with.");
  fact(
    "Working capital to be held",
    plan.workingCapitalFloor,
    "The balance the schedule is built never to let the plan close below.",
  );
  fact(
    "Deepest projected shortfall",
    plan.projectedShortfall,
    plan.shortfallMonth
      ? `How far below that floor the plan goes with nothing put in, reached in ${plan.shortfallMonth}.`
      : "The plan funds itself throughout; no external funding is required.",
  );
  fact("Month of peak funding need", plan.shortfallMonth ?? "—", "");

  row += 1;
  heading("PROPOSED DRAWDOWN SCHEDULE");
  sheet.getRow(row).values = ["Date", "Proposed injection", "Cumulative", "Reason"];
  styleTableHeader(sheet.getRow(row), 1, 4);
  row += 1;
  const firstTranche = row;
  for (const tranche of plan.tranches) {
    sheet.getCell(row, 1).value = monthCellDate(tranche.date);
    sheet.getCell(row, 1).numFmt = "mmm-yy";
    sheet.getCell(row, 2).value = tranche.amount;
    sheet.getCell(row, 3).value = tranche.cumulative;
    sheet.getCell(row, 4).value =
      `${tranche.reason} · carries the plan through ${tranche.carriesThrough}`;
    forCells(sheet, row, row, 2, 3, (cell) => {
      cell.numFmt = MONEY_FORMAT;
    });
    ruleRow(sheet, row, 4);
    row += 1;
  }
  if (plan.tranches.length === 0) {
    sheet.mergeCells(row, 1, row, 4);
    sheet.getCell(row, 1).value =
      "No injection is required. The plan holds its working capital in every month of the horizon.";
    sheet.getCell(row, 1).font = { name: FONT, size: 10, italic: true, color: { argb: COLORS.muted } };
    ruleRow(sheet, row, 4);
    row += 1;
  }

  sheet.getCell(row, 1).value = plan.fundsCapitalWorks
    ? "Maximum external funding required"
    : "Maximum external WORKING CAPITAL required";
  if (plan.tranches.length > 0) {
    sheet.getCell(row, 2).value = {
      formula: `SUM(B${firstTranche}:B${row - 1})`,
      result: plan.peakRequirement,
    };
  } else {
    sheet.getCell(row, 2).value = plan.peakRequirement;
  }
  sheet.getCell(row, 2).numFmt = MONEY_FORMAT;
  sheet.getCell(row, 2).alignment = { horizontal: "right", vertical: "middle" };
  styleTotal(sheet.getRow(row), 4, true);
  forCells(sheet, row, row, 1, 4, (cell) => {
    cell.fill = solidFill(COLORS.paleGold);
  });
  row += 2;

  heading("HOW IT PLAYS OUT");
  fact(
    "Fully drawn by",
    plan.fullyDrawnMonth ?? "—",
    "The month the last tranche has to be in place.",
  );
  fact(
    "Operating cash begins recovering",
    plan.recoveryMonth ?? "Not within the horizon",
    "The first month that makes cash and after which the funded balance never returns to the floor.",
  );
  fact(
    "Leanest funded balance",
    plan.lowestFundedBalance,
    "The lowest the bank account gets with the schedule drawn.",
  );
  fact(
    "Closing cash with the schedule drawn",
    plan.closingCash,
    `In ${currency}, at the end of the plan.`,
  );

  row += 1;
  for (const note of NOTES) {
    sheet.mergeCells(row, 1, row, 4);
    sheet.getCell(row, 1).value = note;
    sheet.getCell(row, 1).alignment = { wrapText: true, vertical: "top" };
    sheet.getCell(row, 1).font = { name: FONT, size: 9, italic: true, color: { argb: COLORS.muted } };
    sheet.getRow(row).height = 30;
    row += 1;
  }

  applyBase(sheet);
  sheet.headerFooter.oddFooter = "&LProposed funding plan&RPage &P of &N";
}

/** The month-by-month working the schedule was read off, so it can be checked. */
function addWorkingSheet(workbook: Workbook, report: FundingPlanReport, generatedAt: Date): void {
  const headers = [
    "Month",
    "Cash received",
    "Cash paid",
    "Net cash flow",
    "Closing balance, unfunded",
    "Injected this month",
    "Facility drawn",
    "Closing balance, funded",
  ];
  const sheet = workbook.addWorksheet("Funding Working", {
    properties: { tabColor: { argb: "D97706" } },
    views: [{ state: "frozen", xSplit: 1, ySplit: 6, showGridLines: false }],
    pageSetup: { ...LANDSCAPE_PAGE, printTitlesRow: "1:6" },
  });
  styleTitle(
    sheet,
    `${report.config.project.name} — how the funding requirement was worked out`,
    provenance(report.config, generatedAt),
    columnLetter(headers.length),
  );
  sheet.getRow(6).values = headers;
  styleTableHeader(sheet.getRow(6), 1, headers.length);

  report.months.forEach((month, index) => {
    const row = index + 7;
    sheet.getRow(row).values = [
      monthCellDate(month.date),
      month.cashIn,
      month.cashOut,
      month.netCashFlow,
      month.unfundedBalance,
      month.injected,
      month.facilityDrawn,
      month.fundedBalance,
    ];
    sheet.getCell(row, 1).numFmt = "mmm-yy";
    forCells(sheet, row, row, 2, headers.length, (cell) => {
      cell.numFmt = MONEY_FORMAT;
    });
    if (month.injected > 0) {
      forCells(sheet, row, row, 1, headers.length, (cell) => {
        cell.fill = solidFill(COLORS.paleGold);
      });
    }
    ruleRow(sheet, row, headers.length);
  });

  sheet.getColumn(1).width = 13;
  for (let column = 2; column <= headers.length; column += 1) sheet.getColumn(column).width = 20;
  applyBase(sheet);
  sheet.autoFilter = { from: "A6", to: `${columnLetter(headers.length)}6` };
  sheet.headerFooter.oddFooter = "&LFunding requirement working&RPage &P of &N";
}

export function addFundingPlanSheets(
  workbook: Workbook,
  report: FundingPlanReport,
  generatedAt: Date,
): void {
  addScheduleSheet(workbook, report, generatedAt);
  addWorkingSheet(workbook, report, generatedAt);
}
