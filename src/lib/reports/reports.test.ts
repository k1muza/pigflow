import { Workbook } from "exceljs";
import { describe, expect, it } from "vitest";

import { currentProfitOrLoss, inventoryAdjustedProfit } from "../accounts";
import { buildWarnings, cloneDefaultConfig, type PlannerConfig } from "../model";
import { planFunding } from "../funding";
import { simulatePlan } from "../simulation";
import { planResultOf, type PlanSimulationResult } from "../simulation-result";
import { balanceSheetReport } from "./balance-sheet";
import { fundingPlanReport } from "./funding-plan";
import { herdDevelopmentReport } from "./herd-development";
import { housingNeedsReport } from "./housing-needs";
import { monthPeriods, openingWorthOf, wholePlanPeriod, yearPeriods } from "./periods";
import { profitAndLossReport, tradingStatement } from "./profit-and-loss";
import { REPORTS, reportFilename, reportById } from "./index";

/**
 * The reports are read off a finished run rather than worked out again, and
 * these are the assertions that say so. Each one takes a figure a document
 * prints and holds it against the figure the application shows for the same
 * thing: if a report ever grows arithmetic of its own, this is where it shows
 * up — as a document that disagrees with the page it was generated from.
 *
 * One run for the whole file. A plan is expensive to simulate and every test
 * here is a different reading of the same one, which is exactly the property
 * the report centre exists to guarantee.
 */
const GENERATED_AT = new Date("2027-01-01T00:00:00Z");

function planOf(edit?: (config: PlannerConfig) => void): PlanSimulationResult {
  const config = cloneDefaultConfig();
  edit?.(config);
  return planResultOf(simulatePlan(config));
}

const plan = planOf();

/**
 * A plan that cannot pay for itself, and the same plan run on each engine.
 *
 * Hoisted because a farm is expensive to simulate and several cases below are
 * different questions about the same run. Simulating one per case made this
 * file slow enough to push the rest of the suite past its reporting timeout.
 */
const hungry = planOf((config) => {
  config.project.openingCash = 0;
  config.finance.workingCapitalTarget = 5_000;
});

const byEngine = {
  "1.x": planOf((config) => {
    config.project.engine = "1.x";
    config.project.months = 30;
  }),
  "2.0": planOf((config) => {
    config.project.engine = "2.0";
    config.project.months = 30;
  }),
} as const;

/** Money settles to the cent, so figures are held to six places, not to the bit. */
const PLACES = 6;

describe("the report catalogue", () => {
  it("offers the five planning documents, each able to write its own file", () => {
    expect(REPORTS.map((report) => report.id)).toEqual([
      "profit-and-loss",
      "balance-sheet",
      "funding-plan",
      "herd-development",
      "housing-needs",
    ]);
    for (const report of REPORTS) {
      expect(report.name.length).toBeGreaterThan(0);
      expect(report.description.length).toBeGreaterThan(0);
      expect(reportById(report.id)).toBe(report);
      expect(reportFilename(plan.config, report)).toMatch(/^[a-z0-9-]+\.xlsx$/);
    }
  });

  it("names a file after the plan it came from", () => {
    const report = reportById("funding-plan");
    expect(reportFilename({ ...plan.config, project: { ...plan.config.project, name: "Ridge Farm 2!" } }, report)).toBe(
      "ridge-farm-2-proposed-funding-plan.xlsx",
    );
  });

  it("previews every report off the same run it would download", () => {
    for (const report of REPORTS) {
      const preview = report.preview(plan);
      expect(preview.facts.length).toBeGreaterThan(0);
      expect(preview.lines.length).toBeGreaterThan(0);
      // Every line of figures has one cell per column, so nothing is silently
      // printed against the wrong period.
      for (const line of preview.lines) {
        if (line.kind === "section") continue;
        expect(line.cells).toHaveLength(preview.columns.length);
      }
    }
  });
});

