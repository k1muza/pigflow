import type { PlannerConfig } from "@/lib/config";

import { FEED_RATIONS, type FeedRation } from "./animals";

/**
 * Everything the farm keeps a store of and has to haul in: the five feed bins,
 * the gas bottles, the bedding.
 */
export type StoreId = FeedRation | "gas" | "bedding";

export const STORE_IDS: readonly StoreId[] = [...FEED_RATIONS, "gas", "bedding"];

/** The stores that travel together, in the order they are loaded onto a lorry. */
const SHARED_STORES: readonly StoreId[] = [...FEED_RATIONS];

export type StoreSeries = Record<StoreId, number[]>;

/** One store's share of a lorry's payload. */
export type TripLine = { store: StoreId; kg: number };

/**
 * What the lorry went out for.
 *
 * `supplies` is the mixed run: feed of every ration on the same deck, with the
 * gas bottles in the space held back for them. `bedding` travels alone — it is
 * bulky and dirty, and it has no business riding on a feed order.
 */
export type TripKind = "supplies" | "bedding";

export type Trip = {
  /** Day the lorry comes through the gate. */
  day: number;
  /** First day the herd draws on anything aboard, which is what the trip is for. */
  neededFromDay: number;
  kind: TripKind;
  payloadKg: number;
  /** What the journey costs, whatever it happens to be carrying. */
  cost: number;
  /** The order, store by store, heaviest first. */
  lines: TripLine[];
};

export type HaulagePlan = {
  /** Every lorry movement the plan needs, in the order the farm sees them. */
  trips: Trip[];
  /**
   * Haulage carried by each kilogram of a store drawn on a given day. A trip is
   * charged once and its cost spread over everything aboard, so a kilogram that
   * rode in on a full lorry carries less of it than one on a near-empty run —
   * and a gas bottle that came in on the feed order carries only its own share.
   */
  haulagePerKgByDay: StoreSeries;
  /** What is standing in each store at the close of each day. */
  stockByDay: StoreSeries;
};

export type RationTally = Record<FeedRation, number>;

export function emptyRations(): RationTally {
  return Object.fromEntries(FEED_RATIONS.map((ration) => [ration, 0])) as RationTally;
}

export function emptyStoreSeries(): StoreSeries {
  return Object.fromEntries(STORE_IDS.map((store) => [store, [] as number[]])) as StoreSeries;
}

/** A farm that hauls nothing, used while the haulage itself is being worked out. */
export const EMPTY_HAULAGE: HaulagePlan = {
  trips: [],
  haulagePerKgByDay: emptyStoreSeries(),
  stockByDay: emptyStoreSeries(),
};

/** Kilograms below which a remainder is treated as nothing, to end the fill loops. */
const CRUMB_KG = 1e-9;

/** One lorry's worth of goods as the schedule is cut, before it has been given a day. */
type Load = {
  lines: Map<StoreId, number>;
  kg: number;
  /** -1 until the load takes its first kilogram, which is the day it is needed. */
  neededFromDay: number;
};

/** Which load every kilogram drawn on a day came off, so haulage lands on it. */
type Draw = { day: number; store: StoreId; load: number; kg: number };

type Cut = { loads: Load[]; draws: Draw[] };

/**
 * Cuts daily use into lorry loads, walking **forwards** from day one and summing
 * what was used, across every store that shares the vehicle.
 *
 * Each time that running sum reaches a full payload, the trip that carried it is
 * placed at the first day the herd drew on it — the position of need. So every
 * trip is a full lorry except the last, which carries whatever is left to give
 * when the plan ends.
 *
 * Summing *across* stores rather than one at a time is what makes the lorry a
 * lorry. Cutting each ration on its own meant a bin sent for a vehicle of its
 * own the moment it had 2.5 tonnes to its name, whatever else was due that week,
 * and a herd eating five rations ran five times the trips it needed to. A real
 * order is mixed: so much sow, so much weaner, so much creep, one delivery note.
 *
 * This used to be walked backwards, to keep the part load at the start where a
 * two-sow herd eating six kilograms a day seemed to belong. That put the whole
 * horizon into the opening order: the first load came out as the total use of
 * the plan modulo a lorry, so asking for three years instead of one changed what
 * arrived in January and how many trips month one was charged for. A plan's
 * opening month cannot depend on how far out it was drawn.
 */
