import type { PlannerConfig } from "@/lib/config";

import { FEED_RATIONS, type FeedRation } from "./animals";

/**
 * A ration's share of one load. A load carries one store's goods, so this is a
 * list of one — it is kept as a list because a delivery note reads that way and
 * because the day panel prints it unchanged.
 */
export type FeedOrderLine = { ration: FeedRation; kg: number };

export type FeedDelivery = {
  /** Which store this load fills. */
  ration: FeedRation;
  /** Day the lorry comes through the gate. */
  day: number;
  /** First day the herd eats into this load, which is what the trip is for. */
  neededFromDay: number;
  loadKg: number;
  haulageCost: number;
  lines: FeedOrderLine[];
};

export type FeedPlan = {
  deliveries: FeedDelivery[];
  /**
   * Haulage carried by each kilogram of a ration eaten on a given day, indexed
   * by ration and then by day. Each ration is stored and delivered on its own,
   * so a day's sow feed and a day's finisher feed do not carry the same share
   * of a lorry.
   */
  haulagePerKgByDay: Record<FeedRation, number[]>;
  /** What is standing in each store at the end of each day, in kilograms. */
  stockByDay: Record<FeedRation, number[]>;
};

export type RationTally = Record<FeedRation, number>;

export function emptyRations(): RationTally {
  return Object.fromEntries(FEED_RATIONS.map((ration) => [ration, 0])) as RationTally;
}

function emptyRationSeries(): Record<FeedRation, number[]> {
  return Object.fromEntries(
    FEED_RATIONS.map((ration) => [ration, [] as number[]]),
  ) as Record<FeedRation, number[]>;
}

/** A farm that hauls no feed, used while the haulage itself is being worked out. */
export const EMPTY_FEED_PLAN: FeedPlan = {
  deliveries: [],
  haulagePerKgByDay: emptyRationSeries(),
  stockByDay: emptyRationSeries(),
};

/** Kilograms below which a remainder is treated as nothing, to end the fill loops. */
const CRUMB_KG = 1e-9;

/** One store's worth of schedule: the loads it takes and what they carry. */
type StoreSchedule = {
  loads: { kg: number; neededFromDay: number }[];
  /** Which load each day's kilograms came off, so haulage lands on the right day. */
  drawn: { day: number; load: number; kg: number }[];
};

/**
 * Cuts one store's daily use into lorry loads, walking **forwards** from day one
 * and summing what it ate.
 *
 * Each time that running sum reaches a full load, the trip that carried it is
 * placed at the first day the herd ate into it — the position of need. So every
 * trip is a full lorry except the last, which carries whatever the store has
 * left to give when the plan ends.
 *
 * This used to be walked backwards, to keep the part load at the start where a
 * two-sow herd eating six kilograms a day seemed to belong. That put the whole
 * horizon into the opening order: the first load came out as the total use of
 * the plan modulo a lorry, so asking for three years instead of one changed what
 * arrived in January and how many trips month one was charged for. A plan's
 * opening month cannot depend on how far out it was drawn.
 *
 * Walking forwards costs nothing to fix it. Goods are charged as they are used
 * and haulage as it lands, so a full opening load is not money spent early — it
 * is one trip, charged once, and the store is drawn down as the herd reaches it.
 * A farm whose store really is smaller says so by lowering the load size.
 */
function scheduleStore(use: number[], loadSize: number): StoreSchedule {
  const capacity = Math.max(loadSize, 1);
  const loads: StoreSchedule["loads"] = [];
  const drawn: StoreSchedule["drawn"] = [];

  /** -1 until the load has taken its first kilogram, which is the day it is needed. */
  let current = { kg: 0, neededFromDay: -1 };
  for (let day = 0; day < use.length; day += 1) {
    let left = use[day] ?? 0;
    while (left > CRUMB_KG) {
      const room = capacity - current.kg;
      if (room <= CRUMB_KG) {
        loads.push(current);
        current = { kg: 0, neededFromDay: -1 };
        continue;
      }
      // A day's use can run past the end of a load, so it is taken a piece at a
      // time rather than a day at a time. Rounding the day onto one load or the
      // other would drop or invent the overshoot, and over a long plan those
      // crumbs come to whole lorries.
      const take = Math.min(room, left);
      if (current.neededFromDay < 0) current.neededFromDay = day;
      current.kg += take;
      drawn.push({ day, load: loads.length, kg: take });
      left -= take;
    }
  }
  // The last load is the part one: what the store has left to give when the plan
  // stops. It is the only load whose size the horizon has any say in.
  if (current.kg > CRUMB_KG) loads.push(current);

  return { loads, drawn };
}

