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
 * What the period's ledger costs come to once the ones that turned into an
 * animal, a breeding asset or a bin of feed are taken back out again.
 *
 * Everything the farm spends lands in the ledger. Some of it buys something the
 * farm still has at the end of the period, and that part is not an expense yet.
 * Working it out by subtraction rather than by classifying each ledger line is
 * deliberate: the books record what was capitalised as it happens, so this
 * cannot drift out of step with them the way a hand-maintained list of
 * "capitalisable categories" would.
 */
function periodExpenses(totals: CategoryTotals, period: PeriodAccounting): number {
  const { flows } = period;
  const freightMovement = period.closing.freightInStore - period.opening.freightInStore;
  return (
    expensesOf(totals) -
    flows.capitalisedMarket -
    flows.capitalisedReplacement -
    flows.breedingPurchases -
    freightMovement
  );
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

  const revenue = {
    pigSales: totals["pig-sales"],
    giltSales: totals["gilt-sales"],
    cullSales: totals["cull-sales"],
    other: totals["other-income"],
    total: incomeOf(totals),
  };

  const costOfSales = {
    marketPigCost: flows.costOfMarketPigsSold,
    giltCost: flows.costOfGiltsSold,
    breedingStockCost: flows.costOfBreedingStockSold,
    total:
      flows.costOfMarketPigsSold + flows.costOfGiltsSold + flows.costOfBreedingStockSold,
  };

  // What the ledger charged this period and the animals did not absorb.
  const throughTheLedger = periodExpenses(totals, period);
  const breedingHerd = flows.breedingHerdCosts;
  const labour = totals.labour;
  const overheads = totals.overheads + totals.contingency + totals.capital;
  const mortalityLosses = flows.mortalityLossLivestock + flows.mortalityLossBreeding;
  const operatingExpenses = {
    breedingHerd,
    labour,
    overheads,
    depreciation: flows.depreciation,
    mortalityLosses,
    other: throughTheLedger - breedingHerd - labour - overheads,
    // Depreciation and mortality never touched the ledger, so they are added to
    // it rather than found inside it.
    total: throughTheLedger + flows.depreciation + mortalityLosses,
  };

  const grossProfit = revenue.total - costOfSales.total;
  return {
    revenue,
    costOfSales,
    grossProfit,
    operatingExpenses,
    operatingProfit: grossProfit - operatingExpenses.total,
  };
}

/** Income less expenditure for the period: the statement the plan has always shown. */
export function currentProfitOrLoss(totals: CategoryTotals): number {
  return incomeOf(totals) - expensesOf(totals);
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
  const currentProfit = currentProfitOrLoss(totals);
  const capitalisedIntoLivestock = flows.capitalisedMarket + flows.capitalisedReplacement;
  const freightHeldInStores =
    period.closing.freightInStore - period.opening.freightInStore;
  const costOfLivestockSold =
    flows.costOfMarketPigsSold + flows.costOfGiltsSold;
  const mortalityWriteOffs = flows.mortalityLossLivestock + flows.mortalityLossBreeding;
  const changeInFarmInventory =
    inventoryTotal(period.closing) - inventoryTotal(period.opening);
  return {
    currentProfit,
    capitalisedIntoLivestock,
    breedingStockBought: flows.breedingPurchases,
    freightHeldInStores,
    costOfLivestockSold,
    mortalityWriteOffs,
    breedingStockDepreciation: flows.depreciation,
    carryingValueOfBreedingStockSold: flows.costOfBreedingStockSold,
    inventoryAdjustedProfit: currentProfit + changeInFarmInventory,
    changeInFarmInventory,
  };
}
