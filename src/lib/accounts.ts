import {
  ZERO_BALANCES,
  emptyAccountingDay,
  inventoryTotal,
  type AccountingBalances,
  type AccountingDay,
} from "./sim/accounting";
import { expensesOf, incomeOf, type CategoryTotals } from "./sim/ledger";

/**
 * The experimental second profit statement, and the balance sheet behind it.
 *
 * The farm's existing profit and loss is income for the period less costs for
 * the period, and it is not going anywhere: it is the figure the plan has
 * always shown and every other page still reads it. What it cannot do is tell a
 * farm that is losing money from a farm that is building a herd. Both spend
 * more than they take, and on that statement both read as a loss.
 *
 * This is the other reading. A cost that turned into an animal standing in a
 * pen is not gone — it is stock, and it becomes a cost on the day the animal is
 * sold, dies, or is written off. Run the same year through both statements and
 * the gap between them is exactly what the farm put into itself.
 *
 * Nothing here recalculates the farm. It is arithmetic over the ledger totals
 * the run already produced and the movements the second set of books recorded
 * alongside them, which is what makes the two statements two readings of one
 * run rather than two runs.
 *
 * @see docs/pigflow-inventory-adjusted-profit-spec.md
 */

/** The day's movements without the closing balances: what a period sums. */
export type AccountingFlows = Omit<AccountingDay, keyof AccountingBalances>;

/** A stretch of days, as the second set of books saw it. */
export type PeriodAccounting = {
  flows: AccountingFlows;
  /** What was standing at the start of the period, before any of it ran. */
  opening: AccountingBalances;
  /** And at the end of it. */
  closing: AccountingBalances;
};

export function emptyFlows(): AccountingFlows {
  const day = emptyAccountingDay();
  for (const key of Object.keys(ZERO_BALANCES) as (keyof AccountingBalances)[]) {
    delete (day as Partial<AccountingDay>)[key];
  }
  return day as AccountingFlows;
}

export function emptyPeriodAccounting(): PeriodAccounting {
  return { flows: emptyFlows(), opening: { ...ZERO_BALANCES }, closing: { ...ZERO_BALANCES } };
}

export function addFlows(target: AccountingFlows, day: AccountingDay): void {
  for (const key of Object.keys(target) as (keyof AccountingFlows)[]) {
    target[key] += day[key];
  }
}

export function balancesOf(day: AccountingDay): AccountingBalances {
  return {
    marketWip: day.marketWip,
    replacementWip: day.replacementWip,
    sowAssets: day.sowAssets,
    boarAssets: day.boarAssets,
    freightInStore: day.freightInStore,
  };
}

/** Rolls a run of shorter periods up into one longer one. */
export function mergeAccounting(
  parts: readonly PeriodAccounting[],
): PeriodAccounting {
  const merged = emptyPeriodAccounting();
  if (parts.length === 0) return merged;
  for (const part of parts) {
    for (const key of Object.keys(merged.flows) as (keyof AccountingFlows)[]) {
      merged.flows[key] += part.flows[key];
    }
  }
  merged.opening = { ...parts[0].opening };
  merged.closing = { ...parts[parts.length - 1].closing };
  return merged;
}

// ------------------------------------------------------------- the statement

/** The inventory-adjusted profit statement for one period. */
export type InventoryAdjustedPnL = {
  revenue: {
    pigSales: number;
    giltSales: number;
    cullSales: number;
    other: number;
    total: number;
  };
  costOfSales: {
    /** What the market pigs drawn this period had cost to rear. */
    marketPigCost: number;
    /** And the surplus gilts sold as breeding stock. */
    giltCost: number;
    /** Carrying value of the sows culled and boars rotated out. */
    breedingStockCost: number;
    total: number;
  };
  grossProfit: number;
  operatingExpenses: {
    /** Feeding, serving and doctoring the sows and boars. */
    breedingHerd: number;
    labour: number;
    overheads: number;
    depreciation: number;
    mortalityLosses: number;
    /** Bedding, haulage to the abattoir, and the rest of the running costs. */
    other: number;
    total: number;
  };
  operatingProfit: number;
};

/**
 * What the farm put into itself over the period, at cost.
 *
 * Everything the farm spends lands in the ledger, and some of it buys something
 * the farm still has at the end of the period: a pig in the finishing house, a
 * gilt in the pipeline, a bought-in boar, a journey whose load is still in the
 * bin it was tipped into. That part is not an expense yet, and this is how much
 * of it there is.
 *
 * It is read as the movement in what is standing rather than by classifying
 * each ledger line, which is deliberate: the books record what was capitalised
 * as it happens, so this cannot drift out of step with them the way a
 * hand-maintained list of capitalisable categories would.
 */
export function inventoryChange(period: PeriodAccounting): number {
  return inventoryTotal(period.closing) - inventoryTotal(period.opening);
}

/**
 * The cash the funding buttons moved this period, which is not trading.
 *
 * A generated injection is posted to other income and a generated withdrawal to
 * fixed overheads, because the cash book has to balance. Neither is the farm
 * earning or spending anything, so every profit figure takes both back out
 * again — and takes them out of the same two figures, which is the point of
 * their being recorded here rather than worked out again by each reader.
 */
export function financingOf(period: PeriodAccounting): { in: number; out: number } {
  return { in: period.flows.financingIn, out: period.flows.financingOut };
}

