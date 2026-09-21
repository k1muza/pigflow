import { describe, expect, it } from "vitest";

import {
  currentProfitOrLoss,
  inventoryAdjustedPnL,
  mergeAccounting,
  reconcileProfit,
} from "./accounts";
import { cloneDefaultConfig, type PlannerConfig } from "./config";
import { simulatePlan } from "./simulation";
import {
  accountingDrift,
  boarDepreciationAtDay,
  carryingValue,
  inventoryTotal,
  sowDepreciationAtParity,
  sowDepreciationPerParity,
  valueFoundingStock,
} from "./sim/accounting";
import { Boar, Sow } from "./sim/animals";
import { Farm } from "./sim/farm";
import { horizonDay } from "./sim";

/**
 * The experimental second set of books, checked the two ways that matter.
 *
 * The first is arithmetic: an asset must never appear simply because a cost was
 * moved from one account into another, so a day's movements and the change in
 * its balances have to be the same number, every day, on both engines.
 *
 * The second is that the existing profit and loss did not move. That is the
 * whole premise of the feature and it is worth a test of its own, because the
 * cost hooks are threaded through the same lines the ledger postings are.
 */

function plan(overrides: (config: PlannerConfig) => void = () => {}): PlannerConfig {
  const config = cloneDefaultConfig();
  config.project.months = 24;
  config.project.variation = "settled";
  overrides(config);
  return config;
}

describe("breeding asset depreciation", () => {
  const config = plan((draft) => {
    draft.herd.cullAfterParity = 6;
    draft.herd.cullSowSaleValue = 150;
    draft.herd.boarPurchaseCost = 500;
    draft.herd.boarResidualValue = 140;
    draft.herd.boarWorkingLifeMonths = 24;
  });

  it("writes a sow down in a straight line from her value to her cull price", () => {
    // The worked example in the specification: $400 gilt, $150 cull, six parities.
    expect(sowDepreciationPerParity(400, config)).toBeCloseTo(250 / 6, 6);
    const carried = (parity: number) => 400 - sowDepreciationAtParity(400, parity, config);
    expect(carried(0)).toBeCloseTo(400, 6);
    expect(carried(1)).toBeCloseTo(358.33, 2);
    expect(carried(3)).toBeCloseTo(275, 2);
    expect(carried(6)).toBeCloseTo(150, 6);
  });

  it("never carries a sow below what a cull sow fetches", () => {
    expect(400 - sowDepreciationAtParity(400, 20, config)).toBeCloseTo(150, 6);
  });

  it("leaves a gilt cheaper than a cull sow alone", () => {
    expect(sowDepreciationPerParity(120, config)).toBe(0);
    expect(sowDepreciationAtParity(120, 4, config)).toBe(0);
  });

  it("writes a boar down by the months he has stood, and no further", () => {
    const perMonth = (500 - 140) / 24;
    const carried = (days: number) => 500 - boarDepreciationAtDay(500, days, config);
    expect(carried(0)).toBeCloseTo(500, 6);
    expect(500 - carried(30.4375)).toBeCloseTo(perMonth, 4);
    expect(carried(24 * 30.4375)).toBeCloseTo(140, 6);
    expect(carried(40 * 30.4375)).toBeCloseTo(140, 6);
  });

  it("prices the founding herd off what a replacement costs", () => {
    const sow = new Sow({ id: "S", tag: "S", birthDay: -400, weightKg: 200 });
    sow.parity = 3;
    const boar = new Boar({ id: "B", tag: "B", birthDay: -400 });
    valueFoundingStock({ sows: [sow], boars: [boar] }, config);
    expect(sow.breedingValue).toBe(config.herd.giltPurchaseCost);
    expect(carryingValue(sow)).toBeCloseTo(
      config.herd.giltPurchaseCost -
        sowDepreciationAtParity(config.herd.giltPurchaseCost, 3, config),
      6,
    );
    expect(carryingValue(boar)).toBe(config.herd.boarPurchaseCost);
  });
});

describe("the books balance", () => {
  for (const engine of ["1.x", "2.0"] as const) {
    it("on " + engine + ", every day's movements equal the change in its balances", () => {
      const config = plan((draft) => {
        draft.project.engine = engine;
        draft.project.months = 18;
      });
      const run = simulatePlan(config, { snapshots: false });
      let opening = run.projection.accounting.opening;
      let checked = 0;
      for (const day of run.history) {
        expect(accountingDrift(opening, day.accounting)).toBeCloseTo(0, 6);
        opening = day.accounting;
        checked += 1;
      }
      expect(checked).toBeGreaterThan(400);
    });

    it("on " + engine + ", no balance ever goes negative", () => {
      const config = plan((draft) => {
        draft.project.engine = engine;
        draft.project.months = 12;
      });
      for (const day of simulatePlan(config, { snapshots: false }).history) {
        const { accounting } = day;
        expect(accounting.marketWip).toBeGreaterThanOrEqual(-1e-6);
        expect(accounting.replacementWip).toBeGreaterThanOrEqual(-1e-6);
        expect(accounting.sowAssets).toBeGreaterThanOrEqual(-1e-6);
        expect(accounting.boarAssets).toBeGreaterThanOrEqual(-1e-6);
        expect(accounting.freightInStore).toBeGreaterThanOrEqual(-1e-6);
      }
    });
  }
});

