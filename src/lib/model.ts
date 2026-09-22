import { addDays, addMonths, format, parseISO } from "date-fns";

import {
  addFlows,
  balancesOf,
  emptyFlows,
  mergeAccounting,
  type PeriodAccounting,
} from "./accounts";
import { ESTRUS_CYCLE_DAYS, openingCounts, type PlannerConfig } from "./config";
import { plural } from "./format";
import { HOUSING_LABELS, type HousingShortageSummary } from "./housing";
import { growoutFeedConversion } from "./growth-curve";
import {
  netWorthAtCost,
  ZERO_BALANCES,
  type AccountingBalances,
  type FarmValuation,
} from "./sim/accounting";
import { orphanStartingPiglets } from "./sim/starting-stock";
import { simulatePlan } from "./simulation";
import {
  addTotals,
  cashTotalsOf,
  payablesOf,
  CATEGORY_LABELS,
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  emptyTotals,
  expensesOf,
  incomeOf,
  type CategoryTotals,
  type CostOfProduction,
  type DayRecord,
  type GenerationRow,
} from "./sim";

export {
  BIRTH_WEIGHT_KG,
  cloneDefaultConfig,
  DEFAULT_CONFIG,
  DEFAULT_VACCINATIONS,
  ESTRUS_CYCLE_DAYS,
  GILT_ACCLIMATISATION_DAYS,
  GILT_ENTRY_AGE_DAYS,
  newPlanConfig,
  plannerSchema,
  SERVICES_PER_BOAR_PER_WEEK,
  withConfigDefaults,
  type CashMovement,
  type PlannerConfig,
  type PlannerSection,
  type Vaccination,
} from "./config";

/** A month of the plan: what the farm produced and what the money did. */
export type MonthlyProjection = {
  index: number;
  date: string;
  month: string;
  year: number;
  days: number;
  farrowings: number;
  bornAlive: number;
  weaned: number;
  pigsSold: number;
  saleLiveweightKg: number;
  /** Carcass weight sold, which is what the sale price is applied to. */
  saleDeadweightKg: number;
  giltsSelected: number;
  giltsPromoted: number;
  giltsSold: number;
  deaths: number;
  piglets: number;
  weaners: number;
  growers: number;
  finishers: number;
  gilts: number;
  replacementPipeline: number;
  sows: number;
  /**
   * The sow herd at the month end split by what each sow is doing, which is
   * what a herd development plan is actually about: a shed full of gestating
   * sows and a shed full of open ones are the same head count and not the same
   * farm. The three add up to {@link sows}.
   */
  gestatingSows: number;
  lactatingSows: number;
  openSows: number;
  boars: number;
  breedingStock: number;
  /** Every pig on the place at the month end, breeding stock included. */
  head: number;
  /** Breeding stock that left the herd this month, by the door it left through. */
  sowsCulled: number;
  boarsRotated: number;
  /**
   * The most head the farm carried on any one day of the month — every pig on
   * the place, breeding stock included. Month-end counts miss a batch that
   * arrived and went inside the month, and it is the peak that has to be housed.
   */
  peakHead: number;
  /** V2's highest recorded room census in the month; absent on 1.x records. */
  housingPeak?: {
    farrowing: number;
    weaner: number;
    grower: number;
    finisher: number;
  };
  /** Stockpeople the herd needs at the end of the month. */
  workers: number;
  sowFeedKg: number;
  growingFeedKg: number;
  /** Lorries through the gate this month, and the feed they brought. */
  lorriesIn: number;
  feedDeliveredKg: number;
  /**
   * What the month earned and consumed, by ledger category: the profit and loss.
   * Feed appears here on the days it was eaten.
   */
  totals: CategoryTotals;
  /**
   * What actually moved through the bank, by the same categories: the cash book.
   * Feed appears here on the day the supplier's invoice was paid, which is
   * neither the day it arrived nor the days it was eaten.
   *
   * On the 1.x engine the two are the same numbers, because that engine posts
   * every cost as a payment. On 2.0 with accrual accounting they are not, and a
   * statement headed "cash" has to read this one.
   */
  cashTotals: CategoryTotals;
  /** Earned and consumed — the profit and loss totals. */
  revenue: number;
  totalCost: number;
  /** Received and paid — the cash book totals. */
  cashIn: number;
  cashOut: number;
  netCashFlow: number;
  closingCash: number;
  /** Owed to suppliers at the end of the month, which is what the two differ by. */
  payables: number;
  /** Goods standing in the stores at the month end, at what they cost to buy. */
  storeValue: number;
  /**
   * What the whole place is worth at the month end, at cost: cash, the stores,
   * and every animal at what has been spent on it, less what is owed. Buildings
   * are not in it — the model carries the places a farm has as a constraint on
   * the herd rather than as an asset. Experimental, like the books behind it.
   */
  netWorth: number;
  /**
   * The same month read through the experimental second set of books: what it
   * put into the herd and the stores rather than only what it earned and spent.
   * {@link ../accounts} turns it into a profit statement and a balance sheet.
   */
  accounting: PeriodAccounting;
};

