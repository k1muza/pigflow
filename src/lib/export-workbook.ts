import type { Cell, Row, Worksheet } from "exceljs";

import { expectedGiltServiceAgeDays } from "./config";
import type { MonthlyProjection, PlannerConfig, ProjectionResult } from "./model";
import { CATEGORY_LABELS, EXPENSE_CATEGORIES, INCOME_CATEGORIES, type LedgerCategory } from "./sim";

const COLORS = {
  navy: "17324D",
  blue: "2A78D6",
  paleBlue: "EAF2FB",
  paleGold: "FFF4D6",
  green: "18794E",
  paleGreen: "EAF6EF",
  red: "B42318",
  paleRed: "FDECEC",
  ink: "17212B",
  muted: "667085",
  line: "D9DEE5",
  plane: "F6F7F9",
  white: "FFFFFF",
} as const;

/**
 * The cashflow sheet, line by line. Rows are counted off these lists rather than
 * written down, so adding a cost line moves every formula below it with no
 * chance of a total quietly summing the wrong range.
 */
const RECEIPT_LINES: { label: string; category: LedgerCategory }[] = INCOME_CATEGORIES.map(
  (category) => ({ label: CATEGORY_LABELS[category], category }),
);

const PAYMENT_LINES: { label: string; category: LedgerCategory }[] = EXPENSE_CATEGORIES.map(
  (category) => ({ label: CATEGORY_LABELS[category], category }),
);

const CASHFLOW_ROWS = (() => {
  const opening = 4;
  const receiptsHeading = 6;
  const firstReceipt = receiptsHeading + 1;
  const totalReceipts = firstReceipt + RECEIPT_LINES.length;
  const paymentsHeading = totalReceipts + 2;
  const firstPayment = paymentsHeading + 1;
  const totalPayments = firstPayment + PAYMENT_LINES.length;
  const netCashFlow = totalPayments + 2;
  return {
    opening,
    receiptsHeading,
    firstReceipt,
    lastReceipt: totalReceipts - 1,
    totalReceipts,
    paymentsHeading,
    firstPayment,
    lastPayment: totalPayments - 1,
    totalPayments,
    netCashFlow,
    closingCash: netCashFlow + 1,
    funding: netCashFlow + 2,
  };
})();

/** Each cashflow line's row and this month's amount for it. */
function cashflowValues(month: MonthlyProjection): [number, number][] {
  return [
    ...RECEIPT_LINES.map(
      (line, index) =>
        [CASHFLOW_ROWS.firstReceipt + index, month.totals[line.category]] as [number, number],
    ),
    ...PAYMENT_LINES.map(
      (line, index) =>
        [CASHFLOW_ROWS.firstPayment + index, month.totals[line.category]] as [number, number],
    ),
  ];
}

const FONT = "Aptos";
const MONEY_FORMAT = '$#,##0;[Red]($#,##0);-';
const MONEY_FORMAT_DECIMAL = '$#,##0.00;[Red]($#,##0.00);-';
const NUMBER_FORMAT = '#,##0;[Red](#,##0);-';

function forCells(
  sheet: Worksheet,
  fromRow: number,
  toRow: number,
  fromColumn: number,
  toColumn: number,
  visit: (cell: Cell) => void,
) {
  for (let row = fromRow; row <= toRow; row += 1) {
    for (let column = fromColumn; column <= toColumn; column += 1) {
      visit(sheet.getCell(row, column));
    }
  }
}

function solidFill(argb: string) {
  return { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb } };
}

function applyBase(sheet: Worksheet) {
  sheet.views = [{ showGridLines: false }];
  sheet.eachRow((row) => {
    row.eachCell((cell) => {
      cell.font = {
        name: FONT,
        size: 10,
        color: { argb: COLORS.ink },
        ...cell.font,
      };
      cell.alignment = { vertical: "middle", ...cell.alignment };
    });
  });
}

function styleTitle(sheet: Worksheet, title: string, subtitle: string, lastColumn: string) {
  sheet.mergeCells(`A2:${lastColumn}2`);
  sheet.getCell("A2").value = title;
  sheet.getCell("A2").font = { name: FONT, size: 16, bold: true, color: { argb: COLORS.navy } };
  sheet.getRow(2).height = 24;
  sheet.mergeCells(`A3:${lastColumn}3`);
  sheet.getCell("A3").value = subtitle;
  sheet.getCell("A3").font = { name: FONT, size: 10, italic: true, color: { argb: COLORS.muted } };
  sheet.getRow(3).height = 18;
  forCells(sheet, 4, 4, 1, sheet.getColumn(lastColumn).number, (cell) => {
    cell.fill = solidFill(COLORS.navy);
  });
  sheet.getRow(4).height = 3;
}

