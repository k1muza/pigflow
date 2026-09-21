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

// ------------------------------------------------------- the funding schedule

/**
 * How far ahead one tranche is expected to carry the plan.
 *
 * {@link planCashInjections} tops each month up by exactly what it is short,
 * which is the right answer for a model and the wrong one for a funder: a plan
 * that is slightly short for eighteen months running produces eighteen rows,
 * and nobody draws down a facility eighteen times. A tranche is instead sized
 * to cover the worst the plan gets over the year in front of it, so a farm
 * filling its places asks for money about once a year — which is how a farm
 * filling its places actually asks for money.
 */
const TRANCHE_HORIZON_MONTHS = 12;

/**
 * A funding amount as it would be asked for, rather than to the cent.
 *
 * Rounded up to two significant figures, and never below a hundred: nobody
 * writes a facility for $18,432.17, and a schedule that does reads as output
 * rather than as a proposal. Rounding up rather than to nearest is deliberate —
 * a tranche that is rounded down is a tranche that does not cover the month it
 * was drawn for.
 */
function asATranche(amount: number): number {
  if (amount <= 0) return 0;
  const magnitude = 10 ** Math.floor(Math.log10(amount));
  const step = Math.max(100, magnitude / 10);
  return Math.ceil(amount / step) * step;
}

/** One drawdown of the proposed facility. */
export type FundingTranche = {
  /** The month it is drawn in; 0 is the first month of the plan. */
  monthIndex: number;
  /** First of that month, as the rest of the plan dates a month. */
  date: string;
  label: string;
  amount: number;
  /** Everything drawn up to and including this tranche. */
  cumulative: number;
  reason: string;
  /** The leanest month this tranche carries the plan through. */
  carriesThrough: string;
  /** Where the balance would have closed that month with nothing put in. */
  unfundedBalance: number;
};

/**
 * The cash deficit the plan projects, turned into a schedule somebody could
 * take to a bank.
 *
 * It is read off the projection and changes nothing: the plan is simulated with
 * whatever cash movements it actually carries, and this says what the run it
 * produced would have needed. Putting the tranches into
 * `config.finance.cashMovements` and running again is a different act, and it
 * is the funding controls on the money page that do it.
 *
 * The arithmetic is deliberately the plainest thing that works. A generated
 * injection costs the farm nothing to service, so money put in early lifts
 * every later balance by the same amount, and a running total is all that has
 * to be carried forward. Interest, arrangement fees and repayment are not
 * modelled — a schedule that guessed at them would be a worse answer dressed as
 * a better one.
 */
export type FundingPlan = {
  /** What the farmer says they are starting with. */
  openingCapital: number;
  /**
   * Capital expenditure the plan itself costs — the initial capital figure on
   * the finance inputs, plus anything else posted to capital as the plan runs.
   *
   * It is on here because the facility below is not the cost of establishing a
   * piggery unless this is. The model carries buildings, land, water, power and
   * fixed equipment as constraints on the herd rather than as assets it costs,
   * so on a plan that enters nothing here the schedule is a working capital
   * facility and nothing more. {@link fundsCapitalWorks} is what says so.
   */
  capitalExpenditure: number;
  /**
   * Whether the plan costs any capital works at all. False means the schedule
   * below covers operating cash only, and the establishment cost of the unit
   * has still to be added to it.
   */
  fundsCapitalWorks: boolean;
  /** The balance the plan is funded never to close below. */
  workingCapitalFloor: number;
  /** How far below that floor the plan goes with nothing put in. */
  projectedShortfall: number;
  /** And the month it goes there. Null on a plan that never needs funding. */
  shortfallMonth: string | null;
  tranches: FundingTranche[];
  /** Every tranche added up: the maximum external funding required. */
  peakRequirement: number;
  /** The month the last of it has to be in place by. */
  fullyDrawnMonth: string | null;
  /**
   * When the plan stops needing more: the first month from which cash is being
   * made and the funded balance never returns to the floor.
   */
  recoveryMonth: string | null;
  /** Where the plan closes with the schedule drawn. */
  closingCash: number;
  /** And the lowest any month of it closes at, once the schedule is drawn. */
  lowestFundedBalance: number;
};

