import { addMonths, differenceInCalendarDays, format, parseISO } from "date-fns";

import { deadweightKg, plannerSchema, type PlannerConfig } from "../config";
import {
  COST_STAGES,
  COST_TYPES,
  type CostStage,
  type CostType,
  type PigStage,
} from "../sim/animals";
import {
  chargeDepreciation,
  farmValuation,
  herdValuesAtCost,
  readBalances,
  type FarmValuation,
  type StageValues,
} from "../sim/accounting";
import { EMPTY_HAULAGE, type HaulagePlan } from "../sim/haulage";
import { feedPlanFor, type CostOfProduction, type GenerationRow, type StoreLevel } from "../sim/farm";
import { FEED_RATIONS } from "../sim/animals";
import { countEngineBuilt } from "../sim/instrument";
import { variationFor } from "../sim/variation";
import type { DomainEvent } from "./events";
import type { RoomLevel } from "./housing";
import { runCalendar, runFinancing } from "./systems/calendar";
import { runGrowthAndSales, runMarketSales, runSelection } from "./systems/growth";
import { runHerd } from "./systems/herd";
import { runHealth } from "./systems/health";
import { runCrowdingStress, runHousingCensus } from "./systems/housing";
import { runMortality } from "./systems/mortality";
import { runNutrition } from "./systems/nutrition";
import { runProcurement } from "./systems/procurement";
import { runReproduction } from "./systems/reproduction";
import { forecastDemand } from "./planning/forecast";
import type { ProcurementPolicy } from "./planning/procurement";
import { seedHerd } from "./seed";
import {
  LEGACY_POLICIES,
  World,
  emptyDayRecord,
  policiesFor,
  type EngineDayRecord,
  type EngineLifetime,
  type Policies,
  type StageCounts,
} from "./world";

/**
 * The 2.0 engine.
 *
 * A day is an explicit, ordered list of systems rather than one procedure. The
 * order is part of the model and is tested as such: the rooms are counted before
 * anything moves between them. In operational 2.0, the market draw uses opening
 * liveweight before procurement or feeding: a cohort already at target leaves
 * before another finishing ration is bought or issued, while one that only
 * reaches target after today's gain leaves tomorrow. Replacement selection stays
 * in its historical post-nutrition position, so a cohort already committed to
 * slaughter does not get one extra morning to be drafted into the breeding
 * pipeline. The legacy/perfect-foresight sale timing remains unchanged for parity.
 *
 * Every 2.0 subsystem is behind a switch. With all of them down this is meant to
 * reproduce the 1.x farm exactly, and {@link ../engine-parity} proves it does —
 * which is the whole reason the switches exist. A number that moves when you
 * turn one on is then that subsystem's doing, and not a porting mistake.
 */

/**
 * The operational 2.0 phases, in order. The legacy parity path deliberately
 * keeps selection and sale in their historical later positions.
 */
export const PHASES = [
  "calendar",
  "housing-census",
  "market-sales",
  "procurement",
  "reproduction",
  "nutrition",
  "selection",
  "growth-and-sales",
  "health",
  "mortality",
  "herd",
  "accounting",
] as const;

export type Phase = (typeof PHASES)[number];

const MAX_EVENTS = 400;
const LITTER_SIZE_DEVIATION = 2.6;
const GESTATION_DEVIATION_DAYS = 1.4;
const WEAN_TO_SERVICE_DEVIATION_DAYS = 2.5;

export type EngineOptions = {
  /** Overrides the switches the config would give, for parity runs and tests. */
  policies?: Partial<Policies>;
  /** Keeps the whole event log rather than the tail of it. */
  keepEveryEvent?: boolean;
  /** A haulage plan worked out elsewhere, so a probe run does not recurse. */
  haulage?: HaulagePlan;
  /**
   * A procurement policy built elsewhere, in place of the one the config names.
   * The tuning bench uses it to run the same policy at different settings
   * without inventing configuration a farm would then be asked to fill in.
   */
  procurement?: ProcurementPolicy;
};

export class Engine {
  readonly world: World;
  readonly config: PlannerConfig;

