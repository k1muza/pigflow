import type { PlannerConfig } from "@/lib/config";

import { FEED_RATIONS, type FeedRation } from "./animals";
import { planLoads, type Claim } from "./loadout";

/**
 * Everything the farm keeps a store of and has to haul in: the five feed bins,
 * the gas bottles, the bedding.
 */
export type StoreId = FeedRation | "gas" | "bedding";

export const STORE_IDS: readonly StoreId[] = [...FEED_RATIONS, "gas", "bedding"];

/**
 * The stores that share a deck. Gas is one of them: a bottle is goods the farm
 * has run out of like any other, and it bids for space on the same lorry and by
 * the same rule as the feed. Bedding is not — it is bulky and dirty and has no
 * business riding on a feed order — so it is sent for on its own.
 */
const SHARED_STORES: readonly StoreId[] = [...FEED_RATIONS, "gas"];

export type StoreSeries = Record<StoreId, number[]>;

/** One store's share of a lorry's payload. */
export type TripLine = { store: StoreId; kg: number };

/**
 * What the lorry went out for.
 *
 * `supplies` is the mixed run: feed of every ration on the same deck and the gas
 * bottles alongside it. `bedding` travels alone.
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
   * and a bottle of gas that came in on the feed order carries only its share.
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

function zeroStores(): Record<StoreId, number> {
  return Object.fromEntries(STORE_IDS.map((store) => [store, 0])) as Record<StoreId, number>;
}

/** A farm that hauls nothing, used while the haulage itself is being worked out. */
export const EMPTY_HAULAGE: HaulagePlan = {
  trips: [],
  haulagePerKgByDay: emptyStoreSeries(),
  stockByDay: emptyStoreSeries(),
};

/** Kilograms below which a remainder is treated as nothing. */
const CRUMB_KG = 1e-9;

/** What each store holds, which is the only cap on what can be tipped into it. */
function capacities(config: PlannerConfig): Record<StoreId, number> {
  const stores = zeroStores();
  for (const ration of FEED_RATIONS) stores[ration] = Math.max(config.feed.binCapacityKg, 1);
  stores.gas = Math.max(config.health.gasCanisterKg * config.health.gasCanisters, 1);
  stores.bedding = Math.max(config.housing.beddingStoreKg, 1);
  return stores;
}

/** What each store's goods come in. Feed is tipped loose; the rest is not. */
function units(config: PlannerConfig, deck: number): Record<StoreId, number> {
  const stores = zeroStores();
  stores.gas = Math.min(Math.max(config.health.gasCanisterKg, 1), deck);
  stores.bedding = Math.min(Math.max(config.housing.beddingLoadKg, 1), deck);
  return stores;
}

/**
 * Works out every lorry movement a plan needs, from feeding that has already
 * been simulated. Because the schedule is read off consumption rather than
 * guessed at, no store runs dry, nothing is delivered that the herd does not go
 * on to use, and every trip carries goods it will eat, burn or lie on.
 *
 * The farm is walked day by day and asked one question each morning: **is any
 * store due?** — has anything fallen to the point where it would run out inside
 * the buffer. If nothing has, no lorry goes out. If something has, one goes out
 * carrying that store's order, and the rest of the deck is filled from whatever
 * else is closest to running out.
 *
 * That last clause is the whole of it. What used to happen was that each kind of
 * goods was scheduled on its own and then tried to beg a ride: feed was cut into
 * maximal loads, and a gas bottle rode along only if a feed run happened to fall
 * in the fortnight its yard had room to wait. It usually did not, so the farm
 * sent a 2.8 tonne lorry out for 48 kg of gas and then sent it out again a
 * fortnight later for the feed. Ranking every store by time of use and filling
 * one deck from the top of that queue turns those two journeys into one.
 */
