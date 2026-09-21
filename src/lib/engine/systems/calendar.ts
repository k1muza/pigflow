import { addMonths } from "date-fns";

import { workersNeeded } from "../../config";
import type { World } from "../world";

/**
 * The calendar system: the things that happen because of the date rather than
 * because of anything on the farm. A week turning over resets what the boar team
 * has worked; a month turning over re-reads the payroll, posts the fixed
 * overheads and the routine veterinary charge, and lands whatever the owner
 * booked into that month by hand.
 */

/**
 * How far clear of a post's threshold the herd has to fall before that post is
 * shed. A farm takes a stockperson on as soon as the work is there, but it does
 * not lay one off over a single month's swing in a batch-farrowing herd.
 */
const LABOUR_SHED_BAND = 0.1;

/** The note on a cash movement, if the owner wrote one. */
function noteOf(note: string): string {
  return note.trim() ? `: ${note.trim()}` : "";
}

/**
 * Head on the farm averaged over the month just gone, which is what the wage
 * bill is sized from. On the opening day there is no history to average, so the
 * stock standing there answers for itself.
 */
function averageRecentHead(world: World): number {
  const window = world.history.slice(-30);
  if (window.length === 0) return world.countHerd().total;
  return window.reduce((sum, day) => sum + day.counts.total, 0) / window.length;
}

/**
 * Stockpeople for a herd of this size. A post is taken on the month the work
 * appears, but only shed once the herd has fallen clearly below it, so the wage
 * bill does not flip back and forth with a batch-farrowing herd.
 */
function payrollFor(world: World, averageHead: number): number {
  const needed = workersNeeded(averageHead, world.config);
  if (needed >= world.workersOnPayroll) return needed;
  const held = workersNeeded(averageHead * (1 + LABOUR_SHED_BAND), world.config);
  return Math.max(needed, Math.min(world.workersOnPayroll, held));
}

export function runCalendar(world: World): void {
  const { config, ledger } = world;
  const day = world.day;

  if (day % 7 === 0) {
    for (const boar of world.boars) boar.servicesThisWeek = 0;
  }

  if (day === 0) ledger.accrue("capital", config.finance.initialCapitalCosts);

  // Taken before the monthly block moves the counter on, so the financing for
  // this month can be posted later in the day, after the contingency is struck.
  world.chargedMonth = day === world.nextMonthlyChargeDay ? world.monthsCharged : null;
  if (world.chargedMonth === null) return;

  // Labour is not a fixed overhead: a bigger herd is more people. The payroll is
  // re-read once a month, from the herd averaged over the month just gone — a
  // farm does not hire and fire on a single day's head count.
  world.workersOnPayroll = payrollFor(world, averageRecentHead(world));
  const wages = world.workersOnPayroll * config.finance.labourCostPerWorkerMonth;
  const overheads =
    config.finance.utilitiesMonthly +
    config.finance.biosecurityMonthly +
    config.finance.otherFixedMonthly;
  ledger.accrue("labour", wages);
  ledger.accrue("overheads", overheads);
  ledger.accrue("other-income", config.finance.otherIncomeMonthly);

  world.emit("MonthOpened", "Month " + (world.monthsCharged + 1) + " opened", {
    changes: { workers: world.workersOnPayroll },
  });
  world.emit(
    "OverheadsPosted",
    world.workersOnPayroll +
      (world.workersOnPayroll === 1 ? " stockperson" : " stockpeople") +
      " on the payroll",
    {
      postings: [
        { category: "labour", accrued: wages, cash: wages },
        { category: "overheads", accrued: overheads, cash: overheads },
      ],
    },
  );

  // What the owner has added to this month by hand, posted alongside the farm's
  // own other income and fixed overheads rather than off to one side.
  for (const movement of config.finance.cashMovements) {
    if (movement.auto || movement.monthIndex !== world.monthsCharged) continue;
    if (movement.amount <= 0) continue;
    if (movement.kind === "in") {
      ledger.accrue("other-income", movement.amount);
      world.emit("FinancingPosted", `Money in${noteOf(movement.note)}`, {
        postings: [{ category: "other-income", accrued: movement.amount, cash: movement.amount }],
      });
    } else {
      ledger.accrue("overheads", movement.amount);
      world.emit("FinancingPosted", `Money out${noteOf(movement.note)}`, {
        postings: [{ category: "overheads", accrued: movement.amount, cash: movement.amount }],
      });
    }
  }

  for (const sow of world.sows) {
    sow.costs.add("health", "breeding", config.health.vetCostPerSowMonth);
    world.books.keepBreedingHerd(config.health.vetCostPerSowMonth);
    world.breedingCosts.add("health", "breeding", config.health.vetCostPerSowMonth);
    ledger.accrue("veterinary", config.health.vetCostPerSowMonth);
  }

  world.monthsCharged += 1;
  world.nextMonthlyChargeDay = world.dayOf(addMonths(world.start, world.monthsCharged));
}

/**
 * Cash the funding buttons move in or out this month. It is posted after the
 * contingency has been struck, because topping the bank up — or taking a surplus
 * out — is not the farm running up a cost to be covered.
 */
export function runFinancing(world: World): void {
  const monthIndex = world.chargedMonth;
  if (monthIndex === null) return;
  for (const movement of world.config.finance.cashMovements) {
    if (!movement.auto || movement.monthIndex !== monthIndex) continue;
    if (movement.amount <= 0) continue;
    // Posted to other income and to fixed overheads so that the cash book
    // balances, and recorded as financing so that no profit statement reads
    // either of them as the farm having traded. See `lib/accounts`.
    world.books.finance(movement.kind, movement.amount);
    if (movement.kind === "in") {
      world.ledger.accrue("other-income", movement.amount);
      world.emit("FinancingPosted", `Cash injection${noteOf(movement.note)}`, {
        cause: "working-capital policy",
        postings: [{ category: "other-income", accrued: movement.amount, cash: movement.amount }],
      });
    } else {
      world.ledger.accrue("overheads", movement.amount);
      world.financingCosts += movement.amount;
      world.emit("FinancingPosted", `Cash withdrawal${noteOf(movement.note)}`, {
        cause: "working-capital policy",
        postings: [{ category: "overheads", accrued: movement.amount, cash: movement.amount }],
      });
    }
  }
}
