import type { StoreId, TripLine } from "./haulage";

/**
 * What goes on a lorry, and how much of it.
 *
 * A journey costs what it costs whatever is on the deck, so the expensive
 * decision is not *how much* to buy but *how often to send*. The farm used to
 * make that decision one store at a time: each bin watched its own level and
 * called for a vehicle when it was low, which is how a 2.8 tonne lorry came to
 * be sent out for one 48 kg bottle of gas while five bins sat half empty.
 *
 * Here every store bids for the same deck, and they are ranked by **time of
 * use** — how many days of cover each has left. Whichever store runs out first
 * is loaded first, and once the order that triggered the trip is aboard the
 * space that is left over is filled from the same queue, in the same order,
 * with whatever the farm will want next. A trip made now for the gas is a trip
 * not made next week for the weaner feed.
 *
 * Both engines cut their loads through here. All that separates them is where
 * the claims come from: under perfect foresight they are read off feeding that
 * has already been simulated, and operationally off what is in the bin this
 * morning and what the herd has been eating lately.
 */

/** Kilograms below which a remainder is not worth loading. */
const CRUMB_KG = 1e-6;

/** One store's bid for space on a lorry, as it stands the morning it is loaded. */
export type Claim = {
  store: StoreId;
  /**
   * Days the store will last on what is standing in it and already coming.
   * This is the urgency, and the whole queue is ordered by it: the store that
   * goes empty first is served first.
   */
  coverDays: number;
  /**
   * Whether this store is a reason to send a lorry at all — its cover has
   * fallen to the reorder point. A load with no due claim on it is not sent.
   */
  due: boolean;
  /** Enough to carry the store back up to the cover the farm wants to hold. */
  needKg: number;
  /**
   * The most there is any point putting aboard: room in the store, and under
   * foresight no more than the herd will go on to use.
   */
  maxKg: number;
  /**
   * Indivisible unit, 0 where the goods are tipped loose by the kilogram. A gas
   * bottle is a bottle and a bale is a bale: a part-filled one takes the same
   * corner of the deck and the same corner of the yard as a full one.
   */
  unitKg: number;
};

/** One lorry's deck, once it has been loaded. */
export type Load = { lines: TripLine[]; payloadKg: number };

/** The queue for space: soonest empty first, and settled where two are level. */
function byUrgency(a: Claim, b: Claim): number {
  return (
    a.coverDays - b.coverDays ||
    b.needKg - a.needKg ||
    b.maxKg - a.maxKg ||
    a.store.localeCompare(b.store)
  );
}

/**
 * Kilograms to load for a claim, given what it wants and the space on offer.
 * Goods that come in units come in whole units — the order rounds up to the
 * next one, but never past the room on the deck or the room in the store.
 */
function sized(claim: Claim, want: number, deckLeft: number, roomLeft: number): number {
  if (claim.unitKg <= 0) return Math.max(0, Math.min(want, deckLeft, roomLeft));
  const units = Math.min(
    Math.ceil((want - CRUMB_KG) / claim.unitKg),
    Math.floor((deckLeft + CRUMB_KG) / claim.unitKg),
    Math.floor((roomLeft + CRUMB_KG) / claim.unitKg),
  );
  return Math.max(0, units) * claim.unitKg;
}

function put(load: Load, store: StoreId, kg: number): void {
  const already = load.lines.find((line) => line.store === store);
  if (already) already.kg += kg;
  else load.lines.push({ store, kg });
  load.payloadKg += kg;
}

/**
 * Cuts one day's wants into lorryloads.
 *
 * Nothing is sent unless some store is actually due, which is the rule that
 * stops a vehicle going out for a handful. What is due is loaded first, in
 * order of urgency, spilling onto a second deck when one will not hold it.
 * Then — and this is the part that makes the trip worth making — the deck that
 * the order did not fill is topped up from the same queue, so the lorry leaves
 * carrying what the farm would otherwise have sent for next week.
 *
 * Returns an empty list when nothing is due, which means no lorry.
 */
export function planLoads(claims: readonly Claim[], capacityKg: number): Load[] {
  const deck = Math.max(capacityKg, 1);
  const queue = claims.filter((claim) => claim.maxKg > CRUMB_KG).sort(byUrgency);
  if (!queue.some((claim) => claim.due)) return [];

  /** What is still to be loaded for each store, and what room it has left. */
  const left = new Map<StoreId, number>();
  const room = new Map<StoreId, number>();
  for (const claim of queue) {
    room.set(claim.store, claim.maxKg);
    left.set(claim.store, claim.due ? Math.min(claim.needKg, claim.maxKg) : 0);
  }

  const loads: Load[] = [];
  // ---- What the farm sent for ----------------------------------------------
  // Each pass fills one deck. A pass that moves nothing means what is left
  // cannot be carried at all — a unit bigger than the vehicle — and ends it.
  for (;;) {
    const load: Load = { lines: [], payloadKg: 0 };
    let moved = false;
    for (const claim of queue) {
      const want = left.get(claim.store) ?? 0;
      if (want <= CRUMB_KG) continue;
      const kg = sized(claim, want, deck - load.payloadKg, room.get(claim.store) ?? 0);
      if (kg <= CRUMB_KG) continue;
      put(load, claim.store, kg);
      left.set(claim.store, want - kg);
      room.set(claim.store, (room.get(claim.store) ?? 0) - kg);
      moved = true;
    }
    if (!moved) break;
    loads.push(load);
    if (![...left.values()].some((kg) => kg > CRUMB_KG)) break;
  }
  if (loads.length === 0) return [];

  // ---- The space the order did not fill ------------------------------------
  // A journey is charged once however much is on it, so whatever the farm will
  // need next rides along free. Urgency decides who gets it, which is what
  // keeps the top-up from simply loading the biggest bin every time.
  const last = loads[loads.length - 1];
  for (const claim of queue) {
    const spare = deck - last.payloadKg;
    if (spare <= CRUMB_KG) break;
    const kg = sized(claim, room.get(claim.store) ?? 0, spare, room.get(claim.store) ?? 0);
    if (kg <= CRUMB_KG) continue;
    put(last, claim.store, kg);
    room.set(claim.store, (room.get(claim.store) ?? 0) - kg);
  }

  for (const load of loads) {
    load.lines.sort((a, b) => b.kg - a.kg || a.store.localeCompare(b.store));
  }
  return loads;
}