function cutLoads(
  stores: readonly StoreId[],
  use: StoreSeries,
  days: number,
  capacity: number,
): Cut {
  const payload = Math.max(capacity, 1);
  const loads: Load[] = [];
  const draws: Draw[] = [];

  let current: Load = { lines: new Map(), kg: 0, neededFromDay: -1 };
  for (let day = 0; day < days; day += 1) {
    for (const store of stores) {
      let left = use[store]?.[day] ?? 0;
      while (left > CRUMB_KG) {
        const room = payload - current.kg;
        if (room <= CRUMB_KG) {
          loads.push(current);
          current = { lines: new Map(), kg: 0, neededFromDay: -1 };
          continue;
        }
        // A day's use can run past the end of a load, so it is taken a piece at
        // a time rather than a day at a time. Rounding the day onto one load or
        // the other would drop or invent the overshoot, and over a long plan
        // those crumbs come to whole lorries.
        const take = Math.min(room, left);
        if (current.neededFromDay < 0) current.neededFromDay = day;
        current.kg += take;
        current.lines.set(store, (current.lines.get(store) ?? 0) + take);
        draws.push({ day, store, load: loads.length, kg: take });
        left -= take;
      }
    }
  }
  // The last load is the part one: what the stores have left to take when the
  // plan stops. It is the only load whose size the horizon has any say in.
  if (current.kg > CRUMB_KG) loads.push(current);

  return { loads, draws };
}

function tripOf(load: Load, day: number, kind: TripKind, cost: number): Trip {
  return {
    day,
    neededFromDay: load.neededFromDay,
    kind,
    payloadKg: load.kg,
    cost,
    lines: [...load.lines]
      .map(([store, kg]) => ({ store, kg }))
      .sort((a, b) => b.kg - a.kg || a.store.localeCompare(b.store)),
  };
}

/**
 * Works out every lorry movement a plan needs.
 *
 * Because the schedule is read off feeding that has already happened, it never
 * guesses: no store runs dry, nothing is delivered that is not used, and every
 * trip carries goods the herd goes on to eat, burn or lie on.
 *
 * Three rules shape it, and they are the farm's rules rather than the model's:
 *
 * - **A lorry carries a mixed order.** Every ration due is loaded onto the same
 *   deck, up to the weight the farm is willing to put on it.
 * - **Gas rides in the space held back for it.** The vehicle is bigger than the
 *   feed it is allowed to carry; the difference is there for the bottles, the
 *   vaccines and the rest of the sundries. A bottle waits for a run it fits on
 *   rather than sending a vehicle for itself — and only makes its own trip when
 *   there is no run in time with room on it.
 * - **Bedding travels alone.** It never shares with feed, so it is cut and
 *   scheduled on its own and pays its own way every time.
 */