/**
 * The period read as a trading statement rather than as a cash account.
 *
 * `other` on the expense side is a residual on purpose. The named lines are the
 * ones a farmer would ask for by name, and the total is right by construction;
 * anything left over — bedding, the run to the abattoir, the share of a lorry
 * that carried goods nobody capitalised — falls into the last line rather than
 * being forced into one it does not belong in.
 */
export function inventoryAdjustedPnL(
  totals: CategoryTotals,
  period: PeriodAccounting,
): InventoryAdjustedPnL {
  const { flows } = period;
  const financing = financingOf(period);

  const revenue = {
    pigSales: totals["pig-sales"],
    giltSales: totals["gilt-sales"],
    cullSales: totals["cull-sales"],
    // A generated injection was posted here to keep the cash book square. It is
    // the owner putting money in, which is income on nobody's statement.
    other: totals["other-income"] - financing.in,
    total: incomeOf(totals) - financing.in,
  };

  const costOfSales = {
    marketPigCost: flows.costOfMarketPigsSold,
    giltCost: flows.costOfGiltsSold,
    breedingStockCost: flows.costOfBreedingStockSold,
    total:
      flows.costOfMarketPigsSold + flows.costOfGiltsSold + flows.costOfBreedingStockSold,
  };

  const grossProfit = revenue.total - costOfSales.total;
  // The one calculation, rather than a second one that ought to agree with it.
  // The expense side is then footed backwards from it: the named lines are the
  // ones a farmer would ask for, and whatever is left over falls into the last
  // line rather than being forced into one it does not belong in.
  const operatingProfit = inventoryAdjustedProfit(totals, period);

  const breedingHerd = flows.breedingHerdCosts;
  const labour = totals.labour;
  // And a generated withdrawal was posted here, for the same reason. Taking a
  // surplus out of the business is not an overhead of keeping pigs.
  const overheads =
    totals.overheads - financing.out + totals.contingency + totals.capital;
  const mortalityLosses = flows.mortalityLossLivestock + flows.mortalityLossBreeding;
  const total = grossProfit - operatingProfit;
  const operatingExpenses = {
    breedingHerd,
    labour,
    overheads,
    depreciation: flows.depreciation,
    mortalityLosses,
    other:
      total - breedingHerd - labour - overheads - flows.depreciation - mortalityLosses,
    total,
  };

  return { revenue, costOfSales, grossProfit, operatingExpenses, operatingProfit };
}

/**
 * Income less expenditure for the period: the statement the plan has always
 * shown, with the financing taken back out of both sides of it.
 *
 * Every reading of a period goes through here, so that profit means the same
 * thing on the cashflow page, in the workbook and in a comparison of two plans.
 */
export function currentProfitOrLoss(
  totals: CategoryTotals,
  period: PeriodAccounting,
): number {
  const financing = financingOf(period);
  return incomeOf(totals) - financing.in - (expensesOf(totals) - financing.out);
}

/**
 * The same period with the costs that turned into unsold animals held back
 * until those animals leave.
 *
 * This is the inventory-adjusted profit and it is the only place it is worked
 * out. The trading statement in {@link inventoryAdjustedPnL} foots to it, the
 * reconciliation in {@link reconcileProfit} arrives at it, and the plan summary,
 * the workbook and the plan comparison all read it from here. Four expressions
 * of the same arithmetic in four files is how two pages come to disagree about
 * what a farm made.
 */
export function inventoryAdjustedProfit(
  totals: CategoryTotals,
  period: PeriodAccounting,
): number {
  return currentProfitOrLoss(totals, period) + inventoryChange(period);
}

/**
 * Why the two profit figures differ, line by line.
 *
 * Every line is a movement that one statement sees and the other does not, and
 * they add up exactly: an asset is never created here by moving a cost from one
 * account into another, so a farm that neither grew nor shrank reads the same
 * profit on both.
 */
export type PnLReconciliation = {
  currentProfit: number;
  /** Rearing costs that became an animal rather than an expense. */
  capitalisedIntoLivestock: number;
  /** Breeding stock bought in, which is plant rather than a cost of the month. */
  breedingStockBought: number;
  /** Journeys paid for whose goods are still standing in a store. */
  freightHeldInStores: number;
  /** Released again when the animals left, with the sign the statement uses. */
  costOfLivestockSold: number;
  mortalityWriteOffs: number;
  breedingStockDepreciation: number;
  carryingValueOfBreedingStockSold: number;
  inventoryAdjustedProfit: number;
  /** What the change comes to as a movement in what the farm is holding. */
  changeInFarmInventory: number;
};

export function reconcileProfit(
  totals: CategoryTotals,
  period: PeriodAccounting,
): PnLReconciliation {
  const { flows } = period;
  return {
    currentProfit: currentProfitOrLoss(totals, period),
    capitalisedIntoLivestock: flows.capitalisedMarket + flows.capitalisedReplacement,
    breedingStockBought: flows.breedingPurchases,
    freightHeldInStores: period.closing.freightInStore - period.opening.freightInStore,
    costOfLivestockSold: flows.costOfMarketPigsSold + flows.costOfGiltsSold,
    mortalityWriteOffs: flows.mortalityLossLivestock + flows.mortalityLossBreeding,
    breedingStockDepreciation: flows.depreciation,
    carryingValueOfBreedingStockSold: flows.costOfBreedingStockSold,
    inventoryAdjustedProfit: inventoryAdjustedProfit(totals, period),
    changeInFarmInventory: inventoryChange(period),
  };
}