export type PeriodSummary = {
  key: string;
  label: string;
  startDate: string;
  endDate: string;
  months: number[];
  /** Earned and consumed over the period. */
  totals: CategoryTotals;
  /** Received and paid over the period, which is not the same statement. */
  cashTotals: CategoryTotals;
  revenue: number;
  totalCost: number;
  cashIn: number;
  cashOut: number;
  netCashFlow: number;
  closingCash: number;
  payables: number;
  /** Goods standing in the stores at the year end, at what they cost to buy. */
  storeValue: number;
  /** What the whole place is worth at the year end, at cost. Experimental. */
  netWorth: number;
  pigsSold: number;
  bornAlive: number;
  weaned: number;
  giltsSold: number;
  sows: number;
  accounting: PeriodAccounting;
};

export type ProjectionSummary = {
  totalRevenue: number;
  totalFeedCost: number;
  totalVeterinaryCost: number;
  totalCost: number;
  totalPigsSold: number;
  totalBornAlive: number;
  totalWeaned: number;
  totalDeaths: number;
  closingCash: number;
  lowestCash: number;
  peakFundingNeed: number;
  feedShareOfOperatingCost: number;
  pigsWeanedPerSowYear: number;
  littersPerSowYear: number;
  averageSows: number;
  finalSows: number;
  /**
   * The most sows the herd ever stood, and the first month it stood its full
   * places. A herd that fills its places and is then drawn down by culling and
   * mortality ends below capacity without ever having failed to reach it, and
   * the two facts are different enough that a plan has to be able to say both.
   * Worked out once here so that a warning and a herd milestone cannot disagree.
   */
  peakSows: number;
  peakSowsMonth: string | null;
  sowCapacityReachedMonth: string | null;
  /** The most head the farm ever carries at once over the whole horizon. */
  peakHeadCount: number;
  firstPositiveMonth: string | null;
  herdValueAtEnd: number;
  netWorthAtEnd: number;

  // ---- the experimental inventory-adjusted view --------------------------
  /**
   * Profit with the costs that turned into unsold animals held back until
   * those animals leave. On a farm that is neither growing nor shrinking it
   * lands on the same figure as income less expenditure; on one that is filling
   * its places it is higher, by exactly what it put into the herd.
   */
  inventoryAdjustedProfit: number;
  /** Everything the farm owns at cost, less what it owes, at the horizon. */
  farmWorthAtEnd: number;
  /** How much of that it built over the plan, rather than started with. */
  changeInFarmWorth: number;
  marketLivestockValueAtEnd: number;
  breedingHerdValueAtEnd: number;
  feedInventoryValueAtEnd: number;
};

export type ProjectionResult = {
  months: MonthlyProjection[];
  years: PeriodSummary[];
  summary: ProjectionSummary;
  /** The whole horizon through the second set of books. */
  accounting: PeriodAccounting;
  /** The farm's closing balance sheet, at cost. */
  farmWorth: FarmValuation;
  generations: GenerationRow[];
  costOfProduction: CostOfProduction;
  warnings: ModelWarning[];
};

export type ModelWarning = {
  level: "attention" | "info";
  title: string;
  detail: string;
};

export type BenchmarkSource = {
  title: string;
  /** Left off for a source that is a document rather than a page on the web. */
  url?: string;
  note: string;
};

