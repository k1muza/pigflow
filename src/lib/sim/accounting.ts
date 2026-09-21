import { DAYS_PER_MONTH, type PlannerConfig } from "../config";
import type { Boar, GrowingPig, Sow } from "./animals";

/**
 * The second set of books: what the farm owns, as against what it earned.
 *
 * The ledger answers "how much came in this month and how much went out".
 * That is the right question for a bank balance and the wrong one for a herd
 * that is growing: a farm that spends four thousand rearing pigs it has not
 * sold yet has not lost four thousand, it has four thousand standing in the
 * finishing house. The ledger cannot see the difference, because a cost and a
 * consumed cost are the same posting to it.
 *
 * So this keeps the other half. Costs that turn into an animal are followed
 * onto the animal and stay there until the animal leaves — sold, dead, or
 * promoted into the breeding herd — and only then do they become an expense.
 * Costs that turn into nothing you can point at, which is most of the breeding
 * herd's keep and all of the overheads, are expenses on the day they fall.
 *
 * Nothing here posts to the ledger and nothing here changes what the animals
 * do. It is a parallel record, written from the same events, and the existing
 * profit and loss comes out of a run byte for byte as it did before.
 *
 * @see docs/pigflow-inventory-adjusted-profit-spec.md
 */

/**
 * What one day did to the farm's stock of unsold animals and breeding assets.
 *
 * The flows are what moved and why; the balances are what was standing at the
 * close. They are two readings of the same thing and they have to agree — the
 * change in the balances over a day is exactly the day's flows, and
 * {@link accountingDrift} is what checks it.
 */
export type AccountingDay = {
  // ---- costs that became an animal rather than an expense -----------------
  /** Rearing costs added to pigs on their way to the abattoir. */
  capitalisedMarket: number;
  /** Rearing costs added to females picked out to join the breeding herd. */
  capitalisedReplacement: number;
  /** Gilts and boars bought in, at what was paid for them. */
  breedingPurchases: number;
  /**
   * Keeping the sows and boars: their feed, their veterinary care and their
   * services. This is not capitalised — it is a cost of running the breeding
   * herd, and the herd is not worth any more at the end of the day for having
   * been fed — but it is worth seeing on its own line.
   */
  breedingHerdCosts: number;

  // ---- moves between the accounts, which create nothing -------------------
  /** Carried out of market stock and into the replacement pipeline on selection. */
  selectedToReplacement: number;
  /** Carried out of the replacement pipeline and into the herd on promotion. */
  promotedToBreeding: number;

  // ---- what left through the profit and loss ------------------------------
  /** Carrying cost of the market pigs drawn today: the cost of livestock sold. */
  costOfMarketPigsSold: number;
  /** Carrying cost of surplus gilts sold as breeding stock. */
  costOfGiltsSold: number;
  /** Carrying value of sows culled and boars rotated out. */
  costOfBreedingStockSold: number;
  /** Carrying cost written off with pigs that died. */
  mortalityLossLivestock: number;
  /** Carrying value written off with breeding stock that died. */
  mortalityLossBreeding: number;
  /** Breeding stock written down for the working life used up today. */
  depreciation: number;

  // ---- money that moved without the farm trading --------------------------
  /**
   * Cash the funding buttons put in today, and took out.
   *
   * Neither is the farm earning or spending anything: a generated injection
   * tops the bank up and a generated withdrawal takes a surplus out, and the
   * herd is exactly as it was either way. They are posted to other income and
   * to fixed overheads so that the cash book balances, which means both profit
   * statements would otherwise read them as trading — an injection as income
   * and a withdrawal as a cost. Recording them here is how every reading of the
   * period takes the same two figures back out again.
   *
   * Rows the owner typed himself are not in here. A grant or a repair is a farm
   * item and is costed like one; see `config.finance.cashMovements`.
   */
  financingIn: number;
  financingOut: number;

  // ---- and what was standing at the close ---------------------------------
  marketWip: number;
  replacementWip: number;
  sowAssets: number;
  boarAssets: number;
  /** Journeys paid for whose goods are still in the store they were tipped into. */
  freightInStore: number;
};

/**
 * What the farm is worth on a given day, at cost.
 *
 * The date is not on here on purpose: a valuation is always read as part of a
 * day, and the day it belongs to already says which one it is.
 */