export function planFunding(
  config: PlannerConfig,
  projection: ProjectionResult,
): FundingPlan {
  const floor = config.finance.workingCapitalTarget;
  const opening = config.project.openingCash;
  const months = projection.months;

  /**
   * The plan's balances with the opening cash in front of them, so that a farm
   * that starts below its own floor is funded on day one rather than at the end
   * of its first month. Position 0 is the opening balance and position p is the
   * close of month p - 1, which is why a tranche drawn at p is dated month
   * `max(0, p - 1)`.
   */
  const balances = [opening, ...months.map((month) => month.closingCash)];
  const monthAt = (position: number) => months[Math.max(0, position - 1)] ?? null;
  const labelAt = (position: number) => monthAt(position)?.month ?? "";

  const lowest = Math.min(...balances);
  const lowestPosition = balances.indexOf(lowest);

  const tranches: FundingTranche[] = [];
  /** What has been drawn by the close of each position, in the same order. */
  const drawnBy = new Array<number>(balances.length).fill(0);
  let inPlace = 0;
  for (let position = 0; position < balances.length; position += 1) {
    drawnBy[position] = inPlace;
    if (balances[position] + inPlace >= floor - WORTH_MOVING) continue;

    // What the year in front of this month needs, not only this month: one
    // drawdown that carries the plan to its next lean patch.
    const last = Math.min(position + TRANCHE_HORIZON_MONTHS - 1, balances.length - 1);
    let needed = 0;
    let worst = position;
    for (let ahead = position; ahead <= last; ahead += 1) {
      const short = floor - balances[ahead] - inPlace;
      if (short > needed) {
        needed = short;
        worst = ahead;
      }
    }

    const amount = asATranche(needed);
    inPlace += amount;
    drawnBy[position] = inPlace;
    const month = monthAt(position);
    tranches.push({
      monthIndex: month?.index ?? 0,
      date: month?.date ?? config.project.startDate,
      label: labelAt(position),
      amount,
      cumulative: inPlace,
      reason:
        tranches.length === 0
          ? "Initial working capital"
          : "Cash balance approaching the working capital floor",
      carriesThrough: labelAt(worst),
      unfundedBalance: balances[position],
    });
  }

  // Each balance lifted by what has actually been drawn by then, rather than by
  // the whole facility: a tranche taken in year three does nothing for year one,
  // and a series that pretended otherwise would show the lean months as funded.
  const funded = balances.map((balance, position) => balance + drawnBy[position]);
  // Where the plan stops needing more: cash is being made that month, and the
  // balance never comes back down to the floor after it.
  let recoveryMonth: string | null = null;
  const after = tranches.at(-1)?.monthIndex ?? 0;
  for (let index = after; index < months.length; index += 1) {
    if (months[index].netCashFlow <= 0) continue;
    // Month `index` closes at position `index + 1`, so the months after it start
    // at `index + 2`.
    const staysUp = funded
      .slice(index + 2)
      .every((balance) => balance >= floor - WORTH_MOVING);
    if (!staysUp) continue;
    recoveryMonth = months[index].month;
    break;
  }
  /** The lowest a month closes at once the schedule is drawn. */
  const lowestFundedBalance = months.length === 0 ? funded[0] : Math.min(...funded.slice(1));

  // Everything the plan itself charges to capital, which on most plans is the
  // single initial figure posted on day one.
  const capitalExpenditure = months.reduce((total, month) => total + month.totals.capital, 0);

  return {
    openingCapital: opening,
    capitalExpenditure,
    fundsCapitalWorks: capitalExpenditure > WORTH_MOVING,
    workingCapitalFloor: floor,
    projectedShortfall: Math.max(0, floor - lowest),
    shortfallMonth: lowest < floor ? labelAt(lowestPosition) : null,
    tranches,
    peakRequirement: inPlace,
    fullyDrawnMonth: tranches.at(-1)?.label ?? null,
    recoveryMonth,
    closingCash: (months.at(-1)?.closingCash ?? opening) + inPlace,
    lowestFundedBalance,
  };
}