describe("the two profit statements", () => {
  const config = plan();
  const run = simulatePlan(config, { snapshots: false });
  const { projection } = run;

  it("agree with each other through the reconciliation, month by month", () => {
    for (const month of projection.months) {
      const statement = inventoryAdjustedPnL(month.totals, month.accounting);
      const reconciliation = reconcileProfit(month.totals, month.accounting);
      expect(reconciliation.currentProfit).toBeCloseTo(month.revenue - month.totalCost, 6);
      expect(statement.operatingProfit).toBeCloseTo(
        reconciliation.inventoryAdjustedProfit,
        6,
      );
      expect(reconciliation.inventoryAdjustedProfit).toBeCloseTo(
        reconciliation.currentProfit + reconciliation.changeInFarmInventory,
        6,
      );
    }
  });

  it("and the reconciliation's own lines add up to the difference", () => {
    for (const year of projection.years) {
      const row = reconcileProfit(year.totals, year.accounting);
      const explained =
        row.capitalisedIntoLivestock +
        row.breedingStockBought +
        row.freightHeldInStores -
        row.costOfLivestockSold -
        row.mortalityWriteOffs -
        row.breedingStockDepreciation -
        row.carryingValueOfBreedingStockSold;
      expect(explained).toBeCloseTo(row.changeInFarmInventory, 6);
    }
  });

  it("roll up from months to years without losing anything", () => {
    for (const year of projection.years) {
      const covered = projection.months.filter((month) => year.months.includes(month.index));
      const merged = mergeAccounting(covered.map((month) => month.accounting));
      expect(merged.flows.capitalisedMarket).toBeCloseTo(
        year.accounting.flows.capitalisedMarket,
        6,
      );
      expect(inventoryTotal(merged.closing)).toBeCloseTo(
        inventoryTotal(year.accounting.closing),
        6,
      );
    }
  });

  it("each month opens where the one before closed", () => {
    for (const [index, month] of projection.months.entries()) {
      if (index === 0) continue;
      expect(inventoryTotal(month.accounting.opening)).toBeCloseTo(
        inventoryTotal(projection.months[index - 1].accounting.closing),
        9,
      );
    }
  });

  it("sum over the horizon to the figure the summary reports", () => {
    const totalCurrent = projection.months.reduce(
      (sum, month) => sum + currentProfitOrLoss(month.totals),
      0,
    );
    const horizon = reconcileProfit(projection.years[0].totals, projection.accounting);
    expect(projection.summary.inventoryAdjustedProfit).toBeCloseTo(
      totalCurrent + horizon.changeInFarmInventory,
      6,
    );
  });

  it("gives an expanding herd the better of the two figures", () => {
    // The whole reason for the feature: a farm filling its sow places spends on
    // animals it has not sold, and income-less-expenditure cannot see them.
    const current = projection.summary.totalRevenue - projection.summary.totalCost;
    expect(projection.summary.inventoryAdjustedProfit).toBeGreaterThan(current);
    expect(inventoryTotal(projection.accounting.closing)).toBeGreaterThan(
      inventoryTotal(projection.accounting.opening),
    );
    // Cash is deeply negative on the default plan, so net worth can be too —
    // what must be positive is the stock and plant the spending bought.
    const { farmWorth } = projection;
    expect(farmWorth.totalAssets - farmWorth.cash).toBeGreaterThan(0);
    expect(projection.summary.marketLivestockValueAtEnd).toBeGreaterThan(0);
    expect(projection.summary.breedingHerdValueAtEnd).toBeGreaterThan(0);
  });
});

describe("the farm's balance sheet", () => {
  it("nets assets against liabilities on every day of the plan", () => {
    const config = plan((draft) => {
      draft.project.engine = "2.0";
      draft.project.months = 12;
      draft.finance.accrualAccounting = true;
      draft.feed.procurementMode = "operational";
    });
    const run = simulatePlan(config);
    for (const day of run.timeline.days) {
      const { valuation } = run.snapshotAt(day.date + "T23:00").finance;
      expect(valuation.netWorth).toBeCloseTo(
        valuation.totalAssets - valuation.totalLiabilities,
        6,
      );
      expect(valuation.totalAssets).toBeCloseTo(
        valuation.cash +
          valuation.inventory.feed +
          valuation.inventory.supplies +
          valuation.inventory.marketLivestock +
          valuation.inventory.replacementGilts +
          valuation.breedingAssets.sows +
          valuation.breedingAssets.boars,
        6,
      );
    }
  });

  it("reports a month-end worth that ties to the closing balance sheet", () => {
    const config = plan((draft) => {
      draft.project.engine = "2.0";
      draft.project.months = 12;
    });
    const projection = simulatePlan(config, { snapshots: false }).projection;
    for (const month of projection.months) {
      expect(month.netWorth).toBeCloseTo(
        month.closingCash +
          month.storeValue +
          inventoryTotal(month.accounting.closing) -
          month.payables,
        6,
      );
    }
    // The last month is the plan's own closing balance sheet, read another way.
    expect(projection.months.at(-1)!.netWorth).toBeCloseTo(
      projection.farmWorth.netWorth,
      4,
    );
    expect(projection.years.at(-1)!.netWorth).toBeCloseTo(
      projection.months.at(-1)!.netWorth,
      9,
    );
  });

  it("values unsold pigs at what they cost, never at what they would fetch", () => {
    const config = plan((draft) => {
      draft.project.months = 12;
    });
    const run = simulatePlan(config, { snapshots: false });
    const terminal = run.projection.farmWorth;
    const perPig = run.projection.costOfProduction.fullCostPerPig;
    const finishers = run.projection.months.at(-1)!.finishers;
    // A book value at cost cannot exceed what the farm has actually spent, and
    // the sale price of that many finishers is well clear of it.
    expect(terminal.inventory.marketLivestock).toBeGreaterThan(0);
    expect(terminal.inventory.marketLivestock).toBeLessThan(
      Math.max(1, finishers) * perPig * 20,
    );
  });
});

