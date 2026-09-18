import { addMonths, format } from "date-fns";

import type { FarmEvent, FarmEventType, FarmState } from "../sim/farm";
import { cashTotalsOf, expensesOf, incomeOf } from "../sim/ledger";
import { sowRosterOf, stockRosterOf } from "../sim/roster";
import type { DomainEvent, EventType } from "./events";
import type { Engine } from "./engine";

/**
 * The 2.0 engine read the way the product reads a farm.
 *
 * The engine keeps more than the 1.x farm does and keeps it differently — a
 * world of systems, and events with causes and postings rather than sentences.
 * None of that is any use to the simulator panel, the timeline or the event-log
 * export, which want one shape and should not know which engine produced it.
 * That is the point of this file: everything the pages read comes out of one
 * entry point, so a plan set to 2.0 is a 2.0 plan everywhere rather than on the
 * cashflow page alone.
 */

/**
 * Which kind of line each domain event is, for a log a person reads or filters.
 *
 * The 2.0 vocabulary is finer than the 1.x one, so this is a widening: several
 * domain events land on the same word. Nothing is lost by it — the event itself
 * still carries its cause, its entities and its postings, and this only decides
 * which column of a spreadsheet it sorts under.
 */
const EVENT_KINDS: Record<EventType, FarmEventType> = {
  MonthOpened: "funding",
  OverheadsPosted: "funding",
  FinancingPosted: "funding",
  ContingencyPosted: "funding",

  EstrusExpected: "service",
  EstrusDetected: "service",
  EstrusMissed: "service",
  ServiceAttempted: "service",
  ServiceCompleted: "service",
  ServiceOpportunityMissed: "service",
  ReturnToEstrus: "return",
  PregnancyScanned: "scan",
  FarrowingCompleted: "farrowing",
  WeaningCompleted: "weaning",

  MovementRequested: "capacity",
  MovementCompleted: "capacity",
  MovementBlocked: "capacity",
  BatchSplit: "capacity",
  SaleHeldForSpace: "capacity",
  RoomOverCapacity: "capacity",
  CrowdingDeathsScheduled: "capacity",
  WeanedEarlyForSpace: "capacity",

  OrderPlaced: "purchase",
  DeliveryReceived: "purchase",
  InvoiceRaised: "purchase",
  InvoicePaid: "purchase",
  StoreRanShort: "purchase",
  IntakeRestricted: "purchase",

  PigletsBorn: "farrowing",
  GiltSelected: "selection",
  GiltPromoted: "promotion",
  GiltSold: "sale",
  PigsSold: "sale",
  PigDied: "death",
  SowCulled: "cull",
  BoarRotated: "purchase",
  StockPurchased: "purchase",
  ProcessingDone: "processing",
};

/** One domain event as a line in the log a person reads. */
export function asFarmEvent(event: DomainEvent): FarmEvent {
  return {
    day: event.day,
    date: event.date,
    type: EVENT_KINDS[event.type],
    // The cause is the half of a 2.0 event the 1.x log never had, and it is the
    // half worth reading: "37 pigs held back" says what happened, "the finisher
    // house is full at 20 places" says why the plan did it.
    message: event.cause ? event.message + " — " + event.cause : event.message,
  };
}

export function engineEventLog(events: readonly DomainEvent[]): FarmEvent[] {
  return events.map(asFarmEvent);
}

/**
 * What is standing on the farm at the day the engine has run to, in the shape
 * the simulator panel reads.
 */
export function engineState(engine: Engine, timestamp?: string): FarmState {
  const world = engine.world;
  const config = engine.config;
  const day = world.day;
  const date = format(world.dateOf(Math.max(day, 0)), "yyyy-MM-dd");
  const valuation = engine.valuation();

  // The cash view rather than the accrued one: this panel is headed money in and
  // money out, and under accrual accounting those are not the same numbers as
  // the profit and loss.
  const last30Days = { income: 0, expenses: 0, net: 0 };
  for (const record of world.history.slice(-30)) {
    const totals = cashTotalsOf(record);
    last30Days.income += incomeOf(totals);
    last30Days.expenses += expensesOf(totals);
  }
  last30Days.net = last30Days.income - last30Days.expenses;

  const events = engineEventLog(world.log.events);

  return {
    day,
    date,
    timestamp: timestamp ?? date + "T00:00",
    withinHorizon:
      day >= 0 && day < world.dayOf(addMonths(world.start, config.project.months)),
    herd: {
      ...world.countHerd(),
      liveweightKg: valuation.liveweightKg,
      maxSows: config.herd.maxSows,
      averageWeightKg: valuation.averageWeightKg,
    },
    finance: {
      openingCash: world.ledger.openingCash,
      cash: world.ledger.cash,
      income: world.ledger.income,
      expenses: world.ledger.expenses,
      herdValue: valuation.herdValue,
      storeValue: valuation.storeValue,
      // Unlike the 1.x farm, this one can owe for feed it has already taken in,
      // and what it owes is subtracted here. A delivery on terms is not a gain.
      netWorth: valuation.netWorth,
      totals: { ...world.ledger.totals },
      last30Days,
    },
    stores: engine.storeLevels(),
    lifetime: { ...world.lifetime },
    generations: engine.generationReport(),
    costOfProduction: engine.costOfProduction(),
    stock: stockRosterOf(world.sows, world.boars, world.pigs, day),
    sows: sowRosterOf(world.sows, day),
    recentEvents: events.slice(-12).reverse(),
  };
}
