import { addMonths, format, parseISO } from "date-fns";

import { ESTRUS_CYCLE_DAYS, plannerSchema, type PlannerConfig } from "./config";
import { growoutFeedConversion } from "./growth-curve";
import {
  addTotals,
  CATEGORY_LABELS,
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  emptyTotals,
  expensesOf,
  Farm,
  horizonDay,
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
  breedingStock: number;
  /**
   * The most head the farm carried on any one day of the month — every pig on
   * the place, breeding stock included. Month-end counts miss a batch that
   * arrived and went inside the month, and it is the peak that has to be housed.
   */
  peakHead: number;
  /** Stockpeople the herd needs at the end of the month. */
  workers: number;
  sowFeedKg: number;
  growingFeedKg: number;
  /** Loads of feed hauled in this month, and what they carried. */
  feedLoads: number;
  feedDeliveredKg: number;
  /** Every income and cost line for the month, by ledger category. */
  totals: CategoryTotals;
  revenue: number;
  totalCost: number;
  netCashFlow: number;
  closingCash: number;
};

export type PeriodSummary = {
  key: string;
  label: string;
  startDate: string;
  endDate: string;
  months: number[];
  totals: CategoryTotals;
  revenue: number;
  totalCost: number;
  netCashFlow: number;
  closingCash: number;
  pigsSold: number;
  bornAlive: number;
  weaned: number;
  giltsSold: number;
  sows: number;
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
  /** The most head the farm ever carries at once over the whole horizon. */
  peakHeadCount: number;
  firstPositiveMonth: string | null;
  herdValueAtEnd: number;
  netWorthAtEnd: number;
};

export type ProjectionResult = {
  months: MonthlyProjection[];
  years: PeriodSummary[];
  summary: ProjectionSummary;
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

function summariseMonth(index: number, date: Date, days: DayRecord[]): MonthlyProjection {
  const totals = emptyTotals();
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
    breedingStock: 0,
    peakHead: 0,
    workers: 0,
    sowFeedKg: 0,
    growingFeedKg: 0,
    feedLoads: 0,
    feedDeliveredKg: 0,
    totals,
    revenue: 0,
    totalCost: 0,
    netCashFlow: 0,
    closingCash: 0,
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
    month.sowFeedKg += day.sowFeedKg;
    month.growingFeedKg += day.growingFeedKg;
    month.feedLoads += day.feedLoads;
    month.feedDeliveredKg += day.feedDeliveredKg;
    month.peakHead = Math.max(month.peakHead, day.counts.total);
    addTotals(totals, day.totals);
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
    month.breedingStock = last.counts.sows + last.counts.boars;
    month.workers = last.workers;
    month.closingCash = last.closingCash;
  }

  month.revenue = incomeOf(totals);
  month.totalCost = expensesOf(totals);
  month.netCashFlow = month.revenue - month.totalCost;
  return month;
}

/** Rolls consecutive months up into plan years, for the zoomed-out view. */
function summariseYears(months: MonthlyProjection[], start: Date): PeriodSummary[] {
  const years: PeriodSummary[] = [];
  for (let first = 0; first < months.length; first += 12) {
    const slice = months.slice(first, first + 12);
    if (slice.length === 0) break;
    const totals = emptyTotals();
    for (const month of slice) addTotals(totals, month.totals);
    const last = slice.at(-1)!;
    const yearIndex = first / 12;
    years.push({
      key: "year-" + (yearIndex + 1),
      label: "Year " + (yearIndex + 1),
      startDate: slice[0].date,
      endDate: format(addMonths(start, first + slice.length), "yyyy-MM-dd"),
      months: slice.map((month) => month.index),
      totals,
      revenue: incomeOf(totals),
      totalCost: expensesOf(totals),
      netCashFlow: incomeOf(totals) - expensesOf(totals),
      closingCash: last.closingCash,
      pigsSold: slice.reduce((sum, month) => sum + month.pigsSold, 0),
      bornAlive: slice.reduce((sum, month) => sum + month.bornAlive, 0),
      weaned: slice.reduce((sum, month) => sum + month.weaned, 0),
      giltsSold: slice.reduce((sum, month) => sum + month.giltsSold, 0),
      sows: last.sows,
    });
  }
  return years;
}

/**
 * Runs the herd simulation over the planning horizon and rolls the daily record
 * up into the monthly cashflow the plan is read from.
 */