export const BENCHMARK_SOURCES: readonly BenchmarkSource[] = [
  {
    title: "MSD Veterinary Manual — breeding management of pigs",
    url: "https://www.msdvetmanual.com/management-and-nutrition/management-of-reproduction-pigs/breeding-management-of-pigs",
    note: "Gestation, estrous cycle, conception and typical litter context.",
  },
  {
    title: "MSD Veterinary Manual — preventive health care",
    url: "https://www.msdvetmanual.com/management-and-nutrition/preventive-health-care-and-husbandry-of-pigs/preventive-health-care-and-husbandry-of-pigs",
    note: "Weaning-to-breeding timing, whole-growing-phase FCR and livability context.",
  },
  {
    title: "AHDB — improving pre-weaning KPIs",
    url: "https://ahdb.org.uk/knowledge-library/improving-kpis-pre-weaning",
    note: "Born-alive, pre-weaning mortality and pigs-weaned benchmark context.",
  },
  {
    title: "Pork Information Gateway — grow-finish feeding management",
    url: "https://porkgateway.org/resource/growing-finishing-swine-nutrient-recommendations-and-feeding-management/",
    note: "Feed/gain benchmarks and the share of production cost commonly attributable to feed.",
  },
  {
    title: "ARC Institute for Agricultural Engineering — Manual on housing for pigs",
    note: "Stage weights through the grower and finishing houses, ad lib against restricted feeding, and the load weight puts on upkeep feed. The copy this model was read from is in docs/.",
  },
];

/**
 * The planning arithmetic a farmer can check by hand, before any animal is
 * simulated. A service that does not hold costs one estrous cycle, so repeat
 * services lengthen the average farrowing interval.
 */
export function getModelMetrics(config: PlannerConfig) {
  const holdRate = config.reproduction.farrowingSuccessPct / 100;
  const productiveCycleDays =
    config.reproduction.gestationDays +
    config.reproduction.weaningAgeDays +
    config.reproduction.weanToServiceDays;
  const repeatDays = holdRate > 0 ? (ESTRUS_CYCLE_DAYS * (1 - holdRate)) / holdRate : 0;
  const cycleDays = productiveCycleDays + repeatDays;
  const littersPerSowYear = holdRate > 0 ? 365 / cycleDays : 0;
  const weanedPerLitter =
    config.reproduction.bornAlivePerLitter * (1 - config.reproduction.preWeanMortalityPct / 100);
  const vaccinationCostPerPig = config.health.vaccinations.reduce(
    (total, dose) => total + dose.costPerPig,
    0,
  );
  return {
    productiveCycleDays,
    cycleDays,
    littersPerSowYear,
    weanedPerLitter,
    pigsWeanedPerSowYear: littersPerSowYear * weanedPerLitter,
    vaccinationCostPerPig,
    feedConversion: growoutFeedConversion(config.growth),
    daysToSaleWeight:
      config.reproduction.weaningAgeDays +
      (config.growth.growerStartWeightKg - config.growth.weaningWeightKg) /
        config.growth.weanerDailyGainKg +
      (config.growth.finisherStartWeightKg - config.growth.growerStartWeightKg) /
        config.growth.growerDailyGainKg +
      (config.growth.saleWeightKg - config.growth.finisherStartWeightKg) /
        config.growth.finisherDailyGainKg,
  };
}

/**
 * A day, as either engine hands it over. The 1.x record carries one book; the
 * 2.0 record carries two and says what is owed. Both roll up through the same
 * code, which is what lets the rest of the product stay engine-agnostic.
 */
export type BookedDayRecord = DayRecord & {
  cashTotals?: CategoryTotals;
  payables?: number;
  occupancy?: {
    farrowing: number;
    weaner: number;
    grower: number;
    finisher: number;
  };
};

