import { Workbook } from "exceljs";
import { describe, expect, it } from "vitest";

import { buildCashflowWorkbook } from "./export-workbook";
import { calculateProjection, cloneDefaultConfig } from "./model";
import { CATEGORY_LABELS, EXPENSE_CATEGORIES, INCOME_CATEGORIES } from "./sim";

describe("Funding cashflow workbook", () => {
  it("exports an auditable lender-facing workbook", async () => {
    const config = cloneDefaultConfig();
    const projection = calculateProjection(config);
    const output = await buildCashflowWorkbook(config, projection, new Date("2027-01-01T00:00:00Z"));
    const workbook = new Workbook();
    await workbook.xlsx.load(Buffer.from(output) as never);

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      "Summary",
      "Cash Flow",
      "Herd Plan",
      "Farm Worth",
      "Assumptions",
    ]);

    const cashFlow = workbook.getWorksheet("Cash Flow")!;
    expect(cashFlow.getCell("B4").value).toBe(config.project.openingCash);
    expect(cashFlow.getCell("B7").value).toBe(projection.months[0].totals["pig-sales"]);
    // Rows are found by their label rather than counted, because the cash lines
    // come from the ledger: adding one moves every row below it, and a test that
    // counted would have to be re-counted every time rather than re-run.
    const rowOf = (label: string) => {
      for (let row = 1; row <= cashFlow.rowCount; row += 1) {
        if (String(cashFlow.getCell(`A${row}`).value ?? "").trim() === label) return row;
      }
      throw new Error(`no row labelled ${label}`);
    };
    const receiptsTotalRow = rowOf("Total receipts");
    const paymentsTotalRow = rowOf("Total payments");
    const netRow = rowOf("Net cash flow");
    const closingRow = rowOf("Closing cash balance");
    const deliveriesRow = rowOf("Deliveries to the farm");

    // Every ledger line has a row of its own, receipts above payments.
    for (const category of INCOME_CATEGORIES) expect(rowOf(CATEGORY_LABELS[category])).toBeLessThan(receiptsTotalRow);
    for (const category of EXPENSE_CATEGORIES) {
      const row = rowOf(CATEGORY_LABELS[category]);
      expect(row).toBeGreaterThan(receiptsTotalRow);
      expect(row).toBeLessThan(paymentsTotalRow);
    }
    expect(cashFlow.getCell(`A${deliveriesRow}`).value).toBe("  Deliveries to the farm");
    expect(cashFlow.getCell(`B${deliveriesRow}`).value).toBe(
      projection.months[0].totals.deliveries,
    );
    expect(cashFlow.getCell(`B${netRow}`).formula).toBe(
      `B${receiptsTotalRow}-B${paymentsTotalRow}`,
    );
    expect(cashFlow.getCell(`B${closingRow}`).result).toBeCloseTo(
      projection.months[0].closingCash,
      6,
    );

    // The month headings are read back as the months the plan actually covers.
    // ExcelJS serialises a Date off its UTC epoch, so building these cells at
    // local midnight used to push every heading a month early.
    expect(cashFlow.getCell("B5").value).toEqual(new Date("2027-01-01T00:00:00Z"));
    expect(cashFlow.getCell(5, projection.months.length + 1).value).toEqual(
      new Date("2029-12-01T00:00:00Z"),
    );

    const summary = workbook.getWorksheet("Summary")!;
    expect(summary.getCell("B2").value).toContain(config.project.name);
    expect(summary.getCell("F8").value).toBe(projection.summary.peakFundingNeed);

    const herd = workbook.getWorksheet("Herd Plan")!;
    expect(herd.rowCount).toBeGreaterThan(config.project.months);
    // The plan starts on 1 January 2027 and runs 36 months, so the herd sheet
    // has to start there too — not in the December before it.
    expect(herd.getCell(7, 1).value).toEqual(new Date("2027-01-01T00:00:00Z"));
    expect(herd.getCell(7 + config.project.months - 1, 1).value).toEqual(
      new Date("2029-12-01T00:00:00Z"),
    );
    // The experimental second reading gets a sheet of its own rather than extra
    // columns on the cashflow, so a lender is never shown two profit figures
    // under one heading.
    const worth = workbook.getWorksheet("Farm Worth")!;
    expect(String(worth.getCell("A2").value)).toContain("Experimental");
    expect(worth.getCell(7, 1).value).toEqual(new Date("2027-01-01T00:00:00Z"));
    const firstMonth = projection.months[0];
    expect(Number(worth.getCell(7, 2).value)).toBeCloseTo(
      firstMonth.revenue - firstMonth.totalCost,
      6,
    );
    expect(Number(worth.getCell(7, 3).value) - Number(worth.getCell(7, 2).value)).toBeCloseTo(
      Number(worth.getCell(7, 4).value),
      6,
    );
    const netWorthRow = (() => {
      for (let row = 1; row <= worth.rowCount; row += 1) {
        if (String(worth.getCell(`A${row}`).value ?? "").trim() === "Farm net worth") return row;
      }
      throw new Error("no farm net worth row");
    })();
    expect(Number(worth.getCell(netWorthRow, 2).value)).toBeCloseTo(
      projection.farmWorth.netWorth,
      6,
    );

    const assumptions = workbook.getWorksheet("Assumptions")!;
    expect(assumptions.getCell("A2").value).toBe("Model assumptions");
  }, 20_000);

  /**
   * The workbook says "cash" at the top of every money column it prints, and on
   * the 2.0 engine bought on supplier terms that is a different number from the
   * profit and loss. It used to foot those columns with `totalCost` — the
   * accrual figure — so the lines were the money and the total was the cost, and
   * a lender reading a plan with real credit on it got a "Total payments" that
   * did not add up its own rows.
   *
   * So this asserts the property rather than the numbers: every total labelled
   * as cash foots the cash lines printed beneath it, and the plan is one where
   * that is a real distinction.
   */
  it("foots every payments total from the cash book, not the profit and loss", async () => {
    const config = cloneDefaultConfig();
    config.project.months = 24;
    config.project.engine = "2.0";
    config.project.variation = "settled";
    config.finance.accrualAccounting = true;
    config.feed.supplierPaymentDays = 30;

    const projection = calculateProjection(config);

    // Without this the test would pass on a workbook that never told the two
    // books apart, and would go on passing if the fix were reverted.
    const diverges = projection.months.some(
      (month) => Math.abs(month.totalCost - month.cashOut) > 1,
    );
    expect(diverges, "plan must accrue differently from how it pays").toBe(true);

    const output = await buildCashflowWorkbook(config, projection, new Date("2027-01-01T00:00:00Z"));
    const workbook = new Workbook();
    await workbook.xlsx.load(Buffer.from(output) as never);

    const cashFlow = workbook.getWorksheet("Cash Flow")!;
    const rowOf = (label: string) => {
      for (let row = 1; row <= cashFlow.rowCount; row += 1) {
        if (String(cashFlow.getCell(`A${row}`).value ?? "").trim() === label) return row;
      }
      throw new Error(`no row labelled ${label}`);
    };
    const paymentsTotalRow = rowOf("Total payments");
    const receiptsTotalRow = rowOf("Total receipts");
    const firstPaymentRow = rowOf(CATEGORY_LABELS[EXPENSE_CATEGORIES[0]]);
    const firstReceiptRow = rowOf(CATEGORY_LABELS[INCOME_CATEGORIES[0]]);

    const cached = (row: number, column: number) => {
      const cell = cashFlow.getCell(row, column);
      const value = cell.value as { result?: number } | number | null;
      return typeof value === "object" && value !== null ? (value.result ?? 0) : Number(value ?? 0);
    };

    projection.months.forEach((month, index) => {
      const column = index + 2;
      const paid = EXPENSE_CATEGORIES.reduce(
        (sum, _category, line) => sum + cached(firstPaymentRow + line, column),
        0,
      );
      const received = INCOME_CATEGORIES.reduce(
        (sum, _category, line) => sum + cached(firstReceiptRow + line, column),
        0,
      );
      expect(cached(paymentsTotalRow, column), `payments ${month.month}`).toBeCloseTo(paid, 6);
      expect(cached(paymentsTotalRow, column), `payments ${month.month}`).toBeCloseTo(
        month.cashOut,
        6,
      );
      expect(cached(receiptsTotalRow, column), `receipts ${month.month}`).toBeCloseTo(received, 6);
      expect(cached(receiptsTotalRow, column), `receipts ${month.month}`).toBeCloseTo(
        month.cashIn,
        6,
      );
    });

    // The plan-total column at the right of the sheet.
    const totalColumn = projection.months.length + 2;
    const cashOut = projection.months.reduce((sum, month) => sum + month.cashOut, 0);
    const cashIn = projection.months.reduce((sum, month) => sum + month.cashIn, 0);
    expect(cached(paymentsTotalRow, totalColumn)).toBeCloseTo(cashOut, 6);
    expect(cached(receiptsTotalRow, totalColumn)).toBeCloseTo(cashIn, 6);

    // The funding overview and the annual table on the Summary sheet, both of
    // which are headed as cash and were both reading the profit and loss.
    const summary = workbook.getWorksheet("Summary")!;
    const labelled = (label: string) => {
      for (let row = 1; row <= summary.rowCount; row += 1) {
        for (const column of [2, 5]) {
          if (String(summary.getCell(row, column).value ?? "").trim() === label) {
            return Number(summary.getCell(row, column + 1).value ?? 0);
          }
        }
      }
      throw new Error(`no metric labelled ${label}`);
    };
    expect(labelled("Total payments")).toBeCloseTo(cashOut, 6);
    expect(labelled("Total receipts")).toBeCloseTo(cashIn, 6);

    const annualHeader = 19;
    projection.years.forEach((year, index) => {
      const row = annualHeader + 1 + index;
      expect(summary.getCell(row, 4).value, `${year.label} payments`).toBeCloseTo(year.cashOut, 6);
      expect(summary.getCell(row, 3).value, `${year.label} receipts`).toBeCloseTo(year.cashIn, 6);
    });

    // And the workbook's own reconciliation row still nets to nothing, which it
    // would not if only one of the two places had been corrected.
    expect(
      projection.years.reduce((sum, year) => sum + year.cashOut, 0),
    ).toBeCloseTo(cashOut, 6);
  }, 120_000);
});