  constructor(input: PlannerConfig, options: EngineOptions = {}) {
    countEngineBuilt();
    this.config = plannerSchema.parse(input);
    const policies: Policies = { ...policiesFor(this.config), ...options.policies };
    // Perfect-foresight procurement needs to know what the herd will eat, which
    // takes a run of its own. Operational procurement needs nothing of the kind,
    // which is one of the things it is cheaper at.
    const haulage =
      options.haulage ??
      (policies.operationalProcurement ? EMPTY_HAULAGE : feedPlanFor(this.config));

    this.world = new World({
      config: this.config,
      policies,
      variation: variationFor(this.config.project.variation, this.config.project.seed, {
        litter: LITTER_SIZE_DEVIATION,
        gestation: GESTATION_DEVIATION_DAYS,
        weanToService: WEAN_TO_SERVICE_DEVIATION_DAYS,
      }),
      haulage,
      eventLimit: options.keepEveryEvent === true ? Infinity : MAX_EVENTS,
      procurement: options.procurement,
    });

    seedHerd(this.world);
    // A farm does not open its gates with empty bins. The opening order is sized
    // off what the stock actually standing here wants today, which is a thing
    // the farm can see by looking at it rather than a forecast of the horizon.
    this.world.supplies.openStores(0, openingDemand(this.world));
  }

  get day(): number {
    return this.world.day;
  }

  get history(): EngineDayRecord[] {
    return this.world.history;
  }

  get lifetime(): EngineLifetime {
    return this.world.lifetime;
  }

  get events(): DomainEvent[] {
    return this.world.log.events;
  }

  get policies(): Policies {
    return this.world.policies;
  }

  advanceTo(targetDay: number): this {
    while (this.world.day < targetDay) this.step(this.world.day + 1);
    return this;
  }

  /** One day, phase by phase. */
  step(day: number): void {
    const world = this.world;
    world.day = day;
    const date = format(world.dateOf(day), "yyyy-MM-dd");
    world.record = emptyDayRecord(day, date);

    runCalendar(world);
    runHousingCensus(world);
    if (world.policies.operationalProcurement) {
      // A cohort already at target is committed to today's market draw. Remove
      // it before procurement sees feed demand and before selection can reopen
      // the decision by drafting one of its females into the breeding pipeline.
      runMarketSales(world);
    }
    runProcurement(world);
    runReproduction(world);
    runNutrition(world);
    runSelection(world);
    runGrowthAndSales(world);
    runCrowdingStress(world);
    runHealth(world);
    runMortality(world);
    runHerd(world);
    this.closeBooks(day, date);
  }

  /** The accounting phase: contingency, financing, and the day's two statements. */
  private closeBooks(day: number, date: string): void {
    const world = this.world;
    const { ledger, config } = world;

    ledger.accrue(
      "contingency",
      ledger.pendingOperatingCost() * (config.finance.contingencyPct / 100),
    );
    runFinancing(world);

    world.pigs = world.pigs.filter((pig) => pig.alive);
    world.sows = world.sows.filter((sow) => sow.alive);
    world.boars = world.boars.filter((boar) => boar.alive);

    // The breeding herd is written down for the day it has just worked, and
    // then the second set of books is sealed against the herd as it now stands.
    chargeDepreciation(world, day, config, world.books);
    world.record.storeValue = world.supplies.storeValue;
    world.record.accounting = world.books.close(
      readBalances(world, world.supplies.haulageInStore),
    );

    const closed = ledger.closeDay(day, date);
    const record = world.record;
    record.totals = closed.totals;
    record.cashTotals = closed.cashTotals;
    record.netCashFlow = closed.netCashFlow;
    record.closingCash = closed.closingCash;
    record.payables = world.supplies.payables;
    record.counts = world.countHerd();
    record.workers = world.workersOnPayroll;
    world.history.push(record);
  }

  // ------------------------------------------------------------------ read-out

  /** How the generations on the farm stack up, including the ones that overlap. */
  generationReport(): GenerationRow[] {
    const world = this.world;
    const rows = new Map<number, GenerationRow>();
    const row = (generation: number) => {
      let existing = rows.get(generation);
      if (!existing) {
        existing = { generation, born: 0, alive: 0, breedingFemales: 0, sold: 0, died: 0 };
        rows.set(generation, existing);
      }
      return existing;
    };
    for (const [generation, stats] of world.generationStats) {
      const entry = row(generation);
      entry.born = stats.born;
      entry.sold = stats.sold;
      entry.died = stats.died;
    }
    for (const pig of world.pigs) if (pig.alive) row(pig.generation).alive += 1;
    for (const sow of world.sows) {
      if (!sow.alive) continue;
      const entry = row(sow.generation);
      entry.alive += 1;
      entry.breedingFemales += 1;
    }
    for (const boar of world.boars) if (boar.alive) row(boar.generation).alive += 1;
    return [...rows.values()].sort((a, b) => a.generation - b.generation);
  }