export function summariseMonth(
  index: number,
  date: Date,
  days: readonly BookedDayRecord[],
  /**
   * What the farm was holding before the first of these days ran. Without it a
   * month cannot say how much it added to the herd, only how much is there now
   * — so the caller, which knows what came before, hands it in.
   */
  opening: AccountingBalances = ZERO_BALANCES,
): MonthlyProjection {
  const totals = emptyTotals();
  const cashTotals = emptyTotals();
  const accounting: PeriodAccounting = {
    flows: emptyFlows(),
    opening: { ...opening },
    closing: { ...opening },
  };
  const month: MonthlyProjection = {
    index,
    date: format(date, "yyyy-MM-dd"),
    month: format(date, "MMM yy"),
    year: date.getFullYear(),
    days: days.length,
    farrowings: 0,
    bornAlive: 0,
    weaned: 0,
    pigsSold: 0,
    saleLiveweightKg: 0,
    saleDeadweightKg: 0,
    giltsSelected: 0,
    giltsPromoted: 0,
    giltsSold: 0,
    deaths: 0,
    piglets: 0,
    weaners: 0,
    growers: 0,
    finishers: 0,
    gilts: 0,
    replacementPipeline: 0,
    sows: 0,
    gestatingSows: 0,
    lactatingSows: 0,
    openSows: 0,
    boars: 0,
    breedingStock: 0,
    head: 0,
    sowsCulled: 0,
    boarsRotated: 0,
    peakHead: 0,
    workers: 0,
    sowFeedKg: 0,
    growingFeedKg: 0,
    lorriesIn: 0,
    feedDeliveredKg: 0,
    totals,
    cashTotals,
    revenue: 0,
    totalCost: 0,
    cashIn: 0,
    cashOut: 0,
    netCashFlow: 0,
    closingCash: 0,
    payables: 0,
    storeValue: 0,
    netWorth: 0,
    accounting,
  };

  for (const day of days) {
    month.farrowings += day.farrowings;
    month.bornAlive += day.bornAlive;
    month.weaned += day.weaned;
    month.pigsSold += day.sold;
    month.saleLiveweightKg += day.soldLiveweightKg;
    month.saleDeadweightKg += day.soldDeadweightKg;
    month.giltsSelected += day.giltsSelected;
    month.giltsPromoted += day.giltsPromoted;
    month.giltsSold += day.giltsSold;
    month.deaths += day.pigletDeaths + day.growingDeaths + day.breedingDeaths;
    month.sowsCulled += day.sowsCulled;
    month.boarsRotated += day.boarsRotated;
    month.sowFeedKg += day.sowFeedKg;
    month.growingFeedKg += day.growingFeedKg;
    month.lorriesIn += day.lorriesIn;
    month.feedDeliveredKg += day.feedDeliveredKg;
    month.peakHead = Math.max(month.peakHead, day.counts.total);
    if (day.occupancy) {
      const peak = month.housingPeak ?? {
        farrowing: 0,
        weaner: 0,
        grower: 0,
        finisher: 0,
      };
      peak.farrowing = Math.max(peak.farrowing, day.occupancy.farrowing);
      peak.weaner = Math.max(peak.weaner, day.occupancy.weaner);
      peak.grower = Math.max(peak.grower, day.occupancy.grower);
      peak.finisher = Math.max(peak.finisher, day.occupancy.finisher);
      month.housingPeak = peak;
    }
    addTotals(totals, day.totals);
    addTotals(cashTotals, cashTotalsOf(day));
    addFlows(accounting.flows, day.accounting);
    accounting.closing = balancesOf(day.accounting);
  }

  const last = days.at(-1);
  if (last) {
    month.piglets = last.counts.piglets;
    month.weaners = last.counts.weaners;
    month.growers = last.counts.growers;
    month.finishers = last.counts.finishers;
    month.gilts = last.counts.gilts;
    month.replacementPipeline = last.counts.replacementPipeline;
    month.sows = last.counts.sows;
    month.gestatingSows = last.counts.gestatingSows;
    month.lactatingSows = last.counts.lactatingSows;
    month.openSows = last.counts.openSows;
    month.boars = last.counts.boars;
    month.breedingStock = last.counts.sows + last.counts.boars;
    month.head = last.counts.total;
    month.workers = last.workers;
    month.closingCash = last.closingCash;
    month.payables = payablesOf(last);
    month.storeValue = last.storeValue;
    month.netWorth = netWorthAtCost({
      cash: last.closingCash,
      storeValue: last.storeValue,
      payables: payablesOf(last),
      balances: accounting.closing,
    });
  }

  // The two statements, each totalled from its own book. On the 1.x engine they
  // come out the same, because every cost there is paid the day it is incurred;
  // on 2.0 with accrual accounting they do not, and neither is wrong.
  month.revenue = incomeOf(totals);
  month.totalCost = expensesOf(totals);
  month.cashIn = incomeOf(cashTotals);
  month.cashOut = expensesOf(cashTotals);
  month.netCashFlow = month.cashIn - month.cashOut;
  return month;
}