describe("the projected profit and loss", () => {
  const report = profitAndLossReport(plan);

  it("states the profit the application states", () => {
    for (const [index, period] of yearPeriods(plan).entries()) {
      const statement = report.years[index];
      expect(statement.operatingProfit).toBeCloseTo(
        currentProfitOrLoss(period.totals, period.accounting),
        PLACES,
      );
      expect(statement.inventoryAdjusted.operatingProfit).toBeCloseTo(
        inventoryAdjustedProfit(period.totals, period.accounting),
        PLACES,
      );
    }
    // And over the horizon, against the summary every other page reads.
    expect(report.wholePlan!.inventoryAdjusted.operatingProfit).toBeCloseTo(
      plan.projection.summary.inventoryAdjustedProfit,
      PLACES,
    );
  });

  it("foots: revenue less operating costs is the operating profit", () => {
    for (const statement of [...report.months, ...report.years, report.wholePlan!]) {
      expect(statement.revenue.total - statement.operatingCosts.total).toBeCloseTo(
        statement.operatingProfit,
        PLACES,
      );
      const lines = statement.revenue;
      expect(lines.pigSales + lines.giltSales + lines.cullSales + lines.otherIncome).toBeCloseTo(
        lines.total,
        PLACES,
      );
    }
  });

  it("adds up: a plan year is the sum of its months, and the plan of its years", () => {
    const whole = report.wholePlan!;
    const summed = report.months.reduce((total, month) => total + month.operatingProfit, 0);
    expect(summed).toBeCloseTo(whole.operatingProfit, PLACES);
    expect(report.years.reduce((total, year) => total + year.revenue.total, 0)).toBeCloseTo(
      whole.revenue.total,
      PLACES,
    );
    expect(
      report.years.reduce((total, year) => total + year.operatingCosts.feed, 0),
    ).toBeCloseTo(whole.operatingCosts.feed, PLACES);
    // A closing balance is not a flow: the plan's is the last month's, not a sum.
    expect(whole.closingCash).toBeCloseTo(
      plan.projection.summary.closingCash,
      PLACES,
    );
  });

  it("keeps funding out of trading income and out of operating costs", () => {
    // A plan funded by generated injections earns nothing extra by being funded.
    const funded = planOf((config) => {
      config.finance.cashMovements = [
        { id: "auto-in-3", monthIndex: 3, kind: "in", amount: 25_000, note: "Cash injection", auto: true },
        { id: "auto-out-20", monthIndex: 20, kind: "out", amount: 5_000, note: "Cash withdrawal", auto: true },
      ];
    });
    const statement = profitAndLossReport(funded).wholePlan!;
    expect(statement.financing.in).toBeCloseTo(25_000, PLACES);
    expect(statement.financing.out).toBeCloseTo(5_000, PLACES);
    // Other income carries the plan's own other income and none of the injection.
    expect(statement.revenue.otherIncome).toBeCloseTo(
      funded.projection.months.reduce((total, month) => total + month.totals["other-income"], 0) -
        25_000,
      PLACES,
    );
    expect(statement.revenue.total - statement.operatingCosts.total).toBeCloseTo(
      statement.operatingProfit,
      PLACES,
    );
    // The cash did move, though: it is on the cash line and not on the profit.
    expect(statement.closingCash).toBeCloseTo(funded.projection.summary.closingCash, PLACES);
  });
});

