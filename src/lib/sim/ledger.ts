export type LedgerCategory =
  | "pig-sales"
  | "gilt-sales"
  | "cull-sales"
  | "other-income"
  | "feed-sow"
  | "feed-creep"
  | "feed-weaner"
  | "feed-grower"
  | "feed-finisher"
  | "bedding"
  | "gas"
  | "deliveries"
  | "vaccination"
  | "processing"
  | "veterinary"
  | "labour"
  | "overheads"
  | "transport"
  | "breeding-stock"
  | "semen"
  | "contingency"
  | "capital";

export type LedgerKind = "income" | "expense";

export const LEDGER_CATEGORIES: { id: LedgerCategory; label: string; kind: LedgerKind }[] = [
  { id: "pig-sales", label: "Pig sales", kind: "income" },
  { id: "gilt-sales", label: "Breeding gilt sales", kind: "income" },
  { id: "cull-sales", label: "Cull sow sales", kind: "income" },
  { id: "other-income", label: "Other income", kind: "income" },
  { id: "feed-sow", label: "Sow & gilt feed", kind: "expense" },
  { id: "feed-creep", label: "Creep feed", kind: "expense" },
  { id: "feed-weaner", label: "Weaner feed", kind: "expense" },
  { id: "feed-grower", label: "Grower feed", kind: "expense" },
  { id: "feed-finisher", label: "Finisher feed", kind: "expense" },
  { id: "bedding", label: "Bedding", kind: "expense" },
  { id: "gas", label: "Heating gas", kind: "expense" },
  { id: "deliveries", label: "Deliveries to the farm", kind: "expense" },
  { id: "vaccination", label: "Vaccination", kind: "expense" },
  { id: "processing", label: "Piglet processing", kind: "expense" },
  { id: "veterinary", label: "Routine veterinary", kind: "expense" },
  { id: "labour", label: "Labour", kind: "expense" },
  { id: "overheads", label: "Fixed overheads", kind: "expense" },
  { id: "transport", label: "Haulage to abattoir", kind: "expense" },
  { id: "breeding-stock", label: "Bought-in breeding stock", kind: "expense" },
  { id: "semen", label: "AI semen & service", kind: "expense" },
  { id: "contingency", label: "Contingency", kind: "expense" },
  { id: "capital", label: "Capital", kind: "expense" },
];

export const INCOME_CATEGORIES = LEDGER_CATEGORIES.filter(
  (category) => category.kind === "income",
).map((category) => category.id);

export const EXPENSE_CATEGORIES = LEDGER_CATEGORIES.filter(
  (category) => category.kind === "expense",
).map((category) => category.id);

export const CATEGORY_LABELS = Object.fromEntries(
  LEDGER_CATEGORIES.map((category) => [category.id, category.label]),
) as Record<LedgerCategory, string>;

export const CATEGORY_KINDS = Object.fromEntries(
  LEDGER_CATEGORIES.map((category) => [category.id, category.kind]),
) as Record<LedgerCategory, LedgerKind>;

export type LedgerEntry = {
  day: number;
  date: string;
  category: LedgerCategory;
  kind: LedgerKind;
  amount: number;
  note: string;
};

export type CategoryTotals = Record<LedgerCategory, number>;

/** What one day did, kept as the two different things a day does. */
export type DayClose = {
  /** Earned and consumed: the profit and loss view of the day. */
  totals: CategoryTotals;
  /** Received and paid: what actually moved through the bank. */
  cashTotals: CategoryTotals;
  netCashFlow: number;
  closingCash: number;
};

export function emptyTotals(): CategoryTotals {
  return Object.fromEntries(
    LEDGER_CATEGORIES.map((category) => [category.id, 0]),
  ) as CategoryTotals;
}

/**
 * A day's cash movements, by category.
 *
 * The 1.x engine keeps one book: every cost is posted on the day it is paid, so
 * its costs *are* its payments and it writes no separate cash column. The 2.0
 * engine keeps two, because a lorryload of feed is bought on one day, eaten over
 * the next six weeks and paid for thirty days after it landed.
 *
 * Reading the cash side through here rather than off the field means a statement
 * headed "cash payments" says the same true thing on both engines, and the
 * absence of a cash column on a 1.x day is read as the fact it is — that engine
 * has nothing to distinguish — rather than as a missing value.
 */
export function cashTotalsOf(record: BookedDay): CategoryTotals {
  return record.cashTotals ?? record.totals;
}

/**
 * A day as a financial statement reads it. The two optional fields are what the
 * 2.0 engine knows and the 1.x engine has no opinion about: leaving them off is
 * the 1.x claim that there is only one book and nothing is owed on it.
 */
export type BookedDay = {
  totals: CategoryTotals;
  cashTotals?: CategoryTotals;
  payables?: number;
};

/** Owed to suppliers at the close. An engine that pays on the spot owes nothing. */
export function payablesOf(record: BookedDay): number {
  return record.payables ?? 0;
}

