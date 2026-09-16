import type { CashMovement, PlannerConfig } from "./config";
import type { ProjectionResult } from "./model";

/** Rows the funding buttons write, as against the ones you type yourself. */
export function isGenerated(movement: CashMovement, kind: CashMovement["kind"]): boolean {
  return movement.auto && movement.kind === kind;
}

/** Everything the generated rows of one kind add up to. */
export function generatedTotal(
  movements: readonly CashMovement[],
  kind: CashMovement["kind"],
): number {
  return movements.reduce(
    (sum, movement) => (isGenerated(movement, kind) ? sum + movement.amount : sum),
    0,
  );
}

/** Amounts are money, so they are settled to the cent rather than the atom. */
function toCents(amount: number): number {
  return Math.round(amount * 100) / 100;
}

/** Below this there is nothing worth writing a row for. */
const WORTH_MOVING = 0.01;

/**
 * The cash to put in, month by month, to keep the business from ever closing a
 * month below its working capital. Each month is topped up by exactly what it is
 * short, and because a generated row costs the farm nothing to service, putting
 * money in early lifts every later balance by the same amount — so the running
 * total is all that is needed to carry the effect forward.
 */
export function planCashInjections(
  config: PlannerConfig,
  projection: ProjectionResult,
): CashMovement[] {
  const target = config.finance.workingCapitalTarget;
  const rows: CashMovement[] = [];
  let running = 0;

  for (const month of projection.months) {
    const closing = month.closingCash + running;
    const short = target - closing;
    if (short < WORTH_MOVING) continue;
    const amount = toCents(short);
    rows.push({
      id: `auto-in-${month.index}`,
      monthIndex: month.index,
      kind: "in",
      amount,
      note: "Cash injection",
      auto: true,
    });
    running += amount;
  }

  return rows;
}

/**
 * The surplus to take out, month by month, leaving the working capital behind.
 *
 * What a month can spare is not its own balance but the lowest balance still to
 * come: money taken out now is gone from every month after it, so drawing a
 * month down to its own surplus would simply hand the shortfall to the next one.
 * Reading the run of balances from the far end backwards gives each month the
 * most it can give up without ever putting a later month short.
 */
export function planCashWithdrawals(
  config: PlannerConfig,
  projection: ProjectionResult,
): CashMovement[] {
  const target = config.finance.workingCapitalTarget;
  const months = projection.months;
  if (months.length === 0) return [];

  const lowestAhead = new Array<number>(months.length);
  let lowest = Number.POSITIVE_INFINITY;
  for (let index = months.length - 1; index >= 0; index -= 1) {
    lowest = Math.min(lowest, months[index].closingCash);
    lowestAhead[index] = lowest;
  }

  const rows: CashMovement[] = [];
  let running = 0;
  months.forEach((month, index) => {
    const spare = lowestAhead[index] + running - target;
    if (spare < WORTH_MOVING) return;
    const amount = toCents(spare);
    rows.push({
      id: `auto-out-${month.index}`,
      monthIndex: month.index,
      kind: "out",
      amount,
      note: "Cash withdrawal",
      auto: true,
    });
    running -= amount;
  });

  return rows;
}