export function planHaulage(use: StoreSeries, config: PlannerConfig): HaulagePlan {
  const days = Math.max(...STORE_IDS.map((store) => use[store]?.length ?? 0), 0);
  const deck = Math.max(config.feed.truckCapacityKg, 1);
  /** Days of cover at which a store is due: the lorry comes this far ahead. */
  const reorderAt = Math.max(config.feed.feedBufferDays, 1);
  /** Days of cover an order is sized to bring a store back up to. */
  const target = Math.max(config.feed.targetCoverDays, reorderAt + 1);
  /** Past this there is no ranking one store's urgency against another's. */
  const horizon = target + reorderAt;

  const capacity = capacities(config);
  const unit = units(config, deck);

  // Nothing below is allowed to depend on where the plan happens to stop. An
  // order is sized on the `target` days in front of it and its urgency read off
  // the `horizon` days in front of it, and both windows roll forward with the
  // day: a plan read over twelve months and the same twelve months read inside a
  // three year one have to be the same twelve months, down to the journeys.
  const held = zeroStores();
  /** Money paid in journeys that is standing in each store with the goods. */
  const haulageValue = zeroStores();
  const trips: Trip[] = [];
  const haulagePerKgByDay = emptyStoreSeries();
  const stockByDay = emptyStoreSeries();
  for (const store of STORE_IDS) {
    haulagePerKgByDay[store] = new Array<number>(days).fill(0);
    stockByDay[store] = new Array<number>(days).fill(0);
  }

  /**
   * The cover at which this store sends for a lorry.
   *
   * Normally that is the buffer the farm wants to keep in front of it. But a
   * store cannot hold a buffer bigger than itself, and one that tries to is the
   * worst thing that can happen to a haulage plan: a gas yard holding a week of
   * gas is *always* inside a week of running out, so it is due every morning and
   * sends for a lorry the moment there is room for a single bottle. That was 309
   * half-empty journeys on a twenty sow herd where 150 full ones would do.
   *
   * So the reorder point is also held to what leaves a decent run between
   * deliveries: a store is never sent for so early that the next visit would
   * fall inside the buffer. On a store with room to spare this changes nothing —
   * it is the small, fast-emptying stores it saves, and it saves them by letting
   * them run down and then filling them right up.
   */
  const dueAt = (store: StoreId, through: number): number => {
    const rate = through / target;
    if (rate <= CRUMB_KG) return reorderAt;
    const fullCover = capacity[store] / rate;
    return Math.min(reorderAt, Math.max(0, fullCover - reorderAt));
  };

  /**
   * What the herd will draw on this store over the next `span` days.
   *
   * Summed forwards from the day, one term at a time, and deliberately not read
   * off a running total of the whole plan. Two cumulative totals subtracted from
   * one another are the same number in arithmetic and not quite the same number
   * in floating point: the sum over a year and the sum over three years round
   * differently, and the difference of the two came out about 1e-10 apart. That
   * is nothing, until two bins are level in the queue for the deck and the tie
   * is broken by it — at which point a plan drawn over twelve months put 2.7
   * tonnes of creep where the same twelve months inside a three year plan put
   * weaner, and every trip after it moved. Summed forwards, the window is the
   * window whatever is behind or in front of it.
   */
  const drawOver = (store: StoreId, day: number, span: number): number => {
    const series = use[store] ?? [];
    let total = 0;
    for (let ahead = 0; ahead < span && day + ahead < days; ahead += 1) {
      total += series[day + ahead] ?? 0;
    }
    return total;
  };

  /** Days this store will last on what is in it, read off the feeding to come. */
  const coverDays = (store: StoreId, day: number): number => {
    let level = held[store];
    for (let ahead = 0; ahead < horizon && day + ahead < days; ahead += 1) {
      level -= use[store]?.[day + ahead] ?? 0;
      if (level < -CRUMB_KG) return ahead;
    }
    return horizon;
  };

  const claimFor = (store: StoreId, day: number): Claim => {
    // Enough to carry the store through the next `target` days, less what is
    // already standing in it.
    const through = drawOver(store, day, target);
    const cover = coverDays(store, day);
    return {
      store,
      coverDays: cover,
      due: cover <= dueAt(store, through),
      needKg: Math.max(0, through - held[store]),
      // Room in the store, and nothing else. Bounding this by the feeding still
      // to come would have kept the plan from ever holding stock it did not use,
      // at the price of making a small herd's whole schedule move when the
      // horizon moved: with a year left to run a bin is capped by the year, with
      // three by the bin. The farm's answer to how much it is willing to hold is
      // the size of the bin it built.
      maxKg: Math.max(0, capacity[store] - held[store]),
      unitKg: unit[store],
    };
  };

  /** Sends what the day's claims justify, and books what came in on it. */
  const send = (stores: readonly StoreId[], day: number, kind: TripKind, cost: number): void => {
    const claims = stores.map((store) => claimFor(store, day));
    const byStore = new Map(claims.map((claim) => [claim.store, claim]));
    for (const load of planLoads(claims, deck)) {
      const neededIn = Math.min(
        ...load.lines.map((line) => byStore.get(line.store)?.coverDays ?? horizon),
      );
      trips.push({
        day,
        neededFromDay: Math.min(day + neededIn, Math.max(days - 1, 0)),
        kind,
        payloadKg: load.payloadKg,
        cost,
        lines: load.lines,
      });
      for (const line of load.lines) {
        held[line.store] += line.kg;
        haulageValue[line.store] += (line.kg / load.payloadKg) * cost;
      }
    }
  };

  for (let day = 0; day < days; day += 1) {
    send(SHARED_STORES, day, "supplies", config.feed.deliveryCostPerTrip);
    send(["bedding"], day, "bedding", config.housing.beddingDeliveryCost);

    // Then the herd draws on the stores. What a kilogram carries of the journey
    // that brought it is the average over everything standing in the bin, which
    // is the only honest answer once two loads have been tipped in together.
    for (const store of STORE_IDS) {
      const perKg = held[store] > CRUMB_KG ? haulageValue[store] / held[store] : 0;
      haulagePerKgByDay[store][day] = perKg;
      const drawn = Math.min(use[store]?.[day] ?? 0, held[store]);
      held[store] = Math.max(0, held[store] - drawn);
      haulageValue[store] = Math.max(0, haulageValue[store] - drawn * perKg);
      stockByDay[store][day] = held[store] < CRUMB_KG ? 0 : held[store];
    }
  }

  trips.sort((a, b) => a.day - b.day || a.kind.localeCompare(b.kind) || b.payloadKg - a.payloadKg);

  return { trips, haulagePerKgByDay, stockByDay };
}
