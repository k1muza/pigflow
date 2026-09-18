import { describe, expect, it } from "vitest";

import { cloneDefaultConfig, type PlannerConfig } from "../config";
import { calculateProjection, projectionToCsv } from "../model";
import { EXPENSE_CATEGORIES, FEED_CATEGORIES, INCOME_CATEGORIES } from "../sim";

/**
 * The two statements, as the rest of the product sees them.
 *
 * The engine having a cash book is worth nothing if the projection the cashflow
 * page, the workbook and the CSV read only exposes the profit and loss. These
 * tests are about the shape rather than the simulation: whichever engine ran the
 * plan, a statement headed "cash" has to reconcile against the bank balance, and
 * a statement headed "cost" has to reconcile against what was consumed.
 */

function plan(tweak: (input: PlannerConfig) => void = () => {}): PlannerConfig {
  const input = cloneDefaultConfig();
  input.project.months = 24;
  input.project.variation = "settled";
  tweak(input);
  return input;
}

/** The 2.0 engine with the books kept properly and feed bought on terms. */
function accrualPlan(): PlannerConfig {
  return plan((c) => {
    c.project.engine = "2.0";
    c.finance.accrualAccounting = true;
    c.feed.supplierPaymentDays = 30;
  });
}

/** Every 2.0 subsystem down: one book, and the two statements must coincide. */
function portOnlyPlan(): PlannerConfig {
  return plan((c) => {
    c.project.engine = "2.0";
    c.housing.enforceCapacity = false;
    c.reproduction.enforceEstrusWindows = false;
    c.feed.procurementMode = "foresight";
    c.finance.accrualAccounting = false;
  });
}

describe("The cash book reaches the projection the product reads", () => {
  it("reconciles month by month against the bank balance, on either engine", () => {
    for (const [name, input] of [
      ["1.x", plan()],
      ["2.0 accrual", accrualPlan()],
    ] as const) {
      const projection = calculateProjection(input);
      let balance = input.project.openingCash;
      for (const month of projection.months) {
        // The cash statement is self-consistent: its lines add to its totals,
        // its totals add to its net, and its net moves the bank by that much.
        expect(
          INCOME_CATEGORIES.reduce((sum, c) => sum + month.cashTotals[c], 0),
          name + " " + month.month,
        ).toBeCloseTo(month.cashIn, 6);
        expect(
          EXPENSE_CATEGORIES.reduce((sum, c) => sum + month.cashTotals[c], 0),
          name + " " + month.month,
        ).toBeCloseTo(month.cashOut, 6);
        expect(month.netCashFlow, name).toBeCloseTo(month.cashIn - month.cashOut, 6);
        balance += month.netCashFlow;
        expect(month.closingCash, name + " " + month.month).toBeCloseTo(balance, 6);
      }
    }
  }, 120_000);

  it("keeps the profit and loss separate, and it does not have to agree", () => {
    const projection = calculateProjection(accrualPlan());
    const feedConsumed = projection.months.reduce(
      (sum, month) => sum + FEED_CATEGORIES.reduce((line, c) => line + month.totals[c], 0),
      0,
    );
    const feedPaid = projection.months.reduce(
      (sum, month) => sum + FEED_CATEGORIES.reduce((line, c) => line + month.cashTotals[c], 0),
      0,
    );
    expect(feedConsumed).toBeGreaterThan(0);
    expect(feedPaid).toBeGreaterThan(0);

    // Feed bought on thirty-day terms and eaten over six weeks is paid for in a
    // different month from the one it was eaten in, so over a finite horizon the
    // two totals cannot match — and the gap is the stock and the debt behind it.
    expect(feedPaid).not.toBeCloseTo(feedConsumed, 2);
    expect(projection.months.at(-1)!.payables).toBeGreaterThan(0);

    // The profit and loss is the thing a margin is read off, so it must keep
    // reading the accrual side.
    const revenue = projection.months.reduce((sum, month) => sum + month.revenue, 0);
    expect(revenue).toBeCloseTo(projection.summary.totalRevenue, 6);
  }, 60_000);

  it("collapses the two statements into one when the engine keeps one book", () => {
    for (const input of [plan(), portOnlyPlan()]) {
      const projection = calculateProjection(input);
      for (const month of projection.months) {
        for (const category of [...INCOME_CATEGORIES, ...EXPENSE_CATEGORIES]) {
          expect(month.cashTotals[category]).toBeCloseTo(month.totals[category], 6);
        }
        expect(month.cashIn).toBeCloseTo(month.revenue, 6);
        expect(month.cashOut).toBeCloseTo(month.totalCost, 6);
        expect(month.payables).toBe(0);
      }
    }
  }, 120_000);

  it("rolls the same two statements up into plan years", () => {
    const projection = calculateProjection(accrualPlan());
    for (const year of projection.years) {
      const covered = projection.months.filter((month) => year.months.includes(month.index));
      expect(year.cashIn).toBeCloseTo(
        covered.reduce((sum, month) => sum + month.cashIn, 0),
        6,
      );
      expect(year.cashOut).toBeCloseTo(
        covered.reduce((sum, month) => sum + month.cashOut, 0),
        6,
      );
      expect(year.revenue).toBeCloseTo(
        covered.reduce((sum, month) => sum + month.revenue, 0),
        6,
      );
      expect(year.payables).toBe(covered.at(-1)!.payables);
    }
  }, 60_000);

  it("exports both statements, so a reader can see which one they have", () => {
    const csv = projectionToCsv(calculateProjection(accrualPlan()));
    const header = csv.split("\n")[0];
    expect(header).toContain('"Sow & gilt feed"');
    expect(header).toContain('"Sow & gilt feed (cash)"');
    expect(header).toContain('"Cash in"');
    expect(header).toContain('"Cash out"');
    expect(header).toContain('"Owed to suppliers"');

    // And the two columns really do carry different numbers.
    const columns = header.split(",");
    const consumed = columns.indexOf('"Sow & gilt feed"');
    const paid = columns.indexOf('"Sow & gilt feed (cash)"');
    const rows = csv.split("\n").slice(1);
    const differs = rows.some((row) => {
      const cells = row.split(",");
      return Math.abs(Number(cells[consumed]) - Number(cells[paid])) > 0.01;
    });
    expect(differs).toBe(true);
  }, 60_000);
});