export type FarmValuation = {
  cash: number;
  inventory: {
    /** Feed standing in the bins, at what it cost to buy. */
    feed: number;
    /** Gas, bedding and the journeys that brought goods still in the store. */
    supplies: number;
    /** Every unsold pig on its way to the abattoir, at its accumulated cost. */
    marketLivestock: number;
    /** Females picked out to breed, carrying their rearing bill with them. */
    replacementGilts: number;
  };
  breedingAssets: { sows: number; boars: number };
  liabilities: {
    payables: number;
    /**
     * A bank balance below zero, which is money the farm owes rather than an
     * asset it has less than none of. It is shown as a liability because that
     * is what it is: an overdrawn account is borrowing, and putting it on the
     * asset side as negative cash understates both sides of the sheet while
     * leaving the net worth right — so a plan being funded looks smaller than
     * it is instead of looking borrowed against.
     */
    overdraft: number;
    other: number;
  };
  /** What the farm holds. Never includes the overdraft; see the liabilities. */
  totalAssets: number;
  totalLiabilities: number;
  netWorth: number;
};

/**
 * What the farm is worth at cost: everything it owns, less what it owes.
 *
 * Buildings are not in it, because the model does not carry them — the places
 * a farm has are a constraint on the herd here rather than an asset on a
 * balance sheet. What is in it is the cash, the stores, and every animal at
 * what has been spent on it.
 */
export function netWorthAtCost(parts: {
  cash: number;
  /** Goods standing in the stores, at what they cost to buy. */
  storeValue: number;
  payables: number;
  balances: AccountingBalances;
}): number {
  return (
    parts.cash + parts.storeValue + inventoryTotal(parts.balances) - parts.payables
  );
}

/** Assembles the balance sheet from the pieces each engine keeps its own way. */
export function farmValuation(parts: {
  cash: number;
  feedValue: number;
  suppliesValue: number;
  balances: AccountingBalances;
  payables: number;
  otherLiabilities?: number;
}): FarmValuation {
  const { balances } = parts;
  const inventory = {
    feed: parts.feedValue,
    supplies: parts.suppliesValue + balances.freightInStore,
    marketLivestock: balances.marketWip,
    replacementGilts: balances.replacementWip,
  };
  const breedingAssets = { sows: balances.sowAssets, boars: balances.boarAssets };
  // An overdrawn account is a debt, so it crosses to the other side of the
  // sheet rather than sitting in the assets as a negative. The net worth is the
  // same figure either way, which is the point: nothing is being revalued here,
  // only shown under the heading it belongs to.
  const cash = Math.max(0, parts.cash);
  const overdraft = Math.max(0, -parts.cash);
  const liabilities = {
    payables: parts.payables,
    overdraft,
    other: parts.otherLiabilities ?? 0,
  };
  const totalAssets =
    cash +
    inventory.feed +
    inventory.supplies +
    inventory.marketLivestock +
    inventory.replacementGilts +
    breedingAssets.sows +
    breedingAssets.boars;
  const totalLiabilities = liabilities.payables + liabilities.overdraft + liabilities.other;
  return {
    cash,
    inventory,
    breedingAssets,
    liabilities,
    totalAssets,
    totalLiabilities,
    netWorth: totalAssets - totalLiabilities,
  };
}

/** The five asset balances, without the day's movements. */
export type AccountingBalances = Pick<
  AccountingDay,
  "marketWip" | "replacementWip" | "sowAssets" | "boarAssets" | "freightInStore"
>;

export const ZERO_BALANCES: AccountingBalances = {
  marketWip: 0,
  replacementWip: 0,
  sowAssets: 0,
  boarAssets: 0,
  freightInStore: 0,
};

export function emptyAccountingDay(): AccountingDay {
  return {
    capitalisedMarket: 0,
    capitalisedReplacement: 0,
    breedingPurchases: 0,
    breedingHerdCosts: 0,
    selectedToReplacement: 0,
    promotedToBreeding: 0,
    costOfMarketPigsSold: 0,
    costOfGiltsSold: 0,
    costOfBreedingStockSold: 0,
    mortalityLossLivestock: 0,
    mortalityLossBreeding: 0,
    depreciation: 0,
    financingIn: 0,
    financingOut: 0,
    ...ZERO_BALANCES,
  };
}

/** Everything the farm was holding at the close, added up. */
export function inventoryTotal(balances: AccountingBalances): number {
  return (
    balances.marketWip +
    balances.replacementWip +
    balances.sowAssets +
    balances.boarAssets +
    balances.freightInStore
  );
}

// ------------------------------------------------------------ breeding assets