/** One store that is not a feed ration: its trips, its haulage and its stock. */
export type StorePlan = {
  deliveries: { day: number; neededFromDay: number; quantity: number; cost: number }[];
  /** Haulage carried by each unit used on a given day. */
  haulagePerUnitByDay: number[];
  /** What is standing in the store at the end of each day. */
  stockByDay: number[];
};

/**
 * Schedules one store that holds a single thing — the gas tank, the bedding
 * barn — on the same terms as a feed bin: full loads, forwards, the part load
 * at the end, and nothing delivered that is not used.
 */
export function planStore(
  use: number[],
  loadSize: number,
  tripCost: number,
  buffer: number,
  /**
   * What the store physically holds. A bin can be topped up early; two gas
   * canisters cannot — the second one has nowhere to go until the first is
   * empty enough to make room. Left out, the store is treated as big enough
   * for anything, which is how the feed bins behaved before this existed.
   */
  capacity = Infinity,
  /**
   * Days a lorry is already coming for something else. A store that shares the
   * farm's transport waits for one of these rather than sending a vehicle of
   * its own: a gas bottle is picked up on the feed run, not fetched specially.
   */
  ridesWith?: ReadonlySet<number>,
): StorePlan {
  const { loads, drawn } = scheduleStore(use, Math.max(loadSize, 1));

  const haulage = new Array<number>(use.length).fill(0);
  const drawnByDay = new Array<number>(use.length).fill(0);
  for (const draw of drawn) {
    const load = loads[draw.load];
    if (!load || load.kg <= 0) continue;
    haulage[draw.day] += (draw.kg / load.kg) * tripCost;
    drawnByDay[draw.day] += draw.kg;
  }

  return {
    deliveries: arrivalDays(loads, use, buffer, capacity, ridesWith).map((day, index) => ({
      day,
      neededFromDay: loads[index].neededFromDay,
      quantity: loads[index].kg,
      cost: tripCost,
    })),
    haulagePerUnitByDay: haulage.map((cost, day) =>
      drawnByDay[day] > 0 ? cost / drawnByDay[day] : 0,
    ),
    stockByDay: runningStock(use, loads, buffer, use.length, capacity, ridesWith),
  };
}

/**
 * The day each load can actually come through the gate. It wants to arrive the
 * buffer ahead of the day it is needed, but it cannot arrive before there is
 * room for it: a delivery that would overfill the store waits until enough has
 * been used to take it. It never waits past the day it is needed, because by
 * then the store is empty enough by definition.
 */
function arrivalDays(
  loads: { kg: number; neededFromDay: number }[],
  use: number[],
  buffer: number,
  capacity: number,
  ridesWith?: ReadonlySet<number>,
): number[] {
  const days: number[] = [];
  /** What the store holds at the close of each day, as the schedule is built. */
  const held = new Array<number>(use.length + 1).fill(0);
  let standing = 0;
  let filled = 0;

  const drawTo = (day: number) => {
    for (; filled < day && filled < held.length; filled += 1) {
      standing = Math.max(0, standing - (use[filled] ?? 0));
      held[filled] = standing;
    }
  };

  for (const load of loads) {
    const latest = load.neededFromDay;
    let day = Math.max(0, latest - buffer);

    if (Number.isFinite(capacity)) {
      // Draw the store down from where the last load left it until the new one
      // fits, but never later than the day the herd starts on it.
      drawTo(day);
      let peek = standing;
      while (day < latest && peek + load.kg > capacity + CRUMB_KG) {
        peek = Math.max(0, peek - (use[day] ?? 0));
        day += 1;
      }
    }

    if (ridesWith && ridesWith.size > 0) {
      // A store that shares the farm's transport takes the latest day the lorry
      // was coming anyway that is still in time — and it may reach further back
      // than the buffer would, because what stops it arriving early is room in
      // the store, not the schedule. Waiting for a lorry beats sending one.
      drawTo(day);
      let roomFrom = day;
      // How far back it could have come and still fitted.
      for (let earlier = day - 1; earlier >= 0; earlier -= 1) {
        const wouldHold = (held[earlier] ?? 0) + load.kg;
        if (wouldHold > capacity + CRUMB_KG) break;
        roomFrom = earlier;
      }
      for (let candidate = latest; candidate >= roomFrom; candidate -= 1) {
        if (ridesWith.has(candidate)) {
          day = candidate;
          break;
        }
      }
    }

    drawTo(day);
    standing += load.kg;
    held[day] = standing;
    days.push(day);
  }
  return days;
}

