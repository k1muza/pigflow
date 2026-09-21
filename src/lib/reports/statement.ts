import type { Workbook, Worksheet } from "exceljs";

import { money, number as count } from "../format";
import {
  applyBase,
  columnLetter,
  COLORS,
  FONT,
  forCells,
  LANDSCAPE_PAGE,
  MONEY_FORMAT,
  NUMBER_FORMAT,
  ruleRow,
  setResultFormula,
  solidFill,
  styleSection,
  styleTableHeader,
  styleTitle,
  styleTotal,
} from "./sheet";

/**
 * A statement written the way an accountant writes one: the lines down the page
 * and the periods across it.
 *
 * All four reports are that shape, so they share this rather than each laying
 * out its own grid. A report supplies the lines and a way of reading each line
 * out of a period; where the rows land, which range a subtotal sums, and how a
 * strong rule is drawn under the bottom line are this file's business.
 *
 * Subtotals are written as real Excel formulas over the rows above them, with
 * the figure this application calculated as the cached result. The formula is
 * there so a reader can check the sheet adds up; the result is the answer. They
 * cannot disagree, because a row's value always comes from the same helper the
 * screen reads.
 */

/** One line of a statement, and how to read it out of a period. */
export type StatementRow<P> =
  /** A heading with nothing under it yet. */
  | { kind: "section"; label: string }
  /** A blank line, for air between blocks. */
  | { kind: "blank" }
  /** An ordinary line of figures. */
  | { kind: "line"; label: string; format?: LineFormat; value: (period: P) => number }
  /**
   * A line that adds up the run of ordinary lines directly above it. The value
   * is still read from the application rather than from the rows, so a subtotal
   * that did not foot would show up as a disagreement rather than be hidden.
   */
  | { kind: "total"; label: string; format?: LineFormat; value: (period: P) => number }
  /**
   * A figure that is not the sum of the rows above it — a gross profit, a
   * closing balance. Ruled off like a subtotal and written as a plain figure,
   * because inventing a formula for it would be inventing a derivation.
   */
  | { kind: "subtotal"; label: string; format?: LineFormat; value: (period: P) => number }
  /** The same, ruled off twice: the figure the statement exists to state. */
  | { kind: "result"; label: string; format?: LineFormat; value: (period: P) => number }
  /** A line that is not part of the statement, shown for reference. */
  | { kind: "memo"; label: string; format?: LineFormat; value: (period: P) => number };

type LineFormat = "money" | "number";

function numberFormatOf(format: LineFormat | undefined): string {
  return format === "number" ? NUMBER_FORMAT : MONEY_FORMAT;
}

export type StatementSheet<P> = {
  name: string;
  tabColor: string;
  title: string;
  subtitle: string;
  /** The column heading for each period: a Date renders as "mmm-yy". */
  heading: (period: P) => string | Date;
  periods: readonly P[];
  rows: readonly StatementRow<P>[];
  /** How wide the line-label column has to be for the longest label. */
  labelWidth?: number;
  columnWidth?: number;
  footer: string;
  /**
   * Whether the last column is a total over the ones before it rather than
   * another period. Only then is it shaded — a shaded final month would claim
   * to sum the months beside it.
   */
  totalsLastColumn?: boolean;
  /** Written under the table, one sentence to a line. */
  notes?: readonly string[];
};

const HEADER_ROW = 6;