  /** What a market pig cost by stage, and what it earned. */
  costOfProduction(): CostOfProduction {
    const world = this.world;
    const pigsSold = world.lifetime.sold;
    const directByStage = Object.fromEntries(
      COST_STAGES.map((stage) => [
        stage,
        pigsSold > 0 ? world.soldPigCosts.byStage[stage] / pigsSold : 0,
      ]),
    ) as Record<CostStage, number>;
    const directByType = Object.fromEntries(
      COST_TYPES.map((type) => [
        type,
        pigsSold > 0 ? world.soldPigCosts.byType[type] / pigsSold : 0,
      ]),
    ) as Record<CostType, number>;

    const overheads =
      world.ledger.totals.overheads -
      world.financingCosts +
      world.ledger.totals.labour +
      world.ledger.totals.contingency +
      world.ledger.totals.capital;
    const breedingNetCost =
      world.breedingCosts.total -
      world.ledger.totals["gilt-sales"] -
      world.ledger.totals["cull-sales"];
    const directPerPig = pigsSold > 0 ? world.soldPigCosts.total / pigsSold : 0;
    const breedingCostPerPig = pigsSold > 0 ? breedingNetCost / pigsSold : 0;
    const allocatedOverheadPerPig = pigsSold > 0 ? overheads / pigsSold : 0;
    const fullCostPerPig = directPerPig + breedingCostPerPig + allocatedOverheadPerPig;
    const averageSaleWeightKg = pigsSold > 0 ? world.lifetime.soldLiveweightKg / pigsSold : 0;
    const averageDeadweightKg = pigsSold > 0 ? world.lifetime.soldDeadweightKg / pigsSold : 0;
    const revenuePerPig = averageDeadweightKg * this.config.finance.salePriceKg;

    return {
      pigsSold,
      averageSaleWeightKg,
      averageDeadweightKg,
      directByStage,
      directByType,
      directPerPig,
      breedingCostPerPig,
      allocatedOverheadPerPig,
      fullCostPerPig,
      revenuePerPig,
      marginPerPig: revenuePerPig - fullCostPerPig,
      fullCostPerKg: averageSaleWeightKg > 0 ? fullCostPerPig / averageSaleWeightKg : 0,
      fullCostPerDeadweightKg:
        averageDeadweightKg > 0 ? fullCostPerPig / averageDeadweightKg : 0,
    };
  }

  /** What is standing in each store, what it is worth, and how long it will last. */
  storeLevels(): StoreLevel[] {
    const world = this.world;
    if (world.day < 0) return [];
    const rationLabel: Record<string, string> = {
      sow: "Sow & gilt feed",
      creep: "Creep feed",
      weaner: "Weaner feed",
      grower: "Grower feed",
      finisher: "Finisher feed",
    };
    const levels: StoreLevel[] = FEED_RATIONS.map((ration) => ({
      id: "feed-" + ration,
      label: rationLabel[ration],
      unit: "kg",
      quantity: world.supplies.quantity(ration),
      value: world.supplies.value(ration),
      capacity: world.supplies.capacity(ration),
      daysOfCover: world.supplies.daysOfCover(ration),
    }));
    for (const [id, label] of [
      ["gas", "Heating gas"],
      ["bedding", "Bedding"],
    ] as const) {
      levels.push({
        id,
        label,
        unit: "kg",
        quantity: world.supplies.quantity(id),
        value: world.supplies.value(id),
        capacity: world.supplies.capacity(id),
        daysOfCover: world.supplies.daysOfCover(id),
      });
    }
    return levels;
  }

  housingReport(): RoomLevel[] {
    return this.world.housingReport();
  }

  /** The herd's liveweight and what the whole place is worth, debts included. */
  valuation(): {
    liveweightKg: number;
    averageWeightKg: Record<PigStage, number>;
    valuesAtCost: StageValues;
    herdValue: number;
    storeValue: number;
    payables: number;
    netWorth: number;
    atCost: FarmValuation;
  } {
    const world = this.world;
    const counts = world.countHerd();
    const weightTotals: Record<PigStage, { sum: number; count: number }> = {
      piglet: { sum: 0, count: 0 },
      weaner: { sum: 0, count: 0 },
      grower: { sum: 0, count: 0 },
      finisher: { sum: 0, count: 0 },
      gilt: { sum: 0, count: 0 },
    };
    let liveweightKg = 0;
    for (const pig of world.pigs) {
      if (!pig.alive) continue;
      weightTotals[pig.stage].sum += pig.weightKg;
      weightTotals[pig.stage].count += 1;
      liveweightKg += pig.weightKg;
    }
    const livestock =
      deadweightKg(liveweightKg, this.config) * this.config.finance.salePriceKg +
      (counts.sows + counts.boars) * this.config.herd.cullSowSaleValue;
    const storeValue = world.day < 0 ? 0 : world.supplies.storeValue;
    const payables = world.supplies.payables;
    const average = (stage: PigStage) =>
      weightTotals[stage].count ? weightTotals[stage].sum / weightTotals[stage].count : 0;
    return {
      liveweightKg,
      averageWeightKg: {
        piglet: average("piglet"),
        weaner: average("weaner"),
        grower: average("grower"),
        finisher: average("finisher"),
        gilt: average("gilt"),
      },
      valuesAtCost: herdValuesAtCost(world),
      herdValue: livestock + storeValue,
      storeValue,
      // Feed bought on terms is cash the farm still has and money it already
      // owes. Counting the stock without the debt behind it would make every
      // delivery look like a gain.
      payables,
      netWorth: world.ledger.cash + livestock + storeValue - payables,
      // The other reading of the same farm: everything at what it cost rather
      // than at what it might fetch.
      atCost: farmValuation({
        cash: world.ledger.cash,
        feedValue: FEED_RATIONS.reduce(
          (total, ration) => total + world.supplies.value(ration),
          0,
        ),
        suppliesValue: world.supplies.value("gas") + world.supplies.value("bedding"),
        balances: world.history.at(-1)?.accounting ?? world.books.opening,
        payables,
      }),
    };
  }