export const EMPTY_STORE_PLAN: StorePlan = {
  deliveries: [],
  haulagePerUnitByDay: [],
  stockByDay: [],
};

/**
 * Works out the lorry trips a plan needs, store by store.
 *
 * Every ration is its own store: it is ordered on its own, stands on its own and
 * is drawn down on its own. A herd does not hold one undifferentiated heap of
 * feed, and pooling them hid both the real number of trips and what was actually
 * standing on the farm on any given day.
 *
 * Because each schedule is read off feeding that has already happened, it never
 * guesses: no store runs dry, nothing is delivered that is not eaten, and every
 * trip carries one ration that the herd goes on to eat.
 */
export function planFeedDeliveries(use: RationTally[], config: PlannerConfig): FeedPlan {
  const loadSize = Math.max(config.feed.truckCapacityKg, 1);
  const tripCost = config.feed.deliveryCostPerTrip;
  const buffer = config.feed.feedBufferDays;

  const deliveries: FeedDelivery[] = [];
  const haulagePerKgByDay = emptyRationSeries();
  const stockByDay = emptyRationSeries();

  for (const ration of FEED_RATIONS) {
    const daily = use.map((day) => day?.[ration] ?? 0);
    const { loads, drawn } = scheduleStore(daily, loadSize);

    for (const load of loads) {
      deliveries.push({
        ration,
        // The buffer is feed standing in the store: the lorry comes this many
        // days before the herd starts on the load.
        day: Math.max(0, load.neededFromDay - buffer),
        neededFromDay: load.neededFromDay,
        loadKg: load.kg,
        haulageCost: tripCost,
        lines: [{ ration, kg: load.kg }],
      });
    }

    const haulage = new Array<number>(use.length).fill(0);
    const kgDrawn = new Array<number>(use.length).fill(0);
    for (const draw of drawn) {
      const load = loads[draw.load];
      if (!load || load.kg <= 0) continue;
      haulage[draw.day] += (draw.kg / load.kg) * tripCost;
      kgDrawn[draw.day] += draw.kg;
    }
    haulagePerKgByDay[ration] = haulage.map((cost, day) =>
      kgDrawn[day] > 0 ? cost / kgDrawn[day] : 0,
    );
    stockByDay[ration] = runningStock(daily, loads, buffer, use.length);
  }

  // One list, in the order the farm sees the lorries arrive.
  deliveries.sort((a, b) => a.day - b.day || a.ration.localeCompare(b.ration));
  return { deliveries, haulagePerKgByDay, stockByDay };
}

/**
 * What is standing in one store at the end of each day: everything delivered by
 * then, less everything eaten by then. It is what the farm would see if it
 * looked in the bin, and it is an asset — goods bought and not yet used are not
 * money gone.
 */
function runningStock(
  use: number[],
  loads: { kg: number; neededFromDay: number }[],
  buffer: number,
  days: number,
  capacity = Infinity,
  ridesWith?: ReadonlySet<number>,
): number[] {
  const arriving = new Array<number>(days).fill(0);
  const schedule = arrivalDays(loads, use, buffer, capacity, ridesWith);
  for (const [index, load] of loads.entries()) {
    const day = schedule[index];
    if (day < days) arriving[day] += load.kg;
  }
  const stock = new Array<number>(days).fill(0);
  let held = 0;
  for (let day = 0; day < days; day += 1) {
    held += arriving[day] - (use[day] ?? 0);
    // Crumbs of floating point, not feed.
    stock[day] = Math.abs(held) < CRUMB_KG ? 0 : held;
  }
  return stock;
}