export function addTotals(target: CategoryTotals, source: CategoryTotals): void {
  for (const { id } of LEDGER_CATEGORIES) target[id] += source[id];
}

export function incomeOf(totals: CategoryTotals): number {
  return INCOME_CATEGORIES.reduce((sum, category) => sum + totals[category], 0);
}

/** The five feed stores, for the places that want the whole feed bill at once. */
export const FEED_CATEGORIES = [
  "feed-sow",
  "feed-creep",
  "feed-weaner",
  "feed-grower",
  "feed-finisher",
] as const satisfies readonly LedgerCategory[];

/** What was spent on feed across every store. */
export function feedOf(totals: CategoryTotals): number {
  return FEED_CATEGORIES.reduce((sum, category) => sum + totals[category], 0);
}

export function expensesOf(totals: CategoryTotals): number {
  return EXPENSE_CATEGORIES.reduce((sum, category) => sum + totals[category], 0);
}

/**
 * The farm's money, kept as the two books a farm actually keeps.
 *
 * A cost and a payment are not the same event, and running them together is what
 * made the old ledger quietly wrong about feed: a lorryload paid for in March and
 * eaten through April and May was charged on the days it was eaten, so the money
 * left the bank a month after it really had, and feed standing in the bin was
 * money the plan had not yet noticed spending. Ordering, holding, consuming and
 * paying are four different dates.
 *
 * So every posting says which book it belongs in:
 *
 * - {@link accrue} is both, and is what most of the farm does — a vet bill is a
 *   cost on the day it is a payment.
 * - {@link charge} is profit and loss only: goods taken out of a store, which
 *   were paid for when the lorry came.
 * - {@link pay} is cash only: a supplier invoice settled on its terms, whose cost
 *   was taken when the feed was eaten.
 *
 * The cash balance is the cash book. Revenue and cost are the profit and loss.
 * What lies between them is inventory, and what is still owed on it.
 */
export class Ledger {
  readonly openingCash: number;
  readonly entries: LedgerEntry[] = [];
  /** Earned and consumed, by category, since the plan opened. */
  readonly totals: CategoryTotals = emptyTotals();
  /** Received and paid, by category, since the plan opened. */
  readonly cashTotals: CategoryTotals = emptyTotals();

  private balance: number;
  private readonly day: CategoryTotals = emptyTotals();
  private readonly dayCash: CategoryTotals = emptyTotals();

  constructor(openingCash: number) {
    this.openingCash = openingCash;
    this.balance = openingCash;
  }

  get cash(): number {
    return this.balance;
  }

  /** A cost or an income that is also a movement of cash on the same day. */
  accrue(category: LedgerCategory, amount: number): void {
    if (!Number.isFinite(amount) || amount === 0) return;
    this.day[category] += amount;
    this.dayCash[category] += amount;
  }

  /** A cost with no payment behind it today: goods consumed out of a store. */
  charge(category: LedgerCategory, amount: number): void {
    if (!Number.isFinite(amount) || amount === 0) return;
    this.day[category] += amount;
  }

  /** A payment with no cost behind it today: a supplier invoice falling due. */
  pay(category: LedgerCategory, amount: number): void {
    if (!Number.isFinite(amount) || amount === 0) return;
    this.dayCash[category] += amount;
  }

  /**
   * Writes the day's postings as one entry per category and moves the cash.
   * Returns both books, so callers can keep a profit and loss and a cashflow
   * that are not obliged to agree with one another day by day.
   */
  closeDay(day: number, date: string): DayClose {
    const totals = emptyTotals();
    const cashTotals = emptyTotals();
    let netCashFlow = 0;
    for (const { id, kind, label } of LEDGER_CATEGORIES) {
      const accrued = this.day[id];
      if (accrued !== 0) {
        totals[id] = accrued;
        this.totals[id] += accrued;
        this.entries.push({ day, date, category: id, kind, amount: accrued, note: label });
        this.day[id] = 0;
      }
      const moved = this.dayCash[id];
      if (moved !== 0) {
        cashTotals[id] = moved;
        this.cashTotals[id] += moved;
        netCashFlow += kind === "income" ? moved : -moved;
        this.dayCash[id] = 0;
      }
    }
    this.balance += netCashFlow;
    return { totals, cashTotals, netCashFlow, closingCash: this.balance };
  }

  /** Operating costs accrued so far today, used to size the contingency charge. */
  pendingOperatingCost(): number {
    return EXPENSE_CATEGORIES.reduce(
      (sum, category) =>
        category === "contingency" || category === "capital" ? sum : sum + this.day[category],
      0,
    );
  }

  get income(): number {
    return incomeOf(this.totals);
  }

  get expenses(): number {
    return expensesOf(this.totals);
  }

  /** What has come into and gone out of the bank, as against what was earned. */
  get cashIn(): number {
    return incomeOf(this.cashTotals);
  }

  get cashOut(): number {
    return expensesOf(this.cashTotals);
  }
}
