export type LedgerCategory =
  | "pig-sales"
  | "gilt-sales"
  | "cull-sales"
  | "other-income"
  | "feed"
  | "feed-haulage"
  | "vaccination"
  | "veterinary"
  | "heating"
  | "labour"
  | "overheads"
  | "transport"
  | "breeding-stock"
  | "contingency"
  | "capital";

export type LedgerKind = "income" | "expense";

export const LEDGER_CATEGORIES: { id: LedgerCategory; label: string; kind: LedgerKind }[] = [
  { id: "pig-sales", label: "Pig sales", kind: "income" },
  { id: "gilt-sales", label: "Breeding gilt sales", kind: "income" },
  { id: "cull-sales", label: "Cull sow sales", kind: "income" },
  { id: "other-income", label: "Other income", kind: "income" },
  { id: "feed", label: "Feed", kind: "expense" },
  { id: "feed-haulage", label: "Feed delivery", kind: "expense" },
  { id: "vaccination", label: "Vaccination & treatment", kind: "expense" },
  { id: "veterinary", label: "Routine veterinary", kind: "expense" },
  { id: "heating", label: "Heating", kind: "expense" },
  { id: "labour", label: "Labour", kind: "expense" },
  { id: "overheads", label: "Fixed overheads", kind: "expense" },
  { id: "transport", label: "Haulage to abattoir", kind: "expense" },
  { id: "breeding-stock", label: "Bought-in breeding stock", kind: "expense" },
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

export function emptyTotals(): CategoryTotals {
  return Object.fromEntries(
    LEDGER_CATEGORIES.map((category) => [category.id, 0]),
  ) as CategoryTotals;
}

export function addTotals(target: CategoryTotals, source: CategoryTotals): void {
  for (const { id } of LEDGER_CATEGORIES) target[id] += source[id];
}

export function incomeOf(totals: CategoryTotals): number {
  return INCOME_CATEGORIES.reduce((sum, category) => sum + totals[category], 0);
}

export function expensesOf(totals: CategoryTotals): number {
  return EXPENSE_CATEGORIES.reduce((sum, category) => sum + totals[category], 0);
}

/**
 * The farm's money. Every simulated event that costs or earns posts here, so the
 * cash balance on any day is the opening balance plus the entries up to it.
 */
export class Ledger {
  readonly openingCash: number;
  readonly entries: LedgerEntry[] = [];
  readonly totals: CategoryTotals = emptyTotals();

  private balance: number;
  private readonly day: CategoryTotals = emptyTotals();

  constructor(openingCash: number) {
    this.openingCash = openingCash;
    this.balance = openingCash;
  }

  get cash(): number {
    return this.balance;
  }

  /** Adds to the running total for the current day; nothing is posted until flushed. */
  accrue(category: LedgerCategory, amount: number): void {
    if (!Number.isFinite(amount) || amount === 0) return;
    this.day[category] += amount;
  }

  /**
   * Writes the day's accrued amounts as one entry per category and moves cash.
   * Returns what the day did, so callers can keep daily and monthly roll-ups.
   */
  closeDay(
    day: number,
    date: string,
  ): { totals: CategoryTotals; netCashFlow: number; closingCash: number } {
    const totals = emptyTotals();
    let netCashFlow = 0;
    for (const { id, kind, label } of LEDGER_CATEGORIES) {
      const amount = this.day[id];
      if (amount === 0) continue;
      totals[id] = amount;
      this.totals[id] += amount;
      netCashFlow += kind === "income" ? amount : -amount;
      this.entries.push({ day, date, category: id, kind, amount, note: label });
      this.day[id] = 0;
    }
    this.balance += netCashFlow;
    return { totals, netCashFlow, closingCash: this.balance };
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
}