/**
 * What a sow loses in value with each litter she rears.
 *
 * A sow is a working asset with a known end: she is culled after so many
 * parities and sold for what a cull sow fetches. The difference between what
 * she was worth walking into the herd and what she will fetch walking out of it
 * is spread over the litters in between, which is what makes a parity-six sow
 * worth less on the books than a parity-one sow of the same weight.
 *
 * A gilt reared for less than a cull sow fetches has nothing to depreciate, so
 * she simply holds her value. That is not a trick of the arithmetic: a cheap
 * home-bred gilt genuinely is not losing anything as she works.
 *
 * `valuedAfter` is the parity she was already at when she was put on the books
 * at this value, which is zero for every sow the plan itself reared or bought.
 * A sow the farm already owned is entered at what she is worth now, so what is
 * left of her value is spread over the litters she has left rather than over a
 * whole working life she has not got.
 */
export function sowDepreciationPerParity(
  breedingValue: number,
  config: PlannerConfig,
  valuedAfter = 0,
): number {
  const depreciable = Math.max(0, breedingValue - config.herd.cullSowSaleValue);
  const paritiesLeft = config.herd.cullAfterParity - Math.max(0, valuedAfter);
  return depreciable / Math.max(1, paritiesLeft);
}

/** What a sow at this parity should have been written down by in total. */
export function sowDepreciationAtParity(
  breedingValue: number,
  parity: number,
  config: PlannerConfig,
  valuedAfter = 0,
): number {
  const depreciable = Math.max(0, breedingValue - config.herd.cullSowSaleValue);
  // Litters since she was valued, which for anything the plan bred is all of them.
  const worked = Math.max(0, parity - Math.max(0, valuedAfter));
  return Math.min(depreciable, sowDepreciationPerParity(breedingValue, config, valuedAfter) * worked);
}

/**
 * What a boar loses in value for each day he stands, spread over his working
 * life. `valuedAfter` is the days of service already behind him when he was put
 * on the books at this value; see {@link sowDepreciationPerParity}.
 */
export function boarDepreciationPerDay(
  breedingValue: number,
  config: PlannerConfig,
  valuedAfter = 0,
): number {
  const depreciable = Math.max(0, breedingValue - config.herd.boarResidualValue);
  const workingLifeDays = config.herd.boarWorkingLifeMonths * DAYS_PER_MONTH;
  return depreciable / Math.max(1, workingLifeDays - Math.max(0, valuedAfter));
}

/** What a boar this far into his working life should have been written down by. */
export function boarDepreciationAtDay(
  breedingValue: number,
  daysInService: number,
  config: PlannerConfig,
  valuedAfter = 0,
): number {
  const depreciable = Math.max(0, breedingValue - config.herd.boarResidualValue);
  const stood = Math.max(0, daysInService - Math.max(0, valuedAfter));
  return Math.min(
    depreciable,
    boarDepreciationPerDay(breedingValue, config, valuedAfter) * stood,
  );
}

/** What this animal is carried at: what it was worth, less what it has used up. */
export function carryingValue(animal: { breedingValue: number; accumulatedDepreciation: number }) {
  return Math.max(0, animal.breedingValue - animal.accumulatedDepreciation);
}

// ------------------------------------------------------------------- the book

/**
 * The day's movements as they happen, and the balances as they stand.
 *
 * Every method is one of the accounting events in the specification, and each
 * of them does exactly one thing: it records that something moved between two
 * of the farm's accounts, or out of them through the profit and loss. The
 * balances themselves are not kept here — they are read off the animals and the
 * stores at the close, which is the only way they cannot drift.
 */
export class Books {
  /** What the farm was holding before the first day ran. */
  readonly opening: AccountingBalances = { ...ZERO_BALANCES };
  private flows = emptyAccountingDay();

  // ---- costs that became an animal ----------------------------------------

  /** A production cost followed onto the pig it was spent on. */
  capitalise(destination: "market" | "breeding", amount: number): void {
    if (!Number.isFinite(amount) || amount === 0) return;
    if (destination === "breeding") this.flows.capitalisedReplacement += amount;
    else this.flows.capitalisedMarket += amount;
  }

  /** A gilt or boar bought in: cash out, and a breeding asset in its place. */
  buyBreedingStock(amount: number): void {
    if (!Number.isFinite(amount) || amount === 0) return;
    this.flows.breedingPurchases += amount;
  }