  counts(): StageCounts {
    return this.world.countHerd();
  }
}

/**
 * What the herd on the farm this morning would draw on each store in a day. Used
 * once, to stock the place before the first day runs.
 */
function openingDemand(world: World): Partial<Record<string, number>> {
  const { config } = world;
  if (world.policies.operationalProcurement) {
    const cover = Math.max(1, config.feed.targetCoverDays);
    // The ordinary startup cover is deliberate here. This is only the opening-bin
    // bootstrap before day 0; ongoing replenishment is determined by vehicle
    // capacity and projected risk, not by this number.
    const forecast = forecastDemand(
      world.procurementContext(0).farm,
      config,
      cover - 1,
    );
    // openStores sizes stock as rate × cover. Supplying the average forecast
    // rate therefore opens every bin with exactly the kilograms forecast over
    // the opening cover window, including a ration whose first draw is a stage
    // transition tomorrow rather than an animal eating it today.
    return Object.fromEntries(
      Object.entries(forecast.demandKg).map(([store, series]) => [
        store,
        series.reduce((total, kg) => total + kg, 0) / cover,
      ]),
    );
  }
  const demand: Record<string, number> = {};
  const add = (store: string, kg: number) => {
    demand[store] = (demand[store] ?? 0) + kg;
  };
  for (const sow of world.sows) {
    const feed = sow.dailyFeed(config, world.day);
    add(feed.ration, feed.kg);
  }
  for (const boar of world.boars) {
    const feed = boar.dailyFeed(config);
    add(feed.ration, feed.kg);
  }
  for (const pig of world.pigs) {
    const feed = pig.dailyFeed(config);
    if (feed.kg > 0) add(feed.ration, feed.kg);
    const creep = pig.creepFeed(0, config);
    if (creep.kg > 0) add(creep.ration, creep.kg);
  }
  const { health, housing } = config;
  // Heaters need the herd in place, which it now is.
  let underHeat = 0;
  const crates = new Map<string, number>();
  for (const pig of world.pigs) {
    if (pig.ageDays(0) >= health.heatedUntilAgeDays) continue;
    underHeat += 1;
    const crate = (pig.damTag ?? "?") + "@" + pig.birthDay;
    crates.set(crate, (crates.get(crate) ?? 0) + 1);
  }
  const perLamp = Math.max(health.pigletsPerHeater, 1);
  let heaters = 0;
  for (const head of crates.values()) heaters += Math.ceil(head / perLamp);
  if (underHeat > 0 && health.gasKgPerHeaterDay > 0) {
    add("gas", heaters * health.gasKgPerHeaterDay);
  }
  add("bedding", world.countHerd().total * housing.beddingKgPerHeadDay);
  return demand;
}

/** Last day index inside the planning horizon. */
export function engineHorizonDay(config: PlannerConfig): number {
  const start = parseISO(config.project.startDate);
  return differenceInCalendarDays(addMonths(start, config.project.months), start) - 1;
}

/** Builds an engine and runs it to the given day. */
export function runEngine(
  config: PlannerConfig,
  throughDay = engineHorizonDay(config),
  options: EngineOptions = {},
): Engine {
  return new Engine(config, options).advanceTo(throughDay);
}

/** The 1.x farm, run by the 2.0 engine. Used by the parity harness. */
export function runLegacyEngine(config: PlannerConfig, throughDay?: number): Engine {
  return runEngine(config, throughDay ?? engineHorizonDay(config), {
    policies: LEGACY_POLICIES,
  });
}
