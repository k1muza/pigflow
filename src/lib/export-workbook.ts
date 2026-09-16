import type { Cell, Row, Worksheet } from "exceljs";

import type { PlannerConfig, ProjectionResult } from "./model";

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
    ["Opening cash + total net cash − closing cash", `'Cash Flow'!B4+'Cash Flow'!${columnLetter(projection.months.length + 2)}26-'Cash Flow'!${monthlyLastColumn}27`, 0],
    ["Annual receipts less monthly receipts", `SUM(C20:C${19 + projection.years.length})-'Cash Flow'!${columnLetter(projection.months.length + 2)}11`, 0],
    ["Annual payments less monthly payments", `SUM(D20:D${19 + projection.years.length})-'Cash Flow'!${columnLetter(projection.months.length + 2)}24`, 0],
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

  const lines = [
    [4, "Opening cash balance"],
    [6, "CASH RECEIPTS"],
    [7, "  Pig sales"],
    [8, "  Breeding gilt sales"],
    [9, "  Cull sow sales"],
    [10, "  Other income"],
    [11, "Total receipts"],
    [13, "CASH PAYMENTS"],
    [14, "  Feed"],
    [15, "  Vaccination & treatment"],
    [16, "  Routine veterinary"],
    [17, "  Heating"],
    [18, "  Labour"],
    [19, "  Fixed overheads"],
    [20, "  Transport"],
    [21, "  Bought-in breeding stock"],
    [22, "  Contingency"],
    [23, "  Capital expenditure"],
    [24, "Total payments"],
    [26, "Net cash flow"],
    [27, "Closing cash balance"],
    [28, "Funding requirement"],
  ] as const;
  for (const [row, label] of lines) sheet.getCell(row, 1).value = label;
  styleSection(sheet.getRow(6), totalColumn);
  styleSection(sheet.getRow(13), totalColumn);

  projection.months.forEach((month, index) => {
    const column = index + 2;
    const letter = columnLetter(column);
    const priorLetter = columnLetter(column - 1);
    const values: Array<[number, number]> = [
      [7, month.totals["pig-sales"]],
      [8, month.totals["gilt-sales"]],
      [9, month.totals["cull-sales"]],
      [10, month.totals["other-income"]],
      [14, month.totals.feed],
      [15, month.totals.vaccination],
      [16, month.totals.veterinary],
      [17, month.totals.heating],
      [18, month.totals.labour],
      [19, month.totals.overheads],
      [20, month.totals.transport],
      [21, month.totals["breeding-stock"]],
      [22, month.totals.contingency],
      [23, month.totals.capital],
    ];
    values.forEach(([row, value]) => {
      sheet.getCell(row, column).value = value;
    });
    sheet.getCell(4, column).value =
      index === 0
        ? config.project.openingCash
        : { formula: `${priorLetter}27`, result: projection.months[index - 1].closingCash };
    setResultFormula(sheet.getCell(11, column), `SUM(${letter}7:${letter}10)`, month.revenue);
    setResultFormula(
      sheet.getCell(24, column),
      `SUM(${letter}14:${letter}23)`,
      month.totalCost,
    );
    setResultFormula(
      sheet.getCell(26, column),
      `${letter}11-${letter}24`,
      month.netCashFlow,
    );
    setResultFormula(
      sheet.getCell(27, column),
      `${letter}4+${letter}26`,
      month.closingCash,
    );
    setResultFormula(
      sheet.getCell(28, column),
      `MAX(0,-${letter}27)`,
      Math.max(0, -month.closingCash),
    );
  });

  [7, 8, 9, 10, 11, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 26].forEach((row) => {
    const result =
      row === 11
        ? projection.summary.totalRevenue
        : row === 24
          ? projection.summary.totalCost
          : row === 26
            ? projection.months.reduce((sum, month) => sum + month.netCashFlow, 0)
            : projection.months.reduce((sum, month) => {
                const lineByRow: Record<number, number> = {
                  7: month.totals["pig-sales"],
                  8: month.totals["gilt-sales"],
                  9: month.totals["cull-sales"],
                  10: month.totals["other-income"],
                  14: month.totals.feed,
                  15: month.totals.vaccination,
                  16: month.totals.veterinary,
                  17: month.totals.heating,
                  18: month.totals.labour,
                  19: month.totals.overheads,
                  20: month.totals.transport,
                  21: month.totals["breeding-stock"],
                  22: month.totals.contingency,
                  23: month.totals.capital,
                };
                return sum + (lineByRow[row] ?? 0);
              }, 0);
    setResultFormula(sheet.getCell(row, totalColumn), `SUM(B${row}:${columnLetter(monthCount + 1)}${row})`, result);
  });
  sheet.getCell(4, totalColumn).value = config.project.openingCash;
  sheet.getCell(27, totalColumn).value = projection.summary.closingCash;
  setResultFormula(
    sheet.getCell(28, totalColumn),
    `MAX(B28:${columnLetter(monthCount + 1)}28)`,
    projection.summary.peakFundingNeed,
  );

  // Row 5 carries the month headings and keeps its own date format; sweeping the
  // money format across it would render each heading as a currency amount.
  forCells(sheet, 4, 4, 2, totalColumn, (cell) => {
    cell.numFmt = MONEY_FORMAT;
  });
  forCells(sheet, 6, 28, 2, totalColumn, (cell) => {
    cell.numFmt = MONEY_FORMAT;
  });
  [11, 24, 26, 27, 28].forEach((row) => styleTotal(sheet.getRow(row), totalColumn, row >= 26));
  forCells(sheet, 28, 28, 1, totalColumn, (cell) => {
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
        ["Gilt service weight", config.herd.giltServiceWeightKg, "kg"],
        ["Gilt service age", config.herd.giltServiceAgeDays, "days"],
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
        key.toLowerCase().includes("mortality") ? "% per stage" : key.toLowerCase().includes("fcr") ? "feed/gain" : key.toLowerCase().includes("gain") ? "kg/day" : "kg",
      ]),
    ],
    [
      "FEED",
      Object.entries(config.feed).map(([key, value]) => [
        key.replace(/([A-Z])/g, " $1").replace(/^./, (character) => character.toUpperCase()),
        value,
        key.toLowerCase().includes("cost") ? `${config.project.currency}/kg` : key.toLowerCase().includes("age") ? "days" : "kg/day",
      ]),
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
        ["Heating cost per pig", config.health.heatingCostPerPigDay, `${config.project.currency}/day`],
        ["Heated until age", config.health.heatedUntilAgeDays, "days"],
      ],
    ],
    [
      "FINANCE",
      Object.entries(config.finance)
        .filter(([key]) => !key.startsWith("labour") && !key.startsWith("pigsPer") && key !== "minimumWorkers")
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