  /**
   * What the breeding herd cost to keep today. A sow eats to stay a sow: it
   * makes her no more valuable, so it is a cost of this period and not part of
   * what she is carried at.
   */
  keepBreedingHerd(amount: number): void {
    if (!Number.isFinite(amount) || amount === 0) return;
    this.flows.breedingHerdCosts += amount;
  }

  // ---- moves between the accounts -----------------------------------------

  /** A female picked out to breed takes her rearing bill across with her. */
  selectGilt(accumulatedCost: number): void {
    this.flows.selectedToReplacement += accumulatedCost;
  }

  /** She joins the herd, and what she cost to rear becomes what she is worth. */
  promoteGilt(accumulatedCost: number): void {
    this.flows.promotedToBreeding += accumulatedCost;
  }

  // ---- what left through the profit and loss ------------------------------

  /** A market pig on the lorry: its whole bill becomes the cost of that sale. */
  sellMarketPig(accumulatedCost: number): void {
    this.flows.costOfMarketPigsSold += accumulatedCost;
  }

  /** A surplus gilt sold as breeding stock rather than kept. */
  sellGilt(accumulatedCost: number): void {
    this.flows.costOfGiltsSold += accumulatedCost;
  }

  /** A sow culled or a boar rotated out, at whatever he or she was carried at. */
  sellBreedingStock(value: number): void {
    this.flows.costOfBreedingStockSold += value;
  }

  /** A pig that died: the bill is a loss rather than a cost of anything sold. */
  writeOffLivestock(accumulatedCost: number): void {
    this.flows.mortalityLossLivestock += accumulatedCost;
  }

  /** A sow or boar that died, at carrying value. */
  writeOffBreedingStock(value: number): void {
    this.flows.mortalityLossBreeding += value;
  }

  /** Working life used up by the breeding herd today. */
  depreciate(amount: number): void {
    if (!Number.isFinite(amount) || amount <= 0) return;
    this.flows.depreciation += amount;
  }

  // ---- and what never went through the farm at all ------------------------

  /**
   * Cash the funding buttons moved. Recorded so that both profit statements can
   * leave it out; see {@link AccountingDay.financingIn}.
   */
  finance(kind: "in" | "out", amount: number): void {
    if (!Number.isFinite(amount) || amount <= 0) return;
    if (kind === "in") this.flows.financingIn += amount;
    else this.flows.financingOut += amount;
  }

  // ---- closing ------------------------------------------------------------

  /**
   * Seals the day: the movements already recorded, plus what is standing at the
   * close, read off the farm itself.
   */
  close(balances: AccountingBalances): AccountingDay {
    const day: AccountingDay = { ...this.flows, ...balances };
    this.flows = emptyAccountingDay();
    return day;
  }
}

// ------------------------------------------------------------- reading a farm

/**
 * Writes the breeding herd down for the working life it used up today.
 *
 * A sow is written down by parity, because what wears her out is rearing
 * litters rather than the passing of time; a boar is written down by the day,
 * because what wears him out is standing there. Both are held at their expected
 * disposal value once they have been written down that far — a working sow is
 * never worth less on the books than the abattoir would pay for her.
 */
export function chargeDepreciation(
  farm: { sows: readonly Sow[]; boars: readonly Boar[] },
  day: number,
  config: PlannerConfig,
  books: Books,
): void {
  for (const sow of farm.sows) {
    if (!sow.alive || sow.breedingValue <= 0) continue;
    const target = sowDepreciationAtParity(
      sow.breedingValue,
      sow.parity,
      config,
      sow.valuedAfter,
    );
    const charge = target - sow.accumulatedDepreciation;
    if (charge <= 0) continue;
    sow.accumulatedDepreciation = target;
    books.depreciate(charge);
  }
  for (const boar of farm.boars) {
    if (!boar.alive || boar.breedingValue <= 0) continue;
    const target = boarDepreciationAtDay(
      boar.breedingValue,
      day - boar.joinedDay,
      config,
      boar.valuedAfter,
    );
    const charge = target - boar.accumulatedDepreciation;
    if (charge <= 0) continue;
    boar.accumulatedDepreciation = target;
    books.depreciate(charge);
  }
}

/**
 * What the farm is holding, read off the herd rather than off a running total.
 *
 * A pig's book value is what has been spent on it and nothing else. It is not
 * what the abattoir would pay for it today: an unsold pig has earned the farm
 * nothing, and writing the sale price onto it would book the profit before the
 * lorry came. That distinction is the whole point of these books.
 */
