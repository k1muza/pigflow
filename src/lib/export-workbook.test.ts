import { Workbook } from "exceljs";
import { describe, expect, it } from "vitest";

import { buildCashflowWorkbook } from "./export-workbook";
import { calculateProjection, cloneDefaultConfig } from "./model";

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
      "Assumptions",
    ]);

    const cashFlow = workbook.getWorksheet("Cash Flow")!;
    expect(cashFlow.getCell("B4").value).toBe(config.project.openingCash);
    expect(cashFlow.getCell("B7").value).toBe(projection.months[0].totals["pig-sales"]);
    // Rows are counted off the line lists, so the totals move with them: four
    // receipt lines and twelve payment lines put total receipts on 11, total
    // payments on 26, net cash flow on 28 and the closing balance on 29.
    expect(cashFlow.getCell("A15").value).toBe("  Feed delivery");
    expect(cashFlow.getCell("B15").value).toBe(projection.months[0].totals["feed-haulage"]);
    expect(cashFlow.getCell("B28").formula).toBe("B11-B26");
    expect(cashFlow.getCell("B29").result).toBeCloseTo(projection.months[0].closingCash, 6);

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
    const assumptions = workbook.getWorksheet("Assumptions")!;
    expect(assumptions.getCell("A2").value).toBe("Model assumptions");
  }, 20_000);
});