describe("the books close onto the balance sheet", () => {
  /**
   * The invariant a reader is entitled to check:
   *
   *     closing net worth = opening net worth
   *                       + inventory-adjusted profit
   *                       + owner equity movements
   *                       + goods held but not yet charged
   *
   * The last term is the one that is easy to leave out and is not optional. A
   * lorryload of feed is bought on one day, eaten over the following weeks and
   * paid for on its own terms; between those dates the farm's worth has moved
   * by something the trading statement has not charged for. On the accrual
   * engine that term is zero because payables carry it. On the 1.x engine,
   * which posts a cost on the day it is paid, it is the movement in the stores
   * — and it was exactly this that left the profit statement and the balance
   * sheet a few dollars apart in the months where the bins were not empty.
   */
  for (const engine of ["1.x", "2.0"] as const) {
    it(`holds exactly, month by month, on the ${engine} engine`, () => {
      const run = byEngine[engine];
      const report = profitAndLossReport(run);
      for (const statement of report.months) {
        const { openingNetWorth, profit, financingNet, goodsHeldTiming, closingNetWorth } =
          statement.reconciliation;
        expect(openingNetWorth + profit + financingNet + goodsHeldTiming).toBeCloseTo(
          closingNetWorth,
          PLACES,
        );
      }
    });

    it(`holds over the whole plan on the ${engine} engine, against the farm worth`, () => {
      const run = byEngine[engine];
      const whole = profitAndLossReport(run).wholePlan!;
      const { openingNetWorth, profit, financingNet, goodsHeldTiming } = whole.reconciliation;
      expect(openingNetWorth + profit + financingNet + goodsHeldTiming).toBeCloseTo(
        run.projection.farmWorth.netWorth,
        PLACES,
      );
      // Opening is the plan's own opening worth, and the profit is the one the
      // summary reports — so neither end of the identity is invented here.
      expect(openingNetWorth).toBeCloseTo(openingWorthOf(run), PLACES);
      expect(profit).toBeCloseTo(run.projection.summary.inventoryAdjustedProfit, PLACES);
    });
  }

  it("has nothing to reconcile on an engine that buys on supplier terms", () => {
    // On 2.0 the timing term is not merely small, it is zero: what is held in
    // the stores is matched by what is owed for it.
    const run = planOf((config) => {
      config.project.engine = "2.0";
      config.project.months = 24;
    });
    for (const statement of profitAndLossReport(run).months) {
      expect(statement.reconciliation.goodsHeldTiming).toBeCloseTo(0, PLACES);
    }
  });

  it("names the store movement as the reconciling item on the 1.x engine", () => {
    // And on 1.x it is exactly the movement in goods standing in the stores,
    // which is what makes it a timing difference rather than a lost dollar.
    const run = planOf((config) => {
      config.project.engine = "1.x";
      config.project.months = 24;
    });
    for (const period of monthPeriods(run)) {
      const statement = tradingStatement(period);
      expect(statement.reconciliation.goodsHeldTiming).toBeCloseTo(
        period.closingStoreValue - period.openingStoreValue,
        PLACES,
      );
    }
  });
});

describe("the projected balance sheet", () => {
  const report = balanceSheetReport(plan);

  it("closes on the farm worth the application closes on", () => {
    expect(report.closing.worth.netWorth).toBeCloseTo(
      plan.projection.farmWorth.netWorth,
      PLACES,
    );
    expect(report.closing.worth.totalAssets).toBeCloseTo(
      plan.projection.farmWorth.totalAssets,
      PLACES,
    );
    expect(report.closing.worth.netWorth).toBeCloseTo(
      plan.projection.summary.farmWorthAtEnd,
      PLACES,
    );
  });

  it("opens where the plan says it opens", () => {
    // What the summary reports as built over the plan is the difference between
    // the two ends of this sheet, so the opening column cannot drift from it.
    expect(report.closing.worth.netWorth - report.opening.worth.netWorth).toBeCloseTo(
      plan.projection.summary.changeInFarmWorth,
      PLACES,
    );
  });

  it("balances, month by month", () => {
    for (const point of [report.opening, ...report.months, ...report.years]) {
      const { worth } = point;
      const assets =
        worth.cash +
        worth.inventory.feed +
        worth.inventory.supplies +
        worth.inventory.marketLivestock +
        worth.inventory.replacementGilts +
        worth.breedingAssets.sows +
        worth.breedingAssets.boars;
      expect(assets).toBeCloseTo(worth.totalAssets, PLACES);
      expect(worth.totalAssets - worth.totalLiabilities).toBeCloseTo(worth.netWorth, PLACES);
      // Never revalued: the herd is on here at what was spent on it.
      expect(worth.cash).toBeGreaterThanOrEqual(0);
    }
  });

  it("ends each plan year on the month that year ends on", () => {
    for (const [index, year] of plan.projection.years.entries()) {
      const lastMonth = year.months[year.months.length - 1];
      expect(report.years[index].worth.netWorth).toBeCloseTo(
        report.months[lastMonth].worth.netWorth,
        PLACES,
      );
      // And the monthly net worth is the figure the money page shows for it.
      expect(report.months[lastMonth].worth.netWorth).toBeCloseTo(
        plan.projection.months[lastMonth].netWorth,
        PLACES,
      );
    }
  });
});