function styleTableHeader(row: Row, fromColumn = 1, toColumn = row.cellCount) {
  for (let column = fromColumn; column <= toColumn; column += 1) {
    const cell = row.getCell(column);
    cell.fill = solidFill(COLORS.navy);
    cell.font = { name: FONT, size: 10, bold: true, color: { argb: COLORS.white } };
    cell.alignment = { vertical: "middle", horizontal: column === fromColumn ? "left" : "center" };
    cell.border = { right: { style: "thin", color: { argb: COLORS.white } } };
  }
  row.height = 22;
}

function styleSection(row: Row, lastColumn: number) {
  for (let column = 1; column <= lastColumn; column += 1) {
    const cell = row.getCell(column);
    cell.fill = solidFill(COLORS.paleBlue);
    cell.font = { name: FONT, size: 10, bold: true, color: { argb: COLORS.navy } };
    cell.border = {
      top: { style: "thin", color: { argb: COLORS.line } },
      bottom: { style: "thin", color: { argb: COLORS.line } },
    };
  }
  row.height = 20;
}

function styleTotal(row: Row, lastColumn: number, strong = false) {
  for (let column = 1; column <= lastColumn; column += 1) {
    const cell = row.getCell(column);
    cell.font = { name: FONT, size: 10, bold: true, color: { argb: COLORS.ink } };
    cell.border = strong
      ? { top: { style: "double", color: { argb: COLORS.navy } } }
      : { top: { style: "thin", color: { argb: COLORS.line } } };
  }
}

function setResultFormula(cell: Cell, formula: string, result: number) {
  cell.value = { formula, result };
}

