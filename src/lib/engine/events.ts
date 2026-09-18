import type { PigStage } from "../sim/animals";
import type { LedgerCategory } from "../sim/ledger";
import type { RoomId } from "./housing";

/**
 * Domain events: the 2.0 engine's record of what happened and why.
 *
 * The 1.x farm keeps a log of sentences. A sentence is good for reading and no
 * good for anything else — you cannot ask it which sale was late, or trace a
 * delayed movement back through slower gain to a feed shortage to the ordering
 * policy that caused it. So an event here carries its cause, the entities it
 * touched and the postings it made, and the sentence is written off the event
 * rather than instead of it.
 *
 * Every material occurrence is one of these. They are immutable, they are
 * ordered, and they are the only thing the engine promises to keep: a read-out
 * is a fold over them, which is what makes a run replayable and explainable.
 */
export type EventType =
  // calendar and money
  | "MonthOpened"
  | "OverheadsPosted"
  | "FinancingPosted"
  | "ContingencyPosted"
  // reproduction
  | "EstrusExpected"
  | "EstrusDetected"
  | "EstrusMissed"
  | "ServiceAttempted"
  | "ServiceCompleted"
  | "ServiceOpportunityMissed"
  | "ReturnToEstrus"
  | "PregnancyScanned"
  | "FarrowingCompleted"
  | "WeaningCompleted"
  // housing
  | "MovementRequested"
  | "MovementCompleted"
  | "MovementBlocked"
  | "BatchSplit"
  | "SaleHeldForSpace"
  | "RoomOverCapacity"
  | "CrowdingDeathsScheduled"
  | "WeanedEarlyForSpace"
  // nutrition and stores
  | "OrderPlaced"
  | "DeliveryReceived"
  | "InvoiceRaised"
  | "InvoicePaid"
  | "StoreRanShort"
  | "IntakeRestricted"
  // stock
  | "PigletsBorn"
  | "GiltSelected"
  | "GiltPromoted"
  | "GiltSold"
  | "PigsSold"
  | "PigDied"
  | "SowCulled"
  | "BoarRotated"
  | "StockPurchased"
  | "ProcessingDone";

/** What a domain event posted to the books, if it posted anything. */
export type Posting = {
  category: LedgerCategory;
  /** What it cost or earned, which is not always what moved through the bank. */
  accrued?: number;
  /** What moved through the bank, which is not always what it cost. */
  cash?: number;
};

export type DomainEvent = {
  day: number;
  date: string;
  type: EventType;
  /** The animals, rooms or orders it happened to. */
  entities?: readonly string[];
  /** Why it happened — the event, decision or shortage that produced it. */
  cause?: string;
  /** What changed in the world, as a handful of named numbers. */
  changes?: Readonly<Record<string, number | string>>;
  postings?: readonly Posting[];
  /** The same thing in a sentence, for the log a person reads. */
  message: string;
  stage?: PigStage;
  room?: RoomId;
};

/**
 * The running record. It is capped unless a caller says it wants the whole of
 * it, because a three-year plan on a five hundred sow herd writes a great many
 * events and most readers want the last dozen.
 */
export class EventLog {
  readonly events: DomainEvent[] = [];
  private readonly limit: number;

  constructor(limit: number) {
    this.limit = limit;
  }

  emit(event: DomainEvent): DomainEvent {
    this.events.push(event);
    if (this.events.length > this.limit) this.events.shift();
    return event;
  }

  /** Every event of a kind, for the read-outs that fold over one thing. */
  ofType(...types: EventType[]): DomainEvent[] {
    const wanted = new Set<EventType>(types);
    return this.events.filter((event) => wanted.has(event.type));
  }
}
