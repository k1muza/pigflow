import type { PlannerConfig } from "@/lib/config";

import { FEED_RATIONS, type FeedRation } from "./animals";

/**
 * A ration's share of one load. The lines together are the order the farm hands
 * the mill: so many kilograms of each ration, making up the load.
 */
export type FeedOrderLine = { ration: FeedRation; kg: number };

export type FeedDelivery = {
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
   * Haulage carried by each kilogram eaten on a given day, indexed by day. A
   * day's feed can straddle two loads, so this is the weighted rate for the day.
   */
  haulagePerKgByDay: number[];
};

export type RationTally = Record<FeedRation, number>;

export function emptyRations(): RationTally {
  return Object.fromEntries(FEED_RATIONS.map((ration) => [ration, 0])) as RationTally;
}

/** A farm that hauls no feed, used while the haulage itself is being worked out. */
export const EMPTY_FEED_PLAN: FeedPlan = { deliveries: [], haulagePerKgByDay: [] };

/** Kilograms below which a remainder is treated as nothing, to end the fill loops. */
const CRUMB_KG = 1e-9;

/**
 * Works out the lorry trips a plan needs, by walking the herd's feeding **backwards**
 * from the last day and summing what it ate.
 *
 * Each time that running sum reaches a full load, the trip that carried it is
 * placed at the first day the herd ate into it — the position of need. Walking
 * backwards is what makes this worth doing: it lands the part load at the start
 * of the plan, where a two-sow herd eating six kilograms a day belongs, and
 * leaves every later trip full. Filling forwards would put a full 2.5 tonnes on
 * the farm on day one and the part load at the end, which is the wrong way round.
 *
 * Because the schedule is read off feeding that has already happened, it never
 * guesses: the bins never run dry, nothing is delivered that is not eaten, and
 * each load's order list is exactly the rations it was drawn on for.
 */
export function planFeedDeliveries(use: RationTally[], config: PlannerConfig): FeedPlan {
  const capacity = Math.max(config.feed.truckCapacityKg, 1);
  const tripCost = config.feed.deliveryCostPerTrip;
  const buffer = config.feed.feedBufferDays;

  type Load = { kg: number; lines: RationTally; neededFromDay: number };
  /** Closed loads, newest first, because the walk runs backwards. */
  const closed: Load[] = [];
  /** Which load each day's kilograms came off, so haulage lands on the right day. */
  const drawn: { day: number; load: number; kg: number }[] = [];

  let current: Load = { kg: 0, lines: emptyRations(), neededFromDay: 0 };
  for (let day = use.length - 1; day >= 0; day -= 1) {
    for (const ration of FEED_RATIONS) {
      let left = use[day]?.[ration] ?? 0;
      while (left > CRUMB_KG) {
        const room = capacity - current.kg;
        if (room <= CRUMB_KG) {
          closed.push(current);
          current = { kg: 0, lines: emptyRations(), neededFromDay: day };
          continue;
        }
        const take = Math.min(room, left);
        current.kg += take;
        current.lines[ration] += take;
        current.neededFromDay = day;
        drawn.push({ day, load: closed.length, kg: take });
        left -= take;
      }
    }
  }
  if (current.kg > CRUMB_KG) closed.push(current);

  // Put the loads back in the order the farm will see them.
  const loads = closed.slice().reverse();
  const deliveries: FeedDelivery[] = loads.map((load) => ({
    // The buffer is feed standing in the bin: the lorry comes this many days
    // before the herd starts on the load.
    day: Math.max(0, load.neededFromDay - buffer),
    neededFromDay: load.neededFromDay,
    loadKg: load.kg,
    haulageCost: tripCost,
    lines: FEED_RATIONS.filter((ration) => load.lines[ration] > CRUMB_KG).map((ration) => ({
      ration,
      kg: load.lines[ration],
    })),
  }));

  const haulageByDay = new Array<number>(use.length).fill(0);
  const kgByDay = new Array<number>(use.length).fill(0);
  for (const draw of drawn) {
    const load = loads[loads.length - 1 - draw.load];
    if (!load || load.kg <= 0) continue;
    haulageByDay[draw.day] += (draw.kg / load.kg) * tripCost;
    kgByDay[draw.day] += draw.kg;
  }

  return {
    deliveries,
    haulagePerKgByDay: haulageByDay.map((haulage, day) =>
      kgByDay[day] > 0 ? haulage / kgByDay[day] : 0,
    ),
  };
}