export function calculateProjection(input: PlannerConfig): ProjectionResult {
  const config = plannerSchema.parse(input);
  const farm = new Farm(config);
  farm.advanceTo(horizonDay(config));

  const start = parseISO(config.project.startDate);
  const byDay = new Map(farm.history.map((day) => [day.day, day]));
  const months: MonthlyProjection[] = [];

  for (let index = 0; index < config.project.months; index += 1) {
    const monthStart = addMonths(start, index);
    const firstDay = farm.dayOf(monthStart);
    const lastDay = farm.dayOf(addMonths(start, index + 1)) - 1;
    const days: DayRecord[] = [];
    for (let day = firstDay; day <= lastDay; day += 1) {
      const record = byDay.get(day);
      if (record) days.push(record);
    }
    months.push(summariseMonth(index, monthStart, days));
  }

  const state = farm.state();
  const sum = (pick: (month: MonthlyProjection) => number) =>
    months.reduce((total, month) => total + pick(month), 0);

  const totalCost = sum((month) => month.totalCost);
  // Every store's goods plus the trips that brought them: what the farm spends
  // to keep something in front of the animals.
  const totalFeedCost = sum(
    (month) =>
      month.totals["feed-sow"] +
      month.totals["feed-creep"] +
      month.totals["feed-weaner"] +
      month.totals["feed-grower"] +
      month.totals["feed-finisher"] +
      month.totals.deliveries,
  );
  const operatingCostExcludingCapital = totalCost - sum((month) => month.totals.capital);
  const lowestCash = Math.min(
    config.project.openingCash,
    ...months.map((month) => month.closingCash),
  );
  const sowMonths = months.reduce((total, month) => total + month.sows, 0);
  const averageSows = months.length > 0 ? sowMonths / months.length : 0;
  const years = config.project.months / 12;

  const summary: ProjectionSummary = {
    totalRevenue: sum((month) => month.revenue),
    totalFeedCost,
    totalVeterinaryCost: sum((month) => month.totals.veterinary + month.totals.vaccination),
    totalCost,
    totalPigsSold: sum((month) => month.pigsSold),
    totalBornAlive: sum((month) => month.bornAlive),
    totalWeaned: sum((month) => month.weaned),
    totalDeaths: sum((month) => month.deaths),
    closingCash: months.at(-1)?.closingCash ?? config.project.openingCash,
    lowestCash,
    peakFundingNeed: Math.max(0, -lowestCash),
    feedShareOfOperatingCost:
      operatingCostExcludingCapital > 0 ? totalFeedCost / operatingCostExcludingCapital : 0,
    pigsWeanedPerSowYear:
      averageSows > 0 && years > 0 ? farm.lifetime.weaned / (averageSows * years) : 0,
    littersPerSowYear:
      averageSows > 0 && years > 0 ? farm.lifetime.litters / (averageSows * years) : 0,
    averageSows,
    finalSows: months.at(-1)?.sows ?? 0,
    peakHeadCount: Math.max(0, ...months.map((month) => month.peakHead)),
    firstPositiveMonth:
      months.find((month) => month.closingCash >= 0 && month.index > 0)?.month ?? null,
    herdValueAtEnd: state.finance.herdValue,
    netWorthAtEnd: state.finance.netWorth,
  };

  return {
    months,
    years: summariseYears(months, start),
    summary,
    generations: state.generations,
    costOfProduction: state.costOfProduction,
    warnings: buildWarnings(config, summary, farm),
  };
}

function buildWarnings(
  config: PlannerConfig,
  summary: ProjectionSummary,
  farm: Farm,
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
  const breedingFemales = config.stock.sows + config.stock.gilts;
  if (breedingFemales > 0 && config.stock.boars === 0 && !config.service.useAi) {
    warnings.push({
      level: "attention",
      title: "No boar on the farm",
      detail:
        "Sows cannot be served, so the simulation produces no litters. Add a boar, or turn on artificial insemination.",
    });
  } else if (farm.lifetime.servicesMissedForBoarCapacity > 0) {
    warnings.push({
      level: "attention",
      title: "Boar capacity is holding sows back",
      detail:
        farm.lifetime.servicesMissedForBoarCapacity +
        " services were deferred because every boar was already working. Add boars or use artificial insemination.",
    });
  }
  if (breedingFemales > 0 && config.service.useAi && config.stock.boars === 0) {
    warnings.push({
      level: "info",
      title: "No boar on the farm to find heats",
      detail:
        "Every service is by AI, which the plan costs correctly, but it assumes heats are spotted. A unit running AI with no boar for detection usually loses services rather than money, which this plan will not show you.",
    });
  }
  if (farm.lifetime.aiServices > 0) {
    warnings.push({
      level: "info",
      title: "Part of the herd is served by AI",
      detail:
        farm.lifetime.aiServices +
        " of " +
        farm.lifetime.servicesAttempted +
        " services were by bought-in semen, at " +
        Math.round(farm.lifetime.aiCost) +
        " " +
        config.project.currency +
        ". Set against that, the farm stands fewer boars to buy, feed and rotate.",
    });
  }
  if (config.stock.sows > config.herd.maxSows) {
    warnings.push({
      level: "attention",
      title: "The starting herd is over capacity",
      detail:
        "You start with " +
        config.stock.sows +
        " sows but only " +
        config.herd.maxSows +
        " places. The herd will shrink to capacity as sows are culled, and no gilts are retained until it does.",
    });
  }
  if (summary.finalSows < config.herd.maxSows * 0.9 && config.herd.retainHomeBredGilts) {
    warnings.push({
      level: "info",
      title: "The herd has not reached its sow places",
      detail:
        "It ends the plan at " +
        summary.finalSows +
        " of " +
        config.herd.maxSows +
        " sows. Home-bred gilts take about " +
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
  if (farm.lifetime.servicesMissedForGenetics > 0) {
    warnings.push({
      level: "info",
      title: "Females were held over to avoid mating them to their own line",
      detail:
        farm.lifetime.servicesMissedForGenetics +
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
    ...INCOME_CATEGORIES.map((category) => CATEGORY_LABELS[category]),
    ...EXPENSE_CATEGORIES.map((category) => CATEGORY_LABELS[category]),
    "Feed loads",
    "Total cost",
    "Net cash flow",
    "Closing cash",
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
    row.feedLoads,
    row.totalCost,
    row.netCashFlow,
    row.closingCash,
  ]);
  return [header, ...rows]
    .map((row) => row.map((cell) => (typeof cell === "string" ? '"' + cell + '"' : cell)).join(","))
    .join("\n");
}