describe("the proposed funding plan", () => {
  const report = fundingPlanReport(plan);

  it("agrees with the cash deficit the application projects", () => {
    // With no working capital floor set, the shortfall is the peak funding need
    // the summary reports, which is where every other page reads it from.
    expect(plan.config.finance.workingCapitalTarget).toBe(0);
    expect(report.plan.projectedShortfall).toBeCloseTo(
      plan.projection.summary.peakFundingNeed,
      PLACES,
    );
  });

  it("proposes enough, on a plan that needs it", () => {
    const { plan: schedule, months } = fundingPlanReport(hungry);
    expect(schedule.tranches.length).toBeGreaterThan(0);
    expect(schedule.peakRequirement).toBeGreaterThanOrEqual(schedule.projectedShortfall);

    // The schedule does what it claims: no month closes below the floor once it
    // is drawn, and the leanest funded month agrees with the working.
    for (const month of months) {
      expect(month.fundedBalance).toBeGreaterThanOrEqual(schedule.workingCapitalFloor - 0.01);
    }
    expect(Math.min(...months.map((month) => month.fundedBalance))).toBeCloseTo(
      schedule.lowestFundedBalance,
      PLACES,
    );
    expect(schedule.closingCash).toBeCloseTo(
      months[months.length - 1].fundedBalance,
      PLACES,
    );
  });

  it("asks once rather than every month, and in round figures", () => {
    const schedule = planFunding(hungry.config, hungry.projection);
    // A plan that is short for a long run is funded in a handful of drawdowns,
    // not in one per month. This is the whole difference between this schedule
    // and the month-by-month top-up the money page writes.
    expect(schedule.tranches.length).toBeLessThanOrEqual(
      Math.ceil(hungry.config.project.months / 12) + 1,
    );
    for (const tranche of schedule.tranches) {
      expect(tranche.amount % 100).toBe(0);
      expect(tranche.amount).toBeGreaterThan(0);
    }
    // The cumulative column is the running total of the column beside it.
    let running = 0;
    for (const tranche of schedule.tranches) {
      running += tranche.amount;
      expect(tranche.cumulative).toBeCloseTo(running, PLACES);
    }
    expect(schedule.peakRequirement).toBeCloseTo(running, PLACES);
  });

  it("asks for nothing when the plan funds itself", () => {
    const rich = planOf((config) => {
      config.project.openingCash = 10_000_000;
    });
    const schedule = planFunding(rich.config, rich.projection);
    expect(schedule.tranches).toHaveLength(0);
    expect(schedule.peakRequirement).toBe(0);
    expect(schedule.projectedShortfall).toBe(0);
    expect(schedule.shortfallMonth).toBeNull();
  });

  it("reports the plan's own cash, untouched by the schedule", () => {
    // The point of the report: it describes the run, it does not change it.
    for (const [index, month] of report.months.entries()) {
      expect(month.unfundedBalance).toBe(plan.projection.months[index].closingCash);
      expect(month.netCashFlow).toBe(plan.projection.months[index].netCashFlow);
    }
  });
});