/** Rolls consecutive months up into plan years, for the zoomed-out view. */
export function summariseYears(months: MonthlyProjection[], start: Date): PeriodSummary[] {
  const years: PeriodSummary[] = [];
  for (let first = 0; first < months.length; first += 12) {
    const slice = months.slice(first, first + 12);
    if (slice.length === 0) break;
    const totals = emptyTotals();
    const cashTotals = emptyTotals();
    for (const month of slice) {
      addTotals(totals, month.totals);
      addTotals(cashTotals, month.cashTotals);
    }
    const last = slice.at(-1)!;
    const yearIndex = first / 12;
    years.push({
      key: "year-" + (yearIndex + 1),
      label: "Year " + (yearIndex + 1),
      startDate: slice[0].date,
      endDate: format(addMonths(start, first + slice.length), "yyyy-MM-dd"),
      months: slice.map((month) => month.index),
      totals,
      cashTotals,
      revenue: incomeOf(totals),
      totalCost: expensesOf(totals),
      cashIn: incomeOf(cashTotals),
      cashOut: expensesOf(cashTotals),
      netCashFlow: incomeOf(cashTotals) - expensesOf(cashTotals),
      closingCash: last.closingCash,
      payables: last.payables,
      storeValue: last.storeValue,
      netWorth: last.netWorth,
      pigsSold: slice.reduce((sum, month) => sum + month.pigsSold, 0),
      bornAlive: slice.reduce((sum, month) => sum + month.bornAlive, 0),
      weaned: slice.reduce((sum, month) => sum + month.weaned, 0),
      giltsSold: slice.reduce((sum, month) => sum + month.giltsSold, 0),
      sows: last.sows,
      accounting: mergeAccounting(slice.map((month) => month.accounting)),
    });
  }
  return years;
}

/**
 * Runs the herd simulation over the planning horizon and rolls the daily record
 * up into the monthly cashflow the plan is read from.
 *
 * Which engine runs it is the plan's own choice. 1.x is the default and the
 * established answer; 2.0 is the engine being built alongside it, and is read
 * against 1.x rather than instead of it — see `lib/engine/parity`.
 */
export function calculateProjection(input: PlannerConfig): ProjectionResult {
  // No day-by-day readings: a cashflow never asks what was standing here on a
  // Tuesday, and the comparison tool projects a dozen plans one after another.
  return simulatePlan(input, { snapshots: false }).projection;
}

/** The handful of lifetime figures the warnings actually read. */
export type WarnableRun = {
  servicesMissedForBoarCapacity: number;
  servicesMissedForGenetics: number;
  servicesAttempted: number;
  aiServices: number;
  /** Of those, the ones semen stood in for a boar the farm could not give her. */
  aiFallbackServices?: number;
  aiCost: number;
  /** 2.0 only; a 1.x run reports zero for all of them. */
  movementsBlocked?: number;
  animalDaysOverCapacity?: number;
  heatsMissed?: number;
  heatsUndetected?: number;
  feedShortfallKg?: number;
  emergencyOrders?: number;
};

/** The date a day index falls on, for a warning that names a morning. */
function dayDate(config: PlannerConfig, day: number): string {
  const start = parseISO(config.project.startDate);
  if (Number.isNaN(start.getTime())) return "day " + day;
  return format(addDays(start, Math.max(0, day)), "d MMM yyyy");
}