export function readBalances(
  farm: {
    pigs: readonly GrowingPig[];
    sows: readonly Sow[];
    boars: readonly Boar[];
  },
  freightInStore: number,
): AccountingBalances {
  let marketWip = 0;
  let replacementWip = 0;
  for (const pig of farm.pigs) {
    if (!pig.alive) continue;
    if (pig.destination === "breeding") replacementWip += pig.costs.total;
    else marketWip += pig.costs.total;
  }
  let sowAssets = 0;
  for (const sow of farm.sows) if (sow.alive) sowAssets += carryingValue(sow);
  let boarAssets = 0;
  for (const boar of farm.boars) if (boar.alive) boarAssets += carryingValue(boar);
  return { marketWip, replacementWip, sowAssets, boarAssets, freightInStore };
}

/** What each group a herd is counted in is carried at, at cost. */
export type StageValues = {
  gestatingSows: number;
  lactatingSows: number;
  openSows: number;
  boars: number;
  piglets: number;
  weaners: number;
  growers: number;
  finishers: number;
  gilts: number;
};

/**
 * The books split by the groups a stockperson counts the herd in.
 *
 * {@link readBalances} answers what the farm holds in four buckets, which is
 * what a balance sheet wants; this answers the same question group by group,
 * which is what a panel showing the herd wants. Both read the same value off
 * the same animal — a market pig at what has been spent on it, a sow or a boar
 * at what is left of what she was entered or promoted at — so the nine groups
 * add up to the four buckets and neither can drift from the other.
 */
export function herdValuesAtCost(farm: {
  pigs: readonly GrowingPig[];
  sows: readonly Sow[];
  boars: readonly Boar[];
}): StageValues {
  const values: StageValues = {
    gestatingSows: 0,
    lactatingSows: 0,
    openSows: 0,
    boars: 0,
    piglets: 0,
    weaners: 0,
    growers: 0,
    finishers: 0,
    gilts: 0,
  };
  for (const sow of farm.sows) {
    if (!sow.alive) continue;
    if (sow.state === "gestating") values.gestatingSows += carryingValue(sow);
    else if (sow.state === "lactating") values.lactatingSows += carryingValue(sow);
    else values.openSows += carryingValue(sow);
  }
  for (const boar of farm.boars) {
    if (boar.alive) values.boars += carryingValue(boar);
  }
  for (const pig of farm.pigs) {
    if (!pig.alive) continue;
    if (pig.stage === "piglet") values.piglets += pig.costs.total;
    else if (pig.stage === "weaner") values.weaners += pig.costs.total;
    else if (pig.stage === "grower") values.growers += pig.costs.total;
    else if (pig.stage === "finisher") values.finishers += pig.costs.total;
    else values.gilts += pig.costs.total;
  }
  return values;
}

/**
 * How far a day's balances stand from what its movements said they would.
 *
 * Zero on a farm whose books are kept properly, and the check the invariant
 * tests are written against: an asset must never appear simply because a cost
 * was moved from one account into another.
 */
export function accountingDrift(
  opening: AccountingBalances,
  day: AccountingDay,
): number {
  const moved =
    day.capitalisedMarket +
    day.capitalisedReplacement +
    day.breedingPurchases -
    day.costOfMarketPigsSold -
    day.costOfGiltsSold -
    day.costOfBreedingStockSold -
    day.mortalityLossLivestock -
    day.mortalityLossBreeding -
    day.depreciation;
  const freightMovement = day.freightInStore - opening.freightInStore;
  return inventoryTotal(day) - inventoryTotal(opening) - moved - freightMovement;
}

/**
 * Opening breeding values for the herd a plan starts with.
 *
 * Founding stock was not bought during the plan, so nothing in the ledger says
 * what it cost. It is still worth something, and pretending otherwise would
 * make the first home-bred gilt to reach the herd look like a windfall. A
 * founding sow is valued at what a replacement gilt costs, already written down
 * for the parities she has behind her; a founding boar at what a boar costs.
 */
export function valueFoundingStock(
  farm: { sows: readonly Sow[]; boars: readonly Boar[] },
  config: PlannerConfig,
): void {
  for (const sow of farm.sows) {
    if (sow.breedingValue > 0) continue;
    sow.breedingValue = config.herd.giltPurchaseCost;
    sow.accumulatedDepreciation = sowDepreciationAtParity(
      sow.breedingValue,
      sow.parity,
      config,
    );
  }
  for (const boar of farm.boars) {
    if (boar.breedingValue > 0) continue;
    boar.breedingValue = config.herd.boarPurchaseCost;
    boar.accumulatedDepreciation = 0;
  }
}