describe("what the funding plan says it is not", () => {
  it("says plainly that a plan with no capital costs is funding working capital only", () => {
    const bare = planOf((config) => {
      config.finance.initialCapitalCosts = 0;
    });
    const { plan } = fundingPlanReport(bare);
    expect(plan.capitalExpenditure).toBeCloseTo(0, PLACES);
    expect(plan.fundsCapitalWorks).toBe(false);

    // And the application says so too, rather than leaving the funding figure to
    // be read as the cost of establishing a piggery.
    const warning = bare.projection.warnings.find(
      (entry) => entry.title === "No capital cost has been entered",
    );
    expect(warning).toBeDefined();
    expect(warning!.level).toBe("attention");
    expect(warning!.detail).toContain("working capital only");
  });

  it("counts the capital the plan does cost, and stops warning once it does", () => {
    const built = planOf((config) => {
      config.finance.initialCapitalCosts = 250_000;
    });
    const { plan } = fundingPlanReport(built);
    expect(plan.capitalExpenditure).toBeCloseTo(250_000, PLACES);
    expect(plan.fundsCapitalWorks).toBe(true);
    // Capital is spent on day one, so the facility has to carry it.
    expect(plan.peakRequirement).toBeGreaterThan(250_000);
    expect(
      built.projection.warnings.some(
        (entry) => entry.title === "No capital cost has been entered",
      ),
    ).toBe(false);
  });
});

describe("the herd development plan", () => {
  const report = herdDevelopmentReport(plan);

  it("counts the herd the monthly projection counts", () => {
    for (const [index, month] of plan.projection.months.entries()) {
      const period = report.months[index];
      expect(period.closing.sows).toBe(month.sows);
      expect(period.closing.boars).toBe(month.boars);
      expect(period.closing.piglets).toBe(month.piglets);
      expect(period.closing.weaners).toBe(month.weaners);
      expect(period.closing.growers).toBe(month.growers);
      expect(period.closing.finishers).toBe(month.finishers);
      expect(period.closing.replacementGilts).toBe(month.gilts);
      expect(period.closing.head).toBe(month.head);
      expect(period.flows.born).toBe(month.bornAlive);
      expect(period.flows.weaned).toBe(month.weaned);
      expect(period.flows.sold).toBe(month.pigsSold);
      expect(period.flows.deaths).toBe(month.deaths);
      expect(period.flows.giltsPromoted).toBe(month.giltsPromoted);
    }
  });

  it("splits the sow herd without losing a sow", () => {
    for (const period of [...report.months, ...report.years]) {
      expect(
        period.closing.gestatingSows + period.closing.lactatingSows + period.closing.openSows,
      ).toBe(period.closing.sows);
      expect(period.closing.breedingStock).toBe(period.closing.sows + period.closing.boars);
    }
  });

  it("sums the flows of a plan year and closes on its last month", () => {
    for (const [index, year] of plan.projection.years.entries()) {
      const period = report.years[index];
      const months = year.months.map((month) => plan.projection.months[month]);
      const last = months[months.length - 1];
      expect(period.closing.sows).toBe(last.sows);
      expect(period.closing.head).toBe(last.head);
      expect(period.flows.born).toBe(months.reduce((total, month) => total + month.bornAlive, 0));
      expect(period.flows.sold).toBe(months.reduce((total, month) => total + month.pigsSold, 0));
      expect(period.flows.breedingStockCulled).toBe(
        months.reduce((total, month) => total + month.sowsCulled + month.boarsRotated, 0),
      );
      // And against the projection's own year summary, which the money page reads.
      expect(period.flows.born).toBe(year.bornAlive);
      expect(period.flows.sold).toBe(year.pigsSold);
      expect(period.closing.sows).toBe(year.sows);
    }
  });

  it("does not contradict the cashflow warnings about the sow herd", () => {
    // A herd that fills its places and is then drawn down by culling used to
    // read "the herd has not reached its sow places" in the workbook's notes
    // and "target sow herd reached, June 2029" on the milestone sheet, in the
    // same document. Both now come off one figure on the summary.
    const drawnDown = planOf((config) => {
      config.project.months = 48;
      config.herd.cullAfterParity = 3;
    });
    const summary = drawnDown.projection.summary;
    const milestone = herdDevelopmentReport(drawnDown).milestones.find(
      (entry) => entry.label === "Target sow herd reached",
    )!;
    const warning = drawnDown.projection.warnings.find((entry) =>
      entry.title.includes("sow places"),
    );

    expect(milestone.month).toBe(summary.sowCapacityReachedMonth);
    if (summary.sowCapacityReachedMonth !== null) {
      // Having reached capacity, nothing in the plan may claim it never did.
      expect(milestone.detail).toContain(summary.sowCapacityReachedMonth);
      if (warning) {
        expect(warning.title).toBe("The herd ends below the sow places it reached");
        expect(warning.detail).toContain(summary.sowCapacityReachedMonth);
      }
    } else if (warning) {
      expect(warning.title).toBe("The herd has not reached its sow places");
    }
    // The peak is the peak of the months, wherever it is read from.
    expect(summary.peakSows).toBe(
      Math.max(...drawnDown.projection.months.map((month) => month.sows)),
    );
  });

  it("points at the milestones off the same months", () => {
    const peak = report.milestones.find((milestone) => milestone.label === "Peak total head count")!;
    expect(peak.value).toBe(plan.projection.summary.peakHeadCount);
    const finishers = report.milestones.find((milestone) => milestone.label === "Peak finishers")!;
    expect(finishers.value).toBe(
      Math.max(...plan.projection.months.map((month) => month.finishers)),
    );
  });
});