export function planHaulage(use: StoreSeries, config: PlannerConfig): HaulagePlan {
  const days = Math.max(
    ...STORE_IDS.map((store) => use[store]?.length ?? 0),
    0,
  );
  const gross = Math.max(config.feed.truckCapacityKg, 1);
  // What the farm will put on a deck as feed. The rest of the payload is held
  // back, so a bottle of gas never displaces an order that was already due.
  const forFeed = Math.max(gross - config.feed.sundriesAllowanceKg, 1);
  const tripCost = config.feed.deliveryCostPerTrip;
  const buffer = config.feed.feedBufferDays;

  const trips: Trip[] = [];
  /** Which trip each load ended up on, per cut, so haulage can be charged out. */
  const rateOf: { cut: Cut; onto: Trip[] }[] = [];
  /** Supply runs by the day they arrive, so a bottle can look for room on one. */
  const byDay = new Map<number, Trip[]>();
  const noteTrip = (trip: Trip) => {
    trips.push(trip);
    const sameDay = byDay.get(trip.day);
    if (sameDay) sameDay.push(trip);
    else byDay.set(trip.day, [trip]);
    return trip;
  };

  // ---- The mixed supply run -------------------------------------------------
  const feed = cutLoads(SHARED_STORES, use, days, forFeed);
  const feedTrips = feed.loads.map((load) =>
    // The buffer is feed standing in the store: the lorry comes this many days
    // before the herd starts on the load.
    noteTrip(tripOf(load, Math.max(0, load.neededFromDay - buffer), "supplies", tripCost)),
  );
  rateOf.push({ cut: feed, onto: feedTrips });

  // ---- Gas, in the space held back for it -----------------------------------
  const gas = cutLoads(["gas"], use, days, config.health.gasCanisterKg);
  const gasTrips: Trip[] = [];
  placeSundries(
    gas.loads,
    use.gas ?? [],
    days,
    buffer,
    config.health.gasCanisterKg,
    config.health.gasCanisterKg * config.health.gasCanisters,
    (day, kg) => roomOn(byDay.get(day), gross, kg) !== undefined,
    (day, load) => {
      const riding = roomOn(byDay.get(day), gross, load.kg);
      if (riding) {
        // The journey was being made anyway, so it costs nothing more to bring.
        // Two bottles on one deck are one line on the note, not two.
        const already = riding.lines.find((line) => line.store === "gas");
        if (already) already.kg += load.kg;
        else riding.lines.push({ store: "gas", kg: load.kg });
        riding.lines.sort((a, b) => b.kg - a.kg || a.store.localeCompare(b.store));
        riding.payloadKg += load.kg;
        riding.neededFromDay = Math.min(riding.neededFromDay, load.neededFromDay);
        gasTrips.push(riding);
        return;
      }
      gasTrips.push(noteTrip(tripOf(load, day, "supplies", tripCost)));
    },
  );
  rateOf.push({ cut: gas, onto: gasTrips });

  // ---- Bedding, on its own ---------------------------------------------------
  // A bedding load is set apart from the feed order, but it still has to fit on
  // the vehicle that fetches it.
  const beddingLoad = Math.min(Math.max(config.housing.beddingLoadKg, 1), gross);
  const bedding = cutLoads(["bedding"], use, days, beddingLoad);
  const beddingTrips = bedding.loads.map((load) =>
    // Never noted as a shared run: nothing rides with bedding.
    tripOf(
      load,
      Math.max(0, load.neededFromDay - buffer),
      "bedding",
      config.housing.beddingDeliveryCost,
    ),
  );
  trips.push(...beddingTrips);
  rateOf.push({ cut: bedding, onto: beddingTrips });

  // ---- What each kilogram carries of the journey it came on ------------------
  const haulagePerKgByDay = emptyStoreSeries();
  const cost = emptyStoreSeries();
  const drawnKg = emptyStoreSeries();
  for (const store of STORE_IDS) {
    cost[store] = new Array<number>(days).fill(0);
    drawnKg[store] = new Array<number>(days).fill(0);
  }
  for (const { cut, onto } of rateOf) {
    for (const draw of cut.draws) {
      const trip = onto[draw.load];
      if (!trip || trip.payloadKg <= 0) continue;
      cost[draw.store][draw.day] += (draw.kg / trip.payloadKg) * trip.cost;
      drawnKg[draw.store][draw.day] += draw.kg;
    }
  }
  for (const store of STORE_IDS) {
    haulagePerKgByDay[store] = cost[store].map((paid, day) =>
      drawnKg[store][day] > 0 ? paid / drawnKg[store][day] : 0,
    );
  }

  trips.sort((a, b) => a.day - b.day || a.kind.localeCompare(b.kind) || b.payloadKg - a.payloadKg);

  return { trips, haulagePerKgByDay, stockByDay: runningStock(use, trips, days) };
}

/** The first trip on a day with weight to spare, or nothing if none has. */
function roomOn(candidates: Trip[] | undefined, gross: number, kg: number): Trip | undefined {
  if (!candidates) return undefined;
  return candidates.find(
    (trip) => trip.kind === "supplies" && trip.payloadKg + kg <= gross + CRUMB_KG,
  );
}

/**
 * The day each bottle can actually come through the gate.
 *
 * It wants to arrive the buffer ahead of the day it is needed, but two things
 * move it. It cannot arrive before there is somewhere to put it: a delivery that
 * would overfill the store waits until enough has been burnt to take it. And it
 * would rather wait for a lorry that is coming anyway than send one — so it
 * takes the **latest** shared run that is still in time, reaching back as far as
 * room in the store allows, which is usually a good deal further than the buffer
 * would. It never waits past the day it is needed, because by then the store is
 * empty enough by definition.
 */