export function buildWarnings(
  config: PlannerConfig,
  summary: ProjectionSummary,
  run: WarnableRun,
  /** What the farm could not house, on a plan that has pens to run short of. */
  shortage?: HousingShortageSummary | null,
): ModelWarning[] {
  const warnings: ModelWarning[] = [];

  if (summary.peakFundingNeed > 0) {
    warnings.push({
      level: "attention",
      title: "Additional funding is required",
      detail:
        "The lowest projected cash balance is below zero. Plan at least the calculated funding gap plus a liquidity buffer.",
    });
  }
  // Ahead of the rest because it is the one thing on this list the farm could
  // not do rather than something about the numbers it did it with: an animal
  // stood on the place with nowhere to go.
  if (shortage && shortage.days > 0) {
    const worst = shortage.byType[0];
    const others = shortage.byType.length - 1;
    warnings.push({
      level: "attention",
      title: `Pigs had nowhere to stand on ${plural(shortage.days, "day")}`,
      detail:
        `The generated housing ran out of room. Worst was ${plural(shortage.peakHead, "head")} ` +
        `on ${dayDate(config, shortage.peakDay)}` +
        (worst === undefined
          ? ""
          : `, and ${HOUSING_LABELS[worst.housingType].toLowerCase()} were short on ` +
            `${plural(worst.days, "day")}` +
            (others > 0 ? ` (${others} other ${others === 1 ? "house" : "houses"} too)` : "")) +
        ". Open the day in the simulator to see which pens were full, and regenerate the housing " +
        "if the herd has outgrown what was drawn for it.",
    });
  }
  if (config.finance.initialCapitalCosts === 0) {
    // The funding figure is read as the cost of the project, and on a plan that
    // costs no capital works it is nothing of the kind: the model carries
    // housing as a limit on herd size rather than as an asset, so a piggery
    // with no sheds, water or power in it still simulates perfectly happily.
    warnings.push({
      level: "attention",
      title: "No capital cost has been entered",
      detail:
        "The funding requirement this plan reports is working capital only. Housing, land, water and borehole, electrical reticulation, feed handling, effluent works, vehicles, professional fees and finance charges are not modelled and are not in it. Enter them as the initial capital cost, or add them to the funding figure by hand before presenting it as a project cost.",
    });
  }
  // Read off the detailed groups when the plan has them, so that a warning
  // about having no boar is about the boars the farm will actually start with.
  const opening = openingCounts(config);
  const breedingFemales = opening.sow + opening.gilt;
  if (breedingFemales > 0 && opening.boar === 0 && !config.service.useAi) {
    warnings.push({
      level: "attention",
      title: "No boar on the farm",
      detail:
        "Sows cannot be served, so the simulation produces no litters. Add a boar, or turn on artificial insemination.",
    });
  } else if (run.servicesMissedForBoarCapacity > 0) {
    warnings.push({
      level: "attention",
      title: "Boar capacity is holding sows back",
      detail:
        run.servicesMissedForBoarCapacity +
        " services were deferred because every boar was already working. Add boars or use artificial insemination.",
    });
  }
  if (breedingFemales > 0 && config.service.useAi && opening.boar === 0) {
    warnings.push({
      level: "info",
      title: "No boar on the farm to find heats",
      detail:
        "Every service is by AI, which the plan costs correctly, but it assumes heats are spotted. A unit running AI with no boar for detection usually loses services rather than money, which this plan will not show you.",
    });
  }
  if (run.aiServices > 0) {
    // A plan can put 0% of its services to semen and still buy doses, because
    // semen is also what the farm reaches for when it has no boar to give a
    // female — every boar worked out for the week, or every boar standing
    // already behind her. Reporting one total for both left a farm reading
    // "AI share 0%" beside an invoice for seventy-five doses.
    const fallback = run.aiFallbackServices ?? 0;
    const byPolicy = run.aiServices - fallback;
    warnings.push({
      level: "info",
      title: fallback > 0 ? "Semen is standing in for a boar" : "Part of the herd is served by AI",
      detail:
        run.aiServices +
        " of " +
        run.servicesAttempted +
        " services were by bought-in semen, at " +
        Math.round(run.aiCost) +
        " " +
        config.project.currency +
        ". " +
        (fallback > 0
          ? fallback +
            " of them were not a choice of policy: the farm had no unrelated boar free that day, so it bought a dose rather than lose the heat" +
            (byPolicy > 0
              ? ", and " + byPolicy + " were the " + config.service.aiSharePct + "% put to semen by plan."
              : ". The AI share is set to " +
                config.service.aiSharePct +
                "%, so every one of these doses was a substitute for a boar the farm did not have.") +
            " Standing another boar is the alternative, and on this herd it is the cheaper one to compare against."
          : "Set against that, the farm stands fewer boars to buy, feed and rotate."),
    });
  }
  const orphanPiglets = orphanStartingPiglets(config);
  if (orphanPiglets > 0) {
    warnings.push({
      level: "attention",
      title: "The starting piglets have no sow to suckle them",
      detail:
        orphanPiglets +
        " piglets were entered as starting stock, but not one starting sow is in the " +
        "farrowing house on day one. Milk is fed through the sow, so they are taken as " +
        "just weaned instead — standing in the weaner house from day one at the weight " +
        "their age gives them. A herd started staggered rather than synchronised is " +
        "spread through the cycle, and some of it is suckling when the plan opens.",
    });
  }
  if (opening.sow > config.herd.maxSows) {
    warnings.push({
      level: "attention",
      title: "The starting herd is over capacity",
      detail:
        "You start with " +
        opening.sow +
        " sows but only " +
        config.herd.maxSows +
        " places. The herd will shrink to capacity as sows are culled, and no gilts are retained until it does.",
    });
  }
  if (summary.finalSows < config.herd.maxSows * 0.9 && config.herd.retainHomeBredGilts) {
    // Ending below capacity and never reaching it are different farms, and the
    // warning used to say the second whenever it saw the first — which put it
    // in flat contradiction with the herd plan's own milestone for a herd that
    // filled its places and was then drawn down by culling and mortality.
    const reached = summary.sowCapacityReachedMonth;
    warnings.push({
      level: "info",
      title: reached
        ? "The herd ends below the sow places it reached"
        : "The herd has not reached its sow places",
      detail: reached
        ? "It first stood its full " +
          config.herd.maxSows +
          " sows in " +
          reached +
          " and peaked at " +
          summary.peakSows +
          ", but ends the plan at " +
          summary.finalSows +
          ". Culling and sow mortality are taking females out faster than replacements are coming through; check the cull parity and whether enough gilts are being retained."
        : "It ends the plan at " +
          summary.finalSows +
          " of " +
          config.herd.maxSows +
          " sows, having peaked at " +
          summary.peakSows +
          ". Home-bred gilts take about " +
          Math.round(config.herd.giltServiceAgeDays / 30.4) +
          " months to reach service, so a longer horizon or bought-in gilts would fill the places sooner.",
    });
  }
  if (!config.herd.retainHomeBredGilts && !config.herd.buyGiltsWhenShort) {
    warnings.push({
      level: "attention",
      title: "No replacement gilts are coming through",
      detail:
        "Culled and dead sows are never replaced, so the breeding herd shrinks to nothing. Retain home-bred gilts, buy them in, or both.",
    });
  }
  if (run.servicesMissedForGenetics > 0) {
    warnings.push({
      level: "info",
      title: "Females were held over to avoid mating them to their own line",
      detail:
        run.servicesMissedForGenetics +
        " services waited a day or so for an unrelated mate. No female is served by her own sire or her maternal grandsire, so this is the herd turning over its genetics rather than a shortage.",
    });
  }
  if (config.reproduction.preWeanMortalityPct > 15) {
    warnings.push({
      level: "attention",
      title: "Pre-weaning mortality is high",
      detail:
        "Review farrowing supervision, colostrum intake, crushing risk, temperature and herd health with your veterinarian.",
    });
  }
  const finisherFcr = growoutFeedConversion(config.growth).finisherFcr;
  if (finisherFcr < 2.2 || finisherFcr > 4) {
    warnings.push({
      level: "attention",
      title: "Finisher FCR is outside the usual planning range",
      detail:
        "The feed curve works out at " +
        finisherFcr.toFixed(2) +
        " feed to gain through the finishing house. Check the upkeep and cost-of-gain figures, and whether the benchmark you are comparing it against covers the same liveweight range.",
    });
  }
  if (summary.feedShareOfOperatingCost < 0.45 || summary.feedShareOfOperatingCost > 0.82) {
    warnings.push({
      level: "info",
      title: "Feed share deserves a reasonableness check",
      detail:
        "Your feed share is outside a broad commercial reference range. This may be valid for your system, but verify feed prices and omitted costs.",
    });
  }
  if (config.health.vaccinations.length === 0 || config.health.vetCostPerSowMonth === 0) {
    warnings.push({
      level: "attention",
      title: "Animal-health cost is incomplete",
      detail:
        "Enter a locally agreed vaccination schedule and a routine veterinary allowance before relying on the cash result.",
    });
  }
  if ((run.movementsBlocked ?? 0) > 0) {
    warnings.push({
      level: "attention",
      title: "Housing is holding the farm back",
      detail:
        run.movementsBlocked +
        " batch movements were refused for want of a place, and the growing houses spent " +
        Math.round(run.animalDaysOverCapacity ?? 0) +
        " animal-days over their places. Crowded pigs grow more slowly and die more often, so this shows up in sale dates and in cost per kilogram before it shows up anywhere else.",
    });
  }
  if ((run.heatsMissed ?? 0) > 0) {
    warnings.push({
      level: "attention",
      title: "Standing heats are being missed",
      detail:
        run.heatsMissed +
        " heats closed without a service, " +
        (run.heatsUndetected ?? 0) +
        " of them unnoticed. Each one costs a whole cycle rather than a day, so it is felt in the farrowing interval and in litters per sow per year.",
    });
  }
  if ((run.feedShortfallKg ?? 0) > 0) {
    warnings.push({
      level: "attention",
      title: "The stores ran short",
      detail:
        Math.round(run.feedShortfallKg ?? 0) +
        " kg of feed was asked for and not available, and " +
        (run.emergencyOrders ?? 0) +
        " emergency loads were sent for at a premium. Restricted intake costs gain, which costs days, which is usually dearer than the premium was. Review the safety cover, the lead time and the bin size.",
    });
  }

  warnings.push(
    config.project.variation === "settled"
      ? {
          level: "info",
          title: "This is the settled planning case",
          detail:
            "Rates are carried into whole-animal outcomes without random draws. This gives one clean comparison answer, but it does not show the downside of a bad biological year; use Chance mode and its seed band for risk.",
        }
      : {
          level: "info",
          title: "This is one run of many possible farms",
          detail:
            "Litter size, conception, gestation and growth are drawn from this scenario seed. Mortality is placed at the rates entered. Compare plans over matched seeds before treating a small difference as meaningful.",
        },
  );

  return warnings;
}