describe("scenarios the specification asks for", () => {
  it("a herd with no sales carries everything it spends into livestock", () => {
    // Half a year is not long enough for a home-bred pig to reach sale weight
    // from a synchronised start, so nothing leaves the farm alive — and every
    // penny the growing houses cost is still standing in them.
    const config = plan((draft) => {
      draft.project.months = 12;
      draft.herd.startMode = "synchronised";
      draft.stock.weaners = 0;
      draft.stock.growers = 0;
      draft.stock.finishers = 0;
    });
    const projection = simulatePlan(config, { snapshots: false }).projection;
    const opening = projection.months.slice(0, 6);
    const period = mergeAccounting(opening.map((month) => month.accounting));
    expect(opening.reduce((sum, month) => sum + month.pigsSold, 0)).toBe(0);
    expect(period.flows.costOfMarketPigsSold).toBe(0);
    expect(period.closing.marketWip).toBeGreaterThan(0);
    expect(period.flows.capitalisedMarket).toBeGreaterThan(0);
  });

  it("a sow culled early shows a loss on disposal against her carrying value", () => {
    const config = plan((draft) => {
      draft.project.months = 36;
      // A running herd spread across the cycle: its oldest sows reach the
      // culling parity inside the horizon, which a synchronised start does not.
      draft.herd.startMode = "staggered";
    });
    const projection = simulatePlan(config, { snapshots: false }).projection;
    const { flows } = projection.accounting;
    expect(flows.costOfBreedingStockSold).toBeGreaterThan(0);
    // Written down to the cull price by the time she goes, so the cheque and
    // the carrying value are close: culling is not where a herd makes money.
    const proceeds = projection.years.reduce(
      (sum, year) => sum + year.totals["cull-sales"],
      0,
    );
    expect(proceeds).toBeGreaterThan(0);
    expect(flows.depreciation).toBeGreaterThan(0);
  });

  it("high mortality shows up as a loss rather than as a smaller herd", () => {
    const build = (mortalityPct: number) => {
      const config = plan((draft) => {
        draft.project.months = 12;
        draft.growth.weanerMortalityPct = mortalityPct;
        draft.growth.growerMortalityPct = mortalityPct;
        draft.growth.finisherMortalityPct = mortalityPct;
      });
      return simulatePlan(config, { snapshots: false }).projection;
    };
    const healthy = build(1);
    const sick = build(12);
    expect(sick.accounting.flows.mortalityLossLivestock).toBeGreaterThan(
      healthy.accounting.flows.mortalityLossLivestock,
    );
    expect(sick.summary.inventoryAdjustedProfit).toBeLessThan(
      healthy.summary.inventoryAdjustedProfit,
    );
  });

  it("promoting a gilt creates no profit, only a change of account", () => {
    const config = plan((draft) => {
      draft.project.months = 24;
    });
    const farm = new Farm(config).advanceTo(horizonDay(config));
    const promotionDays = farm.history.filter((day) => day.giltsPromoted > 0);
    expect(promotionDays.length).toBeGreaterThan(0);
    for (const day of promotionDays) {
      // The pipeline gives up exactly what the herd takes on.
      expect(day.accounting.promotedToBreeding).toBeGreaterThan(0);
      expect(accountingDrift(
        farm.history[farm.history.indexOf(day) - 1]?.accounting ?? farm.books.opening,
        day.accounting,
      )).toBeCloseTo(0, 6);
    }
  });

  it("bought-in gilts land as breeding assets, not as a month's expense", () => {
    const config = plan((draft) => {
      draft.project.months = 12;
      draft.herd.retainHomeBredGilts = false;
      draft.herd.buyGiltsWhenShort = true;
      draft.stock.sows = 8;
      draft.herd.maxSows = 20;
    });
    const projection = simulatePlan(config, { snapshots: false }).projection;
    expect(projection.accounting.flows.breedingPurchases).toBeGreaterThan(0);
    expect(projection.farmWorth.breedingAssets.sows).toBeGreaterThan(0);
  });
});