function placeSundries(
  loads: Load[],
  use: number[],
  days: number,
  buffer: number,
  /**
   * What one of these takes up, whether or not it is full. A bottle is a
   * bottle-sized object: a part-filled one needs the same corner of the yard
   * and the same corner of the deck as a full one.
   *
   * Scheduling on the nominal size rather than the contents is also what keeps
   * the plan readable on any date. Only the **last** load of a plan is a part
   * load, so sizing the room it needs by its contents made that one load — and
   * whether it could ride on a lorry already coming — depend on where the plan
   * happened to stop. A twelve month plan then closed sixty dollars apart from
   * the same twelve months read inside a three year one.
   */
  unitKg: number,
  capacity: number,
  lorryOn: (day: number, kg: number) => boolean,
  /** Called once per load with the day it settled on, to put it on a vehicle. */
  commit: (day: number, load: Load) => void,
): void {
  /** What has landed on each day, and what the store holds at the close of it. */
  const arriving = new Array<number>(days).fill(0);
  const held = new Array<number>(days).fill(0);

  /**
   * Rebuilt in full after every bottle is placed, so what the next one is
   * checked against is the schedule so far and not an idea of it. An earlier
   * version kept a running cursor instead and moved a bottle to a lorry day
   * without moving it in the bookkeeping, so two bottles could each be told
   * there was room on the same day — and 96 kg of canisters held 102 kg.
   */
  const restock = () => {
    let level = 0;
    for (let day = 0; day < days; day += 1) {
      level += arriving[day] - (use[day] ?? 0);
      held[day] = level;
    }
  };
  restock();

  /**
   * Whether the store could take this load on a given day. Deliveries are kept
   * in the order they arrive, so nothing lands after this one yet and the store
   * only falls from here — which makes the day it lands the day it is fullest,
   * and the only day worth testing.
   */
  const room = (day: number) => (held[day] ?? 0) + unitKg <= capacity + CRUMB_KG;

  /** Bottles arrive in the order they were ordered; none overtakes another. */
  let soonest = 0;

  for (const load of loads) {
    const latest = Math.min(load.neededFromDay, days - 1);
    let day = Math.max(soonest, Math.min(latest, Math.max(0, latest - buffer)));

    // Wait until the store can take it. By the day the herd starts on this load
    // everything before it has been drawn, so it always fits by then; the tail
    // of the loop is there for the case the arithmetic ever says otherwise.
    while (day < days - 1 && !room(day)) day += 1;

    // How far back it could have come and still fitted, which is usually a good
    // deal further than the buffer: what stops a bottle arriving early is room
    // in the store, not the schedule.
    let earliest = day;
    while (earliest > soonest && room(earliest - 1)) earliest -= 1;

    // Then take the latest run that is coming anyway, is still in time, and has
    // both weight to spare on the deck and somewhere to put the bottle.
    for (let candidate = latest; candidate >= earliest; candidate -= 1) {
      if (room(candidate) && lorryOn(candidate, unitKg)) {
        day = candidate;
        break;
      }
    }

    arriving[day] += load.kg;
    soonest = day;
    restock();
    // Committed here, in the loop, so the next bottle sees the vehicle this one
    // filled rather than the one it found.
    commit(day, load);
  }
}

/**
 * What is standing in each store at the close of each day: everything delivered
 * by then, less everything used by then. It is what the farm would see if it
 * looked in the bin, and it is an asset — goods bought and not yet used are not
 * money gone.
 */
function runningStock(use: StoreSeries, trips: Trip[], days: number): StoreSeries {
  const stock = emptyStoreSeries();
  const arriving = emptyStoreSeries();
  for (const store of STORE_IDS) arriving[store] = new Array<number>(days).fill(0);
  for (const trip of trips) {
    if (trip.day >= days) continue;
    for (const line of trip.lines) arriving[line.store][trip.day] += line.kg;
  }
  for (const store of STORE_IDS) {
    const level = new Array<number>(days).fill(0);
    let held = 0;
    for (let day = 0; day < days; day += 1) {
      held += arriving[store][day] - (use[store]?.[day] ?? 0);
      // Crumbs of floating point, not feed.
      level[day] = Math.abs(held) < CRUMB_KG ? 0 : held;
    }
    stock[store] = level;
  }
  return stock;
}