export function projectionToCsv(result: ProjectionResult) {
  const header = [
    "Month",
    "Farrowings",
    "Born alive",
    "Weaned",
    "Pigs sold",
    "Sale liveweight kg",
    "Sale deadweight kg",
    "Gilts selected",
    "Gilts to the herd",
    "Gilts sold",
    "Deaths",
    "Sows",
    "Gilts",
    "Piglets",
    "Weaners",
    "Growers",
    "Finishers",
    "Stockpeople",
    // Every ledger line, in the ledger order the values below are built in, so
    // a line added to the ledger is a column here rather than a silent shift.
    // Each appears twice — once earned or consumed, once received or paid —
    // because on the 2.0 engine those are two different months' worth of money.
    ...INCOME_CATEGORIES.map((category) => CATEGORY_LABELS[category]),
    ...EXPENSE_CATEGORIES.map((category) => CATEGORY_LABELS[category]),
    ...INCOME_CATEGORIES.map((category) => CATEGORY_LABELS[category] + " (cash)"),
    ...EXPENSE_CATEGORIES.map((category) => CATEGORY_LABELS[category] + " (cash)"),
    "Lorries in",
    "Total cost",
    "Cash in",
    "Cash out",
    "Net cash flow",
    "Closing cash",
    "Owed to suppliers",
  ];
  const rows = result.months.map((row) => [
    row.date,
    row.farrowings,
    row.bornAlive,
    row.weaned,
    row.pigsSold,
    row.saleLiveweightKg,
    row.saleDeadweightKg,
    row.giltsSelected,
    row.giltsPromoted,
    row.giltsSold,
    row.deaths,
    row.sows,
    row.gilts,
    row.piglets,
    row.weaners,
    row.growers,
    row.finishers,
    row.workers,
    ...INCOME_CATEGORIES.map((category) => row.totals[category]),
    ...EXPENSE_CATEGORIES.map((category) => row.totals[category]),
    ...INCOME_CATEGORIES.map((category) => row.cashTotals[category]),
    ...EXPENSE_CATEGORIES.map((category) => row.cashTotals[category]),
    row.lorriesIn,
    row.totalCost,
    row.cashIn,
    row.cashOut,
    row.netCashFlow,
    row.closingCash,
    row.payables,
  ]);
  return [header, ...rows]
    .map((row) => row.map((cell) => (typeof cell === "string" ? '"' + cell + '"' : cell)).join(","))
    .join("\n");
}