describe("the housing needs plan", () => {
  const report = housingNeedsReport(plan);

  it("lays out the housing the run already worked out, and works nothing out again", () => {
    expect(report.housing).toBe(plan.housing);
    expect(report.types).toBe(plan.housing?.types);
    expect(report.buildings).toBe(plan.housing?.buildings);
    expect(report.types.length).toBeGreaterThan(0);
  });

  it("prints the pens the plan says have to exist", async () => {
    const bytes = await reportById("housing-needs").build(plan, GENERATED_AT);
    const workbook = new Workbook();
    await workbook.xlsx.load(Buffer.from(bytes) as never);
    const sheet = workbook.getWorksheet("Housing Needs")!;

    const rowOf = (label: string) => {
      for (let row = 1; row <= sheet.rowCount; row += 1) {
        if (String(sheet.getCell(`A${row}`).value ?? "").trim() === label) return row;
      }
      throw new Error(`no row labelled ${label}`);
    };
    const minimum = rowOf("MINIMUM REQUIRED BY SIMULATION");
    const recommended = rowOf("RECOMMENDED DESIGN CAPACITY");

    report.types.forEach((type, index) => {
      const column = index + 2;
      expect(String(sheet.getCell(6, column).value)).toBe(type.label);
      // A total is written as a formula with the application's figure cached,
      // so the sheet adds up and still states what the planner decided.
      const cell = sheet.getCell(minimum, column).value as { result?: number } | number;
      const stated = typeof cell === "number" ? cell : (cell?.result ?? Number.NaN);
      expect(stated).toBe(type.minimumPens);
      expect(sheet.getCell(recommended, column).value).toBe(type.moduleCapacityPens);
    });
  }, 60_000);

  it("schedules every building, with a footprint that holds its rooms", async () => {
    const bytes = await reportById("housing-needs").build(plan, GENERATED_AT);
    const workbook = new Workbook();
    await workbook.xlsx.load(Buffer.from(bytes) as never);
    const sheet = workbook.getWorksheet("Building Schedule")!;

    const labels: string[] = [];
    for (let row = 7; row <= sheet.rowCount; row += 1) {
      const label = String(sheet.getCell(`A${row}`).value ?? "").trim();
      if (label === "" || label === "Total") continue;
      if (label.startsWith("Pen floor across")) break;
      labels.push(label);
    }
    expect(labels).toEqual(report.buildings.map((building) => building.label));
  }, 60_000);

  it("prints the order the work falls due in, and what was turned down", async () => {
    const bytes = await reportById("housing-needs").build(plan, GENERATED_AT);
    const workbook = new Workbook();
    await workbook.xlsx.load(Buffer.from(bytes) as never);

    // A construction programme, with a date against every piece of work.
    const phases = workbook.getWorksheet("Construction Phases")!;
    const dates: string[] = [];
    for (let row = 7; row < 7 + report.phases.length; row += 1) {
      expect(String(phases.getCell(`A${row}`).value ?? "")).not.toBe("");
      dates.push(String(phases.getCell(`C${row}`).value ?? ""));
    }
    expect(dates).toEqual(
      report.phases.map((phase) => phase.buildByDate ?? `Day ${phase.buildByDay}`),
    );

    // And the arrangements that were costed, the chosen one first.
    const options = workbook.getWorksheet("Layout Options")!;
    expect(String(options.getCell("A7").value)).toBe("Recommended");
    for (let index = 0; index < report.layoutOptions.length; index += 1) {
      const row = 7 + index;
      expect(String(options.getCell(`A${row}`).value)).toBe(report.layoutOptions[index].label);
      expect(options.getCell(`I${row}`).value).toBe(
        report.layoutOptions[index].estimatedCostScore,
      );
    }
  }, 60_000);
});