export function addStatementSheet<P>(workbook: Workbook, sheet: StatementSheet<P>): Worksheet {
  const worksheet = workbook.addWorksheet(sheet.name, {
    properties: { tabColor: { argb: sheet.tabColor } },
    views: [{ state: "frozen", xSplit: 1, ySplit: HEADER_ROW, showGridLines: false }],
    pageSetup: { ...LANDSCAPE_PAGE, printTitlesRow: `1:${HEADER_ROW}`, printTitlesColumn: "1:1" },
  });

  const lastColumn = sheet.periods.length + 1;
  worksheet.getColumn(1).width = sheet.labelWidth ?? 38;
  for (let column = 2; column <= lastColumn; column += 1) {
    worksheet.getColumn(column).width = sheet.columnWidth ?? 14;
  }

  styleTitle(worksheet, sheet.title, sheet.subtitle, columnLetter(lastColumn));

  worksheet.getCell(HEADER_ROW, 1).value = "Line";
  sheet.periods.forEach((period, index) => {
    const cell = worksheet.getCell(HEADER_ROW, index + 2);
    const heading = sheet.heading(period);
    cell.value = heading;
    if (heading instanceof Date) cell.numFmt = "mmm-yy";
  });
  styleTableHeader(worksheet.getRow(HEADER_ROW), 1, lastColumn);

  // Where each row landed, so a subtotal can name the range it adds up.
  const rowAt = sheet.rows.map((_, index) => HEADER_ROW + 1 + index);
  const afterTable = HEADER_ROW + 1 + sheet.rows.length;

  sheet.rows.forEach((line, index) => {
    const at = rowAt[index];
    if (line.kind === "blank") return;
    worksheet.getCell(at, 1).value =
      line.kind === "section" || line.kind === "result" ? line.label : "  " + line.label;
    if (line.kind === "section") {
      styleSection(worksheet.getRow(at), lastColumn);
      return;
    }

    sheet.periods.forEach((period, column) => {
      const cell = worksheet.getCell(at, column + 2);
      const value = line.value(period);
      if (line.kind === "total") {
        const range = summedRange(sheet.rows, rowAt, index);
        const letter = columnLetter(column + 2);
        if (range) {
          setResultFormula(cell, `SUM(${letter}${range.from}:${letter}${range.to})`, value);
        } else {
          cell.value = value;
        }
      } else {
        cell.value = value;
      }
      cell.numFmt = numberFormatOf(line.format);
    });

    if (line.kind === "total" || line.kind === "subtotal") {
      styleTotal(worksheet.getRow(at), lastColumn);
    }
    if (line.kind === "result") styleTotal(worksheet.getRow(at), lastColumn, true);
    if (line.kind === "memo") {
      forCells(worksheet, at, at, 1, lastColumn, (cell) => {
        cell.font = { name: FONT, size: 10, italic: true, color: { argb: COLORS.muted } };
      });
    }
    if (line.kind === "line" || line.kind === "memo") ruleRow(worksheet, at, lastColumn);
  });

  let noteRow = afterTable + 1;
  for (const note of sheet.notes ?? []) {
    worksheet.mergeCells(noteRow, 1, noteRow, Math.max(lastColumn, 2));
    worksheet.getCell(noteRow, 1).value = note;
    worksheet.getCell(noteRow, 1).alignment = { wrapText: true, vertical: "top" };
    worksheet.getCell(noteRow, 1).font = {
      name: FONT,
      size: 9,
      italic: true,
      color: { argb: COLORS.muted },
    };
    worksheet.getRow(noteRow).height = 26;
    noteRow += 1;
  }

  if (sheet.totalsLastColumn) {
    worksheet.getColumn(lastColumn).fill = solidFill(COLORS.plane);
  }
  applyBase(worksheet);
  worksheet.headerFooter.oddFooter = `&L${sheet.footer}&RPage &P of &N`;
  return worksheet;
}

/**
 * The run of ordinary lines a subtotal adds up: everything directly above it,
 * back to the last thing that was not one. Counted rather than written down, so
 * inserting a line into a block moves the range with it.
 */
function summedRange<P>(
  rows: readonly StatementRow<P>[],
  rowAt: readonly number[],
  index: number,
): { from: number; to: number } | null {
  let first = index;
  while (first > 0 && rows[first - 1].kind === "line") first -= 1;
  if (first === index) return null;
  return { from: rowAt[first], to: rowAt[index - 1] };
}

// ------------------------------------------------------- the same, on a screen

/** One line of a statement as the preview panel shows it. */
export type PreviewLine = {
  kind: Exclude<StatementRow<never>["kind"], "blank">;
  label: string;
  cells: string[];
};

/**
 * The statement rendered for a screen rather than for a file.
 *
 * Off the same rows the worksheet is written from, which is the point: the
 * preview is what the download contains and not a second summary of it that
 * somebody has to keep in step. Only the presentation differs — a screen has no
 * room for sixty columns, so the caller hands in the periods it wants.
 */
export function previewLines<P>(
  rows: readonly StatementRow<P>[],
  periods: readonly P[],
  currency: string,
): PreviewLine[] {
  return rows
    .filter((row) => row.kind !== "blank")
    .map((row) => ({
      kind: row.kind,
      label: row.label,
      cells:
        row.kind === "section"
          ? []
          : periods.map((period) =>
              row.format === "number"
                ? count(row.value(period), 0)
                : money(row.value(period), currency),
            ),
    }));
}