function columnLetter(column: number) {
  let value = column;
  let result = "";
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

function addSummarySheet(
  workbook: import("exceljs").Workbook,
  config: PlannerConfig,
  projection: ProjectionResult,
  generatedAt: Date,
) {
  const sheet = workbook.addWorksheet("Summary", {
    properties: { tabColor: { argb: COLORS.navy } },
    views: [{ showGridLines: false }],
    pageSetup: {
      paperSize: 9,
      orientation: "portrait",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 1,
      margins: { left: 0.35, right: 0.35, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
    },
  });
  sheet.columns = [
    { width: 3 },
    { width: 24 },
    { width: 15 },
    { width: 15 },
    { width: 18 },
    { width: 15 },
    { width: 11 },
    { width: 12 },
  ];
  styleTitle(
    sheet,
    `${config.project.name} — Funding cashflow`,
    `${config.project.months}-month simulated plan from ${config.project.startDate} · ${config.project.currency} · prepared ${generatedAt.toLocaleDateString("en-GB")}`,
    "H",
  );

  sheet.getCell("B6").value = "Funding overview";
  sheet.getCell("B6").font = { name: FONT, size: 12, bold: true, color: { argb: COLORS.navy } };
  const metrics: Array<[string, number, string, string, number, string]> = [
    ["Opening cash", config.project.openingCash, MONEY_FORMAT, "Peak funding need", projection.summary.peakFundingNeed, MONEY_FORMAT],
    ["Total receipts", projection.summary.totalRevenue, MONEY_FORMAT, "Total payments", projection.summary.totalCost, MONEY_FORMAT],
    ["Closing cash", projection.summary.closingCash, MONEY_FORMAT, "Lowest cash balance", projection.summary.lowestCash, MONEY_FORMAT],
    ["Pigs sold", projection.summary.totalPigsSold, NUMBER_FORMAT, "Final sow herd", projection.summary.finalSows, NUMBER_FORMAT],
  ];
  metrics.forEach(([leftLabel, leftValue, leftFormat, rightLabel, rightValue, rightFormat], index) => {
    const row = 8 + index * 2;
    sheet.getCell(row, 2).value = leftLabel;
    sheet.getCell(row, 3).value = leftValue;
    sheet.getCell(row, 5).value = rightLabel;
    sheet.getCell(row, 6).value = rightValue;
    for (const labelCell of [sheet.getCell(row, 2), sheet.getCell(row, 5)]) {
      labelCell.fill = solidFill(COLORS.plane);
      labelCell.font = { name: FONT, size: 10, color: { argb: COLORS.muted } };
    }
    for (const [valueCell, format] of [
      [sheet.getCell(row, 3), leftFormat],
      [sheet.getCell(row, 6), rightFormat],
    ] as const) {
      valueCell.numFmt = format;
      valueCell.font = { name: FONT, size: 12, bold: true, color: { argb: COLORS.navy } };
      valueCell.fill = solidFill(COLORS.plane);
      valueCell.alignment = { horizontal: "right", vertical: "middle" };
    }
    sheet.getRow(row).height = 25;
  });

  sheet.getCell("B17").value = "Annual cashflow summary";
  sheet.getCell("B17").font = { name: FONT, size: 12, bold: true, color: { argb: COLORS.navy } };
  const annualHeaderRow = 19;
  sheet.getRow(annualHeaderRow).values = [
    undefined,
    "Period",
    "Receipts",
    "Payments",
    "Net cash flow",
    "Closing cash",
    "Pigs sold",
    "Ending sows",
  ];
  styleTableHeader(sheet.getRow(annualHeaderRow), 2, 8);
  projection.years.forEach((year, index) => {
    const row = annualHeaderRow + 1 + index;
    sheet.getCell(row, 2).value = year.label;
    sheet.getCell(row, 3).value = year.revenue;
    sheet.getCell(row, 4).value = year.totalCost;
    sheet.getCell(row, 5).value = year.netCashFlow;
    sheet.getCell(row, 6).value = year.closingCash;
    sheet.getCell(row, 7).value = year.pigsSold;
    sheet.getCell(row, 8).value = year.sows;
    forCells(sheet, row, row, 3, 6, (cell) => {
      cell.numFmt = MONEY_FORMAT;
    });
    forCells(sheet, row, row, 7, 8, (cell) => {
      cell.numFmt = NUMBER_FORMAT;
    });
    forCells(sheet, row, row, 2, 8, (cell) => {
      cell.border = { bottom: { style: "thin", color: { argb: COLORS.line } } };
    });
  });

  const notesRow = annualHeaderRow + projection.years.length + 3;
  sheet.getCell(notesRow, 2).value = "Key planning notes";
  sheet.getCell(notesRow, 2).font = { name: FONT, size: 12, bold: true, color: { argb: COLORS.navy } };
  const warnings = projection.warnings.slice(0, 5);
  warnings.forEach((warning, index) => {
    const row = notesRow + 2 + index;
    sheet.mergeCells(row, 2, row, 8);
    sheet.getCell(row, 2).value = `${warning.title}: ${warning.detail}`;
    sheet.getCell(row, 2).alignment = { wrapText: true, vertical: "top" };
    sheet.getCell(row, 2).fill = solidFill(
      warning.level === "attention" ? COLORS.paleGold : COLORS.plane,
    );
    sheet.getRow(row).height = 35;
  });

  const disclaimerRow = notesRow + warnings.length + 4;
  sheet.mergeCells(disclaimerRow, 2, disclaimerRow + 1, 8);
  sheet.getCell(disclaimerRow, 2).value =
    "Planning statement: this workbook presents one simulated case based on the assumptions supplied in PigFlow. It is not a guarantee of performance. Validate prices, health protocols, construction quotations and production assumptions before submission.";
  sheet.getCell(disclaimerRow, 2).alignment = { wrapText: true, vertical: "top" };
  sheet.getCell(disclaimerRow, 2).font = { name: FONT, size: 9, italic: true, color: { argb: COLORS.muted } };

  const checkRow = disclaimerRow + 4;
  sheet.getCell(checkRow, 2).value = "Reconciliation checks";
  sheet.getCell(checkRow, 2).font = { name: FONT, size: 11, bold: true, color: { argb: COLORS.navy } };
  const monthlyLastColumn = columnLetter(projection.months.length + 1);
  const checkRows: Array<[string, string, number]> = [
    ["Opening cash + total net cash − closing cash", `'Cash Flow'!B${CASHFLOW_ROWS.opening}+'Cash Flow'!${columnLetter(projection.months.length + 2)}${CASHFLOW_ROWS.netCashFlow}-'Cash Flow'!${monthlyLastColumn}${CASHFLOW_ROWS.closingCash}`, 0],
    ["Annual receipts less monthly receipts", `SUM(C20:C${19 + projection.years.length})-'Cash Flow'!${columnLetter(projection.months.length + 2)}${CASHFLOW_ROWS.totalReceipts}`, 0],
    ["Annual payments less monthly payments", `SUM(D20:D${19 + projection.years.length})-'Cash Flow'!${columnLetter(projection.months.length + 2)}${CASHFLOW_ROWS.totalPayments}`, 0],
  ];
  checkRows.forEach(([label, formula, result], index) => {
    const row = checkRow + 1 + index;
    sheet.getCell(row, 2).value = label;
    setResultFormula(sheet.getCell(row, 6), formula, result);
    sheet.getCell(row, 6).numFmt = MONEY_FORMAT_DECIMAL;
    sheet.getCell(row, 6).font = { name: FONT, size: 10, bold: true, color: { argb: COLORS.ink } };
  });

  applyBase(sheet);
  sheet.getCell("F8").fill = solidFill(COLORS.paleGold);
  sheet.getCell("F8").font = { name: FONT, size: 12, bold: true, color: { argb: COLORS.red } };
  sheet.headerFooter.oddFooter = "&LPigFlow funding cashflow&RPage &P of &N";
  return sheet;
}

function addCashFlowSheet(
  workbook: import("exceljs").Workbook,
  config: PlannerConfig,
  projection: ProjectionResult,
) {
  const monthCount = projection.months.length;
  const totalColumn = monthCount + 2;
  const lastColumn = columnLetter(totalColumn);
  const sheet = workbook.addWorksheet("Cash Flow", {
    properties: { tabColor: { argb: COLORS.blue } },
    views: [{ state: "frozen", xSplit: 1, ySplit: 5, showGridLines: false }],
    pageSetup: {
      paperSize: 9,
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      printTitlesRow: "1:5",
      printTitlesColumn: "1:1",
      margins: { left: 0.25, right: 0.25, top: 0.45, bottom: 0.45, header: 0.2, footer: 0.2 },
    },
  });
  sheet.getColumn(1).width = 30;
  for (let column = 2; column <= totalColumn; column += 1) sheet.getColumn(column).width = 13;
  styleTitle(
    sheet,
    "Detailed monthly cashflow",
    `${config.project.currency} · cash basis · values in nominal currency · negative values shown in parentheses`,
    lastColumn,
  );
  sheet.getCell("A5").value = "Cashflow line";
  projection.months.forEach((month, index) => {
    const cell = sheet.getCell(5, index + 2);
    cell.value = monthCellDate(month.date);
    cell.numFmt = "mmm-yy";
  });
  sheet.getCell(5, totalColumn).value = "Plan total / end";
  styleTableHeader(sheet.getRow(5), 1, totalColumn);

  const lines: [number, string][] = [
    [CASHFLOW_ROWS.opening, "Opening cash balance"],
    [CASHFLOW_ROWS.receiptsHeading, "CASH RECEIPTS"],
    ...RECEIPT_LINES.map(
      (line, index) => [CASHFLOW_ROWS.firstReceipt + index, "  " + line.label] as [number, string],
    ),
    [CASHFLOW_ROWS.totalReceipts, "Total receipts"],
    [CASHFLOW_ROWS.paymentsHeading, "CASH PAYMENTS"],
    ...PAYMENT_LINES.map(
      (line, index) => [CASHFLOW_ROWS.firstPayment + index, "  " + line.label] as [number, string],
    ),
    [CASHFLOW_ROWS.totalPayments, "Total payments"],
    [CASHFLOW_ROWS.netCashFlow, "Net cash flow"],
    [CASHFLOW_ROWS.closingCash, "Closing cash balance"],
    [CASHFLOW_ROWS.funding, "Funding requirement"],
  ];
  for (const [row, label] of lines) sheet.getCell(row, 1).value = label;
  styleSection(sheet.getRow(CASHFLOW_ROWS.receiptsHeading), totalColumn);
  styleSection(sheet.getRow(CASHFLOW_ROWS.paymentsHeading), totalColumn);

  projection.months.forEach((month, index) => {
    const column = index + 2;
    const letter = columnLetter(column);
    const priorLetter = columnLetter(column - 1);
    cashflowValues(month).forEach(([row, value]) => {
      sheet.getCell(row, column).value = value;
    });
    sheet.getCell(CASHFLOW_ROWS.opening, column).value =
      index === 0
        ? config.project.openingCash
        : {
            formula: `${priorLetter}${CASHFLOW_ROWS.closingCash}`,
            result: projection.months[index - 1].closingCash,
          };
    setResultFormula(
      sheet.getCell(CASHFLOW_ROWS.totalReceipts, column),
      `SUM(${letter}${CASHFLOW_ROWS.firstReceipt}:${letter}${CASHFLOW_ROWS.lastReceipt})`,
      month.revenue,
    );
    setResultFormula(
      sheet.getCell(CASHFLOW_ROWS.totalPayments, column),
      `SUM(${letter}${CASHFLOW_ROWS.firstPayment}:${letter}${CASHFLOW_ROWS.lastPayment})`,
      month.totalCost,
    );
    setResultFormula(
      sheet.getCell(CASHFLOW_ROWS.netCashFlow, column),
      `${letter}${CASHFLOW_ROWS.totalReceipts}-${letter}${CASHFLOW_ROWS.totalPayments}`,
      month.netCashFlow,
    );
    setResultFormula(
      sheet.getCell(CASHFLOW_ROWS.closingCash, column),
      `${letter}${CASHFLOW_ROWS.opening}+${letter}${CASHFLOW_ROWS.netCashFlow}`,
      month.closingCash,
    );
    setResultFormula(
      sheet.getCell(CASHFLOW_ROWS.funding, column),
      `MAX(0,-${letter}${CASHFLOW_ROWS.closingCash})`,
      Math.max(0, -month.closingCash),
    );
  });

  const summedRows = [
    ...RECEIPT_LINES.map((_, index) => CASHFLOW_ROWS.firstReceipt + index),
    CASHFLOW_ROWS.totalReceipts,
    ...PAYMENT_LINES.map((_, index) => CASHFLOW_ROWS.firstPayment + index),
    CASHFLOW_ROWS.totalPayments,
    CASHFLOW_ROWS.netCashFlow,
  ];
  summedRows.forEach((row) => {
    const result =
      row === CASHFLOW_ROWS.totalReceipts
        ? projection.summary.totalRevenue
        : row === CASHFLOW_ROWS.totalPayments
          ? projection.summary.totalCost
          : row === CASHFLOW_ROWS.netCashFlow
            ? projection.months.reduce((sum, month) => sum + month.netCashFlow, 0)
            : projection.months.reduce((sum, month) => {
                const line = cashflowValues(month).find(([lineRow]) => lineRow === row);
                return sum + (line ? line[1] : 0);
              }, 0);
    setResultFormula(sheet.getCell(row, totalColumn), `SUM(B${row}:${columnLetter(monthCount + 1)}${row})`, result);
  });
  sheet.getCell(CASHFLOW_ROWS.opening, totalColumn).value = config.project.openingCash;
  sheet.getCell(CASHFLOW_ROWS.closingCash, totalColumn).value = projection.summary.closingCash;
  setResultFormula(
    sheet.getCell(CASHFLOW_ROWS.funding, totalColumn),
    `MAX(B${CASHFLOW_ROWS.funding}:${columnLetter(monthCount + 1)}${CASHFLOW_ROWS.funding})`,
    projection.summary.peakFundingNeed,
  );

  // Row 5 carries the month headings and keeps its own date format; sweeping the
  // money format across it would render each heading as a currency amount.
  forCells(sheet, CASHFLOW_ROWS.opening, CASHFLOW_ROWS.opening, 2, totalColumn, (cell) => {
    cell.numFmt = MONEY_FORMAT;
  });
  forCells(sheet, CASHFLOW_ROWS.receiptsHeading, CASHFLOW_ROWS.funding, 2, totalColumn, (cell) => {
    cell.numFmt = MONEY_FORMAT;
  });
  [
    CASHFLOW_ROWS.totalReceipts,
    CASHFLOW_ROWS.totalPayments,
    CASHFLOW_ROWS.netCashFlow,
    CASHFLOW_ROWS.closingCash,
    CASHFLOW_ROWS.funding,
  ].forEach((row) =>
    styleTotal(sheet.getRow(row), totalColumn, row >= CASHFLOW_ROWS.netCashFlow),
  );
  forCells(sheet, CASHFLOW_ROWS.funding, CASHFLOW_ROWS.funding, 1, totalColumn, (cell) => {
    cell.fill = solidFill(COLORS.paleGold);
    cell.font = { name: FONT, size: 10, bold: true, color: { argb: COLORS.red } };
  });
  sheet.getColumn(totalColumn).fill = solidFill(COLORS.plane);
  sheet.getColumn(totalColumn).font = { name: FONT, size: 10, bold: true, color: { argb: COLORS.ink } };
  applyBase(sheet);
  sheet.headerFooter.oddFooter = "&LDetailed cashflow&RPage &P of &N";
  return sheet;
}

/**
 * The Date an "mmm-yy" month cell is built from. ExcelJS converts a Date to an
 * Excel serial as `25569 + getTime() / 86_400_000` — pure UTC, with no local
 * offset correction — so a local midnight in a positive-offset zone serialises
 * to 22:00 on the previous day and the cell renders a month early. Anchoring the
 * month at UTC midnight makes the serial exact everywhere.
 */
function monthCellDate(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00Z`);
}

function addHerdSheet(
  workbook: import("exceljs").Workbook,
  config: PlannerConfig,
  projection: ProjectionResult,
) {
  const sheet = workbook.addWorksheet("Herd Plan", {
    properties: { tabColor: { argb: "5B8DEF" } },
    views: [{ state: "frozen", ySplit: 6, xSplit: 1, showGridLines: false }],
    pageSetup: {
      paperSize: 9,
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      printTitlesRow: "1:6",
      margins: { left: 0.25, right: 0.25, top: 0.45, bottom: 0.45, header: 0.2, footer: 0.2 },
    },
  });
  const headers = [
    "Month",
    "Farrowings",
    "Born alive",
    "Weaned",
    "Pigs sold",
    "Sale liveweight kg",
    "Sale deadweight kg",
    "Deaths",
    "Sows",
    "Gilts",
    "Piglets",
    "Weaners",
    "Growers",
    "Finishers",
    "Total growing",
    "Sow feed kg",
    "Growing feed kg",
    "Stockpeople",
  ];
  styleTitle(
    sheet,
    "Monthly herd and production plan",
    `${config.project.name} · month-end stock positions and monthly production flows`,
    columnLetter(headers.length),
  );
  sheet.getRow(6).values = headers;
  styleTableHeader(sheet.getRow(6), 1, headers.length);
  projection.months.forEach((month, index) => {
    const row = index + 7;
    sheet.getRow(row).values = [
      monthCellDate(month.date),
      month.farrowings,
      month.bornAlive,
      month.weaned,
      month.pigsSold,
      month.saleLiveweightKg,
      month.saleDeadweightKg,
      month.deaths,
      month.sows,
      month.gilts,
      month.piglets,
      month.weaners,
      month.growers,
      month.finishers,
      month.piglets + month.weaners + month.growers + month.finishers + month.gilts,
      month.sowFeedKg,
      month.growingFeedKg,
      month.workers,
    ];
    sheet.getCell(row, 1).numFmt = "mmm-yy";
    forCells(sheet, row, row, 2, headers.length, (cell) => {
      cell.numFmt = NUMBER_FORMAT;
    });
    forCells(sheet, row, row, 1, headers.length, (cell) => {
      cell.border = { bottom: { style: "thin", color: { argb: COLORS.line } } };
    });
  });
  sheet.getColumn(1).width = 13;
  for (let column = 2; column <= headers.length; column += 1) sheet.getColumn(column).width = 14;
  applyBase(sheet);
  sheet.autoFilter = { from: "A6", to: `${columnLetter(headers.length)}6` };
  sheet.headerFooter.oddFooter = "&LHerd and production plan&RPage &P of &N";
  return sheet;
}

/** The unit a feed assumption is quoted in, which its name alone does not say. */
function growthUnit(key: string): string {
  const name = key.toLowerCase();
  if (name.includes("mortality")) return "% per stage";
  if (name.startsWith("upkeepfeed")) return "kg/day at 100 kg";
  if (name.startsWith("gainfeed")) return "kg feed per kg gain";
  if (name.includes("gain")) return "kg/day";
  return "kg";
}

function feedUnit(key: string, currency: string): string {
  if (key === "truckCapacityKg") return "kg on the deck";
  if (key === "sundriesAllowanceKg") return "kg";
  if (key === "deliveryCostPerTrip") return `${currency}/load`;
  if (key.endsWith("Days")) return "days";
  if (key.toLowerCase().includes("cost")) return `${currency}/kg`;
  return "kg/day";
}

function addAssumptionsSheet(workbook: import("exceljs").Workbook, config: PlannerConfig) {
  const sheet = workbook.addWorksheet("Assumptions", {
    properties: { tabColor: { argb: "8EB8E8" } },
    views: [{ state: "frozen", ySplit: 6, showGridLines: false }],
    pageSetup: {
      paperSize: 9,
      orientation: "portrait",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      printTitlesRow: "1:6",
      margins: { left: 0.35, right: 0.35, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
    },
  });
  sheet.columns = [{ width: 28 }, { width: 19 }, { width: 20 }, { width: 48 }];
  styleTitle(
    sheet,
    "Model assumptions",
    "Inputs used for this export. Change assumptions in PigFlow and export again to update the simulated cashflow.",
    "D",
  );
  sheet.getRow(6).values = ["Assumption", "Value", "Unit", "Notes"];
  styleTableHeader(sheet.getRow(6), 1, 4);

  type Assumption = [string, string | number | boolean, string, string?];
  const sections: Array<[string, Assumption[]]> = [
    [
      "PROJECT",
      [
        ["Project name", config.project.name, ""],
        ["Start date", config.project.startDate, "date"],
        ["Planning horizon", config.project.months, "months"],
        ["Currency", config.project.currency, ""],
        ["Opening cash", config.project.openingCash, config.project.currency],
        ["Plan outcome mode", config.project.variation, "chance / settled"],
        ["Simulation seed", config.project.seed, ""],
      ],
    ],
    [
      "OPENING HERD & POLICY",
      [
        ["Opening sows", config.stock.sows, "head"],
        ["Opening gilts", config.stock.gilts, "head"],
        ["Opening boars", config.stock.boars, "head"],
        ["Opening weaners", config.stock.weaners, "head"],
        ["Opening growers", config.stock.growers, "head"],
        ["Opening finishers", config.stock.finishers, "head"],
        ["Herd start mode", config.herd.startMode, ""],
        ["Maximum sows", config.herd.maxSows, "head"],
        ["Cull after parity", config.herd.cullAfterParity, "parities"],
        ["Retain home-bred gilts", config.herd.retainHomeBredGilts, "yes/no"],
        ["Buy gilts when short", config.herd.buyGiltsWhenShort, "yes/no"],
        ["Sow & boar mortality", config.herd.sowAnnualMortalityPct, "% per year"],
        ["Gilt selection weight", config.herd.giltSelectionWeightKg, "kg"],
        ["Gilt puberty age", config.herd.giltPubertyAgeDays, "days"],
        ["Gilt puberty weight", config.herd.giltPubertyWeightKg, "kg"],
        ["Served on heat number", config.herd.giltServeAtHeat, "standing heat"],
        ["Gilt service weight floor", config.herd.giltServiceWeightKg, "kg"],
        ["Gilt service age floor", config.herd.giltServiceAgeDays, "days"],
        ["Gilt service age, as planned", expectedGiltServiceAgeDays(config), "days"],
        ["Gilt purchase cost", config.herd.giltPurchaseCost, config.project.currency],
        ["Boar purchase cost", config.herd.boarPurchaseCost, config.project.currency],
        [
          "Boar working life",
          config.herd.boarWorkingLifeMonths,
          "months",
          "Boars are rotated off at this point, and no female is ever served by her own sire.",
        ],
        ["Surplus gilt sale value", config.herd.surplusGiltSaleValue, config.project.currency],
        ["Cull sow sale value", config.herd.cullSowSaleValue, config.project.currency],
        ["Late returns", config.reproduction.irregularReturnSharePct, "% of returns"],
        ["Pregnancy scan", config.reproduction.pregnancyScanDays, "days after service"],
        ["Scan cost", config.reproduction.pregnancyScanCost, config.project.currency],
        ["Artificial insemination", config.service.useAi ? "Yes" : "No", ""],
        ["AI share of services", config.service.aiSharePct, "%"],
        ["AI cost per service", config.service.aiCostPerService, config.project.currency],
        ["AI doses per service", config.service.aiInseminationsPerService, "doses"],
        ["AI conception difference", config.service.aiConceptionDeltaPct, "percentage points"],
        ["AI stud lines", config.service.aiStudPanelSize, "studs"],
      ],
    ],
    [
      "REPRODUCTION",
      [
        ["Gestation", config.reproduction.gestationDays, "days"],
        ["Weaning age", config.reproduction.weaningAgeDays, "days"],
        ["Wean-to-service", config.reproduction.weanToServiceDays, "days"],
        ["Farrowing success", config.reproduction.farrowingSuccessPct, "%"],
        ["Born alive per litter", config.reproduction.bornAlivePerLitter, "piglets"],
        ["Pre-weaning mortality", config.reproduction.preWeanMortalityPct, "%"],
      ],
    ],
    [
      "GROWTH",
      Object.entries(config.growth).map(([key, value]) => [
        key.replace(/([A-Z])/g, " $1").replace(/^./, (character) => character.toUpperCase()),
        value,
        growthUnit(key),
      ]),
    ],
    [
      "FEED",
      Object.entries(config.feed).map(([key, value]) => [
        key.replace(/([A-Z])/g, " $1").replace(/^./, (character) => character.toUpperCase()),
        value,
        feedUnit(key, config.project.currency),
      ]),
    ],
    [
      "FEED DELIVERY",
      [
        [
          "Truck capacity",
          config.feed.truckCapacityKg,
          "kg on the deck",
          "Everything one journey can carry. The plan's whole use is cut into loads of this size, every ration on the same deck.",
        ],
        [
          "Held back for sundries",
          config.feed.sundriesAllowanceKg,
          "kg",
          "Weight kept clear of the feed order for the gas and the vaccines, so they ride along instead of sending a vehicle.",
        ],
        [
          "Cost per delivery",
          config.feed.deliveryCostPerTrip,
          `${config.project.currency}/load`,
          "Haulage rides on the kilograms delivered, so it reaches each pig as that pig eats.",
        ],
        [
          "Feed buffer held",
          config.feed.feedBufferDays,
          "days",
          "Each load lands this many days before the herd starts eating into it.",
        ],
      ],
    ],
    [
      "HAULAGE TO ABATTOIR",
      [
        [
          "Lorry capacity",
          config.finance.marketTruckCapacityPigs,
          "pigs per run",
          "Sold pigs travel alive on the day they are sold, as many runs as the head needs.",
        ],
        [
          "Cost per run",
          config.finance.marketTripCost,
          `${config.project.currency}/run`,
          "Charged to the pigs that were on the lorry, so a half-empty run still costs a full trip.",
        ],
      ],
    ],
    [
      "LABOUR",
      [
        [
          "Wage per stockperson",
          config.finance.labourCostPerWorkerMonth,
          `${config.project.currency}/month`,
          "Charged for every stockperson the herd size calls for.",
        ],
        [
          "Pigs per stockperson",
          config.finance.pigsPerWorker,
          "head",
          "The wage bill is re-read from the stock on the ground each month.",
        ],
        ["Minimum stockpeople", config.finance.minimumWorkers, "people"],
      ],
    ],
    [
      "HEALTH",
      [
        ["Veterinary cost per sow", config.health.vetCostPerSowMonth, `${config.project.currency}/month`],
        ["Gas per heater", config.health.gasKgPerHeaterDay, "kg/night"],
        ["Piglets a heater covers", config.health.pigletsPerHeater, "head"],
        ["Gas price", config.health.gasCostPerKg, `${config.project.currency}/kg`],
        ["Gas canister", config.health.gasCanisterKg, "kg"],
        ["Canisters on the farm", config.health.gasCanisters, "bottles"],
        ["Heated until age", config.health.heatedUntilAgeDays, "days"],
        ["Bedding per head", config.housing.beddingKgPerHeadDay, "kg/head/day"],
        ["Bedding price", config.housing.beddingCostPerKg, `${config.project.currency}/kg`],
        ["Bedding load", config.housing.beddingLoadKg, "kg"],
        ["Bedding delivery", config.housing.beddingDeliveryCost, `${config.project.currency}/trip`],
        [
          "Mortality timing",
          config.health.mortalityTiming,
          "",
          "Profiled timing uses explicit model assumptions documented on the Method & sources page; even timing spreads losses across the stage.",
        ],
      ],
    ],
    [
      "FINANCE",
      Object.entries(config.finance)
        .filter(
          (entry): entry is [string, number] =>
            typeof entry[1] === "number" &&
            !entry[0].startsWith("labour") &&
            !entry[0].startsWith("market") &&
            !entry[0].startsWith("pigsPer") &&
            entry[0] !== "minimumWorkers",
        )
        .map(([key, value]) => [
          key.replace(/([A-Z])/g, " $1").replace(/^./, (character) => character.toUpperCase()),
          value,
          key === "salePriceKg"
            ? `${config.project.currency}/kg deadweight`
            : key.toLowerCase().includes("pct")
              ? "%"
              : config.project.currency,
        ]),
    ],
  ];

  let row = 7;
  for (const [section, assumptions] of sections) {
    sheet.getCell(row, 1).value = section;
    styleSection(sheet.getRow(row), 4);
    row += 1;
    for (const [label, value, unit, notes = ""] of assumptions) {
      sheet.getCell(row, 1).value = label;
      sheet.getCell(row, 2).value = typeof value === "boolean" ? (value ? "Yes" : "No") : value;
      if (unit) sheet.getCell(row, 3).value = unit;
      if (notes) sheet.getCell(row, 4).value = notes;
      sheet.getCell(row, 2).font = { name: FONT, size: 10, color: { argb: "0563C1" } };
      sheet.getCell(row, 2).fill = solidFill(COLORS.paleGold);
      forCells(sheet, row, row, 1, 4, (cell) => {
        cell.border = { bottom: { style: "thin", color: { argb: COLORS.line } } };
      });
      row += 1;
    }
    row += 1;
  }

  sheet.getCell(row, 1).value = "VACCINATION SCHEDULE";
  styleSection(sheet.getRow(row), 4);
  row += 1;
  sheet.getRow(row).values = ["Treatment", "Age", "Cost per pig", "Unit"];
  styleTableHeader(sheet.getRow(row), 1, 4);
  for (const vaccination of config.health.vaccinations) {
    row += 1;
    sheet.getRow(row).values = [
      vaccination.name,
      vaccination.ageDays,
      vaccination.costPerPig,
      config.project.currency,
    ];
    sheet.getCell(row, 3).numFmt = MONEY_FORMAT_DECIMAL;
  }
  applyBase(sheet);
  sheet.headerFooter.oddFooter = "&LModel assumptions&RPage &P of &N";
  return sheet;
}

export async function buildCashflowWorkbook(
  config: PlannerConfig,
  projection: ProjectionResult,
  generatedAt = new Date(),
): Promise<ArrayBuffer> {
  const excelModule = await import("exceljs");
  const Workbook = excelModule.Workbook ?? excelModule.default.Workbook;
  const workbook = new Workbook();
  workbook.creator = "PigFlow";
  workbook.title = `${config.project.name} funding cashflow`;
  workbook.subject = "Detailed piggery cashflow and production plan";
  workbook.description =
    "Funder-ready cashflow generated from the PigFlow animal-level simulation.";
  workbook.company = config.project.name;
  workbook.created = generatedAt;
  workbook.modified = generatedAt;
  workbook.calcProperties.fullCalcOnLoad = true;

  addSummarySheet(workbook, config, projection, generatedAt);
  addCashFlowSheet(workbook, config, projection);
  addHerdSheet(workbook, config, projection);
  addAssumptionsSheet(workbook, config);

  const output = await workbook.xlsx.writeBuffer();
  if (output instanceof ArrayBuffer) return output;
  const bytes = new Uint8Array(output);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