describe("AI that nobody asked for", () => {
  /**
   * A plan can put none of its services to semen by policy and still buy doses,
   * because semen is also what the farm reaches for when it has no boar to give
   * a female. Reported as one total that read as a contradiction: "AI share of
   * services 0%" beside seventy-five AI services and a bill for them.
   */
  it("records a dose bought for want of a boar, on a plan that put 0% to semen", () => {
    const config = cloneDefaultConfig();
    config.project.months = 36;
    config.service.useAi = true;
    config.service.aiSharePct = 0;
    const run = simulatePlan(config, { snapshots: false });
    const lifetime = run.snapshotAt(run.timeline.days.at(-1)!.date + "T23:00").lifetime;

    // Nothing was put to semen by policy, so every dose bought was a boar the
    // farm could not give her — worked out for the week, or already her sire.
    expect(lifetime.aiServices).toBeGreaterThan(0);
    expect(lifetime.aiFallbackServices).toBe(lifetime.aiServices);
  });

  it("separates the two when the plan puts a share to semen as well", () => {
    const config = cloneDefaultConfig();
    config.project.months = 36;
    config.service.useAi = true;
    config.service.aiSharePct = 50;
    const run = simulatePlan(config, { snapshots: false });
    const lifetime = run.snapshotAt(run.timeline.days.at(-1)!.date + "T23:00").lifetime;
    expect(lifetime.aiServices).toBeGreaterThan(lifetime.aiFallbackServices);
  });

  it("explains the doses rather than leaving them to contradict the share", () => {
    // Worded off the counts rather than run through a herd: what is under test
    // is the sentence, and a sentence does not need three years of pigs.
    const config = cloneDefaultConfig();
    config.service.useAi = true;
    config.service.aiSharePct = 0;
    const summary = plan.projection.summary;
    const asFallback = buildWarnings(config, summary, {
      servicesMissedForBoarCapacity: 0,
      servicesMissedForGenetics: 0,
      servicesAttempted: 463,
      aiServices: 75,
      aiFallbackServices: 75,
      aiCost: 3_750,
    });
    const note = asFallback.find((entry) =>
      entry.detail.includes("services were by bought-in semen"),
    )!;
    expect(note.title).toBe("Semen is standing in for a boar");
    expect(note.detail).toContain("75 of them were not a choice of policy");
    expect(note.detail).toContain("no unrelated boar free");
    expect(note.detail).toContain("The AI share is set to 0%");

    const asPolicy = buildWarnings(
      { ...config, service: { ...config.service, aiSharePct: 100 } },
      summary,
      {
        servicesMissedForBoarCapacity: 0,
        servicesMissedForGenetics: 0,
        servicesAttempted: 463,
        aiServices: 75,
        aiFallbackServices: 0,
        aiCost: 3_750,
      },
    );
    expect(
      asPolicy.find((entry) => entry.detail.includes("services were by bought-in semen"))!.title,
    ).toBe("Part of the herd is served by AI");
  });
});

describe("the generated workbooks", () => {
  it("writes every report, and prints the figures the report holds", async () => {
    for (const report of REPORTS) {
      const bytes = await report.build(plan, GENERATED_AT);
      const workbook = new Workbook();
      await workbook.xlsx.load(Buffer.from(bytes) as never);
      expect(workbook.worksheets.length).toBeGreaterThan(0);
      for (const sheet of workbook.worksheets) {
        expect(String(sheet.getCell("A2").value)).toContain(plan.config.project.name);
      }
    }
  }, 60_000);

  it("prints the profit its own statement states", async () => {
    const bytes = await reportById("profit-and-loss").build(plan, GENERATED_AT);
    const workbook = new Workbook();
    await workbook.xlsx.load(Buffer.from(bytes) as never);
    const sheet = workbook.getWorksheet("P&L Annual")!;

    // Rows are found by label rather than counted: the statement's shape is
    // allowed to change, its figures are not.
    const rowOf = (label: string) => {
      for (let row = 1; row <= sheet.rowCount; row += 1) {
        if (String(sheet.getCell(`A${row}`).value ?? "").trim() === label) return row;
      }
      throw new Error(`no row labelled ${label}`);
    };
    const statement = profitAndLossReport(plan).years[0];
    expect(Number(sheet.getCell(rowOf("Pig sales"), 2).value)).toBeCloseTo(
      statement.revenue.pigSales,
      PLACES,
    );
    expect(Number(sheet.getCell(rowOf("OPERATING PROFIT / (LOSS)"), 2).value)).toBeCloseTo(
      statement.operatingProfit,
      PLACES,
    );
    // Total rows carry a real formula over the lines above them, with the
    // application's own figure as the cached result.
    const total = sheet.getCell(rowOf("Total trading income"), 2);
    expect(total.formula).toMatch(/^SUM\(B\d+:B\d+\)$/);
    expect(Number(total.result)).toBeCloseTo(statement.revenue.total, PLACES);
  }, 60_000);

  it("prints the net worth the plan closes on", async () => {
    const bytes = await reportById("balance-sheet").build(plan, GENERATED_AT);
    const workbook = new Workbook();
    await workbook.xlsx.load(Buffer.from(bytes) as never);
    const sheet = workbook.getWorksheet("Balance Sheet")!;
    let netWorthRow = 0;
    for (let row = 1; row <= sheet.rowCount; row += 1) {
      if (String(sheet.getCell(`A${row}`).value ?? "").trim() === "FARM NET WORTH") netWorthRow = row;
    }
    expect(netWorthRow).toBeGreaterThan(0);
    // The last column is the close of the last plan year, which is the horizon.
    const lastColumn = plan.projection.years.length + 2;
    expect(Number(sheet.getCell(netWorthRow, lastColumn).value)).toBeCloseTo(
      plan.projection.farmWorth.netWorth,
      PLACES,
    );
  }, 60_000);
});

describe("a period with one column and the whole plan", () => {
  it("covers every month exactly once between the plan years", () => {
    const covered = yearPeriods(plan).flatMap((period) =>
      period.months.map((month) => month.index),
    );
    expect(covered).toEqual(plan.projection.months.map((month) => month.index));
    expect(wholePlanPeriod(plan)!.months).toHaveLength(plan.projection.months.length);
  });
});
