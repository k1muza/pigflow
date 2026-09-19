import type { PlannerConfig } from "../../config";
import { STORE_IDS, type StoreId, type Trip, type TripKind, type TripLine } from "../../sim/haulage";
import { planLoads, type Claim, type Load } from "../../sim/loadout";
import { forecastDemand, type DemandForecastResult, type ExpectedFarmState } from "./forecast";

/**
 * How the farm decides what to buy, expressed as a decision rather than as a
 * mutation.
 *
 * The old shape of this was a method on the stores that looked at the bins, made
 * up its mind and booked a lorry in the same breath. That works for one rule and
 * nothing else: a second rule cannot be written without either copying the
 * booking or threading a flag through it, and neither rule can be tested without
 * a farm around it.
 *
 * So the decision is now a value. A policy is handed an immutable picture of the
 * farm — the stores as they stand, the herd as it stands, the configuration —
 * and returns what it would do. Booking it is somebody else's job. Two things
 * follow: the existing reorder rule and the rolling planner become the same kind
 * of object and are interchangeable, and a decision can be asserted on in a test
 * without a `World`, a ledger or a day being run.
 *
 * Three operational policies live here.
 *
 * {@link ReorderPointProcurementPolicy} is the farm's existing behaviour, lifted
 * out of the stores without a figure moving and held to that by a parity test.
 * Cover is read off the last week's consumption; a store that has fallen to the
 * reorder point sends a lorry; everything close behind rides along.
 *
 * {@link RollingCoverProcurementPolicy} is the earlier fixed-cover experiment:
 * it forecasts what the herd standing here today will eat and buys compatible
 * stores up to one configured common date.
 *
 * {@link BalancedLoadProcurementPolicy} is the capacity-balanced rule: a due
 * store justifies one trip, then the truck itself is the budget and the next
 * package goes to whichever compatible store would otherwise become risky first.
 */

export type OperationalProcurementPolicy = "reorder-point" | "rolling-cover" | "balanced-load";

/** Kilograms below which a remainder is not worth ordering. */
const CRUMB_KG = 1e-6;

/**
 * How finely bulk feed is shared out when a deck will not hold everything.
 *
 * Bagged goods share out in bags, and that is what makes the max-min rule work:
 * the next bag goes to whichever bin runs out first. Feed blown in loose has no
 * such unit, and handing a loose store its whole requirement in one go would let
 * it take a deck four other bins were queueing for. So it is shared out in
 * notional sacks of this size and the arithmetic is the same for both. It never
 * changes the quantity ordered — only the order the deck is filled in.
 */
const LOOSE_STEP_KG = 25;

/** A ceiling on one decision's lorries, so a pathological plan cannot spin. */
const MAX_TRIPS_PER_DECISION = 64;

/** Days of forecast held in hand for loads that spill onto later delivery days. */
const SPILL_SLACK_DAYS = 14;

/**
 * The balanced policy deliberately uses two horizons. The daily risk check only
 * only needs enough future to prove whether a store will cross its safety floor
 * before a normal delivery can land. `forecast()` already adds lead time and the
 * configured safety window, so one extra day is sufficient for the boundary.
 * The longer horizon is evaluated only on mornings when a trip is actually
 * required, so the allocator can rank stores after the deck is filled. Neither
 * horizon is a stock target.
 */
const BALANCED_RISK_LOOKAHEAD_DAYS = 1;
const BALANCED_ALLOCATION_LOOKAHEAD_DAYS = 180;

export type StoreQuantities = Record<StoreId, number>;

export function zeroStores(): StoreQuantities {
  return Object.fromEntries(STORE_IDS.map((store) => [store, 0])) as StoreQuantities;
}

// ------------------------------------------------------------------ the inputs

/** One order placed and not yet landed, as the planner is allowed to see it. */
export type PendingOrderView = {
  id: number;
  placedDay: number;
  arrivesDay: number;
  emergency: boolean;
  lines: readonly TripLine[];
};

/** One invoice the supplier will take out of the bank when his terms fall due. */
export type PendingPaymentView = { dueDay: number; amount: number };

/**
 * The stores as they stand this morning, before anything is ordered. Everything
 * a procurement policy may read about the farm's goods and money is here, and
 * nothing that is not a fact about today is.
 */
export type ProcurementSnapshot = {
  day: number;
  held: StoreQuantities;
  onOrder: StoreQuantities;
  capacities: StoreQuantities;
  /** What each store's goods come in — bags, canisters, loads, or 0 for loose. */
  unitKg: StoreQuantities;
  listPrices: StoreQuantities;
  /**
   * What the herd has drawn on each store lately, per day. It is the whole of
   * the reorder rule's knowledge of appetite, and the rolling planner does not
   * read it at all — which is the difference between the two policies.
   */
  recentDailyKg: StoreQuantities;
  pendingOrders: readonly PendingOrderView[];
  duePayments: readonly PendingPaymentView[];
  cash: number;
  workingCapitalTarget: number;
};

/** What produces the demand curve a rolling plan is cut from. */
export type Forecaster = (
  farm: ExpectedFarmState,
  config: PlannerConfig,
  throughDay: number,
) => DemandForecastResult;

export type ProcurementPlanningContext = {
  config: Readonly<PlannerConfig>;
  stores: ProcurementSnapshot;
  farm: ExpectedFarmState;
};

// ----------------------------------------------------------------- the output

export type PlannedOrderLine = {
  store: StoreId;
  kg: number;
  units: number;
  /** Day this store was projected to reach its safety floor before the order. */
  projectedExhaustionDayBefore: number | null;
  /** And after it, which is the date the policy is trying to make common. */
  projectedExhaustionDayAfter: number | null;
};

export type ProcurementDecision = {
  day: number;
  policy: OperationalProcurementPolicy;
  dispatch: "none" | "normal" | "emergency";
  /** The day the first load lands, or null when nothing is sent for. */
  arrivesDay: number | null;
  /**
   * Fixed target for rolling-cover; achieved limiting coverage date for
   * balanced-load; null where the policy has no forward target/read-out.
   */
  targetDay: number | null;
  lines: readonly PlannedOrderLine[];
  trips: readonly Trip[];
  expectedGoodsCost: number;
  expectedDeliveryCost: number;
  /** What the stores are worth once this load has been put away. */
  projectedInventoryValue: number;
  /** The lowest the bank goes on what is already owed plus what this commits. */
  projectedMinimumCash: number;
  /** Cash needed on top of that to hold the working capital the plan wants kept. */
  additionalFundingRequired: number;
  /** Stores limited by the active policy's storage/package/protection constraints. */
  constrainedStores: readonly StoreId[];
  /** The day the planner currently expects to send the next load. */
  nextDispatchDay: number | null;
  reason: string;
};

export interface ProcurementPolicy {
  readonly id: OperationalProcurementPolicy;
  /** The morning's ordering, before anything is fed. */
  decide(context: ProcurementPlanningContext): ProcurementDecision;
  /**
   * The load sent for when a store has already run dry, which is a different
   * question: the lorry is coming at a premium either way, so the whole
   * compatible load is recalculated before it leaves rather than after.
   */
  decideEmergency(
    context: ProcurementPlanningContext,
    shortfall: Partial<StoreQuantities>,
  ): ProcurementDecision;
}

/** The lorry a store's goods travel on. Bedding does not ride with the feed. */
export function tripKindOf(store: StoreId): TripKind {
  return store === "bedding" ? "bedding" : "supplies";
}

export function emptyDecision(
  day: number,
  policy: OperationalProcurementPolicy,
  reason: string,
  nextDispatchDay: number | null = null,
): ProcurementDecision {
  return {
    day,
    policy,
    dispatch: "none",
    arrivesDay: null,
    targetDay: null,
    lines: [],
    trips: [],
    expectedGoodsCost: 0,
    expectedDeliveryCost: 0,
    projectedInventoryValue: 0,
    projectedMinimumCash: 0,
    additionalFundingRequired: 0,
    constrainedStores: [],
    nextDispatchDay,
    reason,
  };
}

/**
 * Dresses the loads the shared planner cut as trips: the day they land, what
 * they are, and the journey they cost. The cost is per lorry and not per
 * kilogram, which is the whole reason both policies work to fill one.
 */
export function tripsFor(
  loads: readonly Load[],
  day: number,
  kind: TripKind,
  tripCost: number,
): Trip[] {
  return loads.map((load) => ({
    day,
    neededFromDay: day,
    kind,
    payloadKg: load.payloadKg,
    cost: tripCost,
    lines: load.lines,
  }));
}

/**
 * Cuts a day's claims into lorries: feed and gas on one deck, bedding on its
 * own. Both policies end here, because a vehicle is a vehicle whatever decided
 * to fill it.
 */
export function planTrips(
  config: PlannerConfig,
  claims: readonly Claim[],
  arrivesDay: number,
  emergency: boolean,
): Trip[] {
  const premium = emergency ? 1 + config.feed.emergencyPremiumPct / 100 : 1;
  const deck = Math.max(config.feed.truckCapacityKg, 1);
  const supplies = tripsFor(
    planLoads(
      claims.filter((claim) => claim.store !== "bedding"),
      deck,
    ),
    arrivesDay,
    "supplies",
    config.feed.deliveryCostPerTrip * premium,
  );
  const bedding = tripsFor(
    planLoads(
      claims.filter((claim) => claim.store === "bedding"),
      deck,
    ),
    arrivesDay,
    "bedding",
    config.housing.beddingDeliveryCost * premium,
  );
  return [...supplies, ...bedding];
}

// ------------------------------------------------------ costing a decision out

/**
 * What a decision commits, what it leaves standing in the stores, and what it
 * does to the bank.
 *
 * Supplier terms must not make a load look free because the money falls beyond
 * the horizon. The goods are committed on the day they are ordered and the cash
 * moves on the day the invoice falls due, and both are reported. Nothing here is
 * posted anywhere: a projection is a read-out, not an entry.
 */
function costOf(
  context: ProcurementPlanningContext,
  trips: readonly Trip[],
  emergency: boolean,
  throughDay: number,
): Pick<
  ProcurementDecision,
  | "expectedGoodsCost"
  | "expectedDeliveryCost"
  | "projectedInventoryValue"
  | "projectedMinimumCash"
  | "additionalFundingRequired"
> {
  const { config, stores } = context;
  const premium = emergency ? 1 + config.feed.emergencyPremiumPct / 100 : 1;
  let goods = 0;
  let delivery = 0;
  const raised: PendingPaymentView[] = [];
  for (const trip of trips) {
    delivery += trip.cost;
    let tripGoods = 0;
    for (const line of trip.lines) tripGoods += line.kg * stores.listPrices[line.store] * premium;
    goods += tripGoods;
    raised.push({
      dueDay: trip.day + config.feed.supplierPaymentDays,
      amount: tripGoods + trip.cost,
    });
  }

  let inventory = goods;
  for (const store of STORE_IDS) inventory += stores.held[store] * stores.listPrices[store];

  const payments = [...stores.duePayments, ...raised]
    .filter((payment) => payment.dueDay <= throughDay)
    .sort((a, b) => a.dueDay - b.dueDay);
  let cash = stores.cash;
  let lowest = cash;
  for (const payment of payments) {
    cash -= payment.amount;
    if (cash < lowest) lowest = cash;
  }

  return {
    expectedGoodsCost: goods,
    expectedDeliveryCost: delivery,
    projectedInventoryValue: inventory,
    projectedMinimumCash: lowest,
    additionalFundingRequired: Math.max(0, stores.workingCapitalTarget - lowest),
  };
}

function roomIn(stores: ProcurementSnapshot, store: StoreId): number {
  return Math.max(0, stores.capacities[store] - stores.held[store] - stores.onOrder[store]);
}

// ------------------------------------------------------ the reorder-point rule

/**
 * The rule the farm has always run on, lifted out of the stores and put behind
 * the policy interface without a figure moving.
 *
 * Each store says how long what is in it and already coming will last at the
 * rate the herd has been going through it. A store that has fallen far enough to
 * run out before a load ordered today could land is due, and one due store is
 * what sends a lorry. Everything else then queues for the space that order left
 * on the deck, in the same order of cover, and rides along for nothing.
 *
 * It has one blind spot, and it is the reason the rolling policy exists: the
 * only thing it knows about appetite is the last week of it. A farrowing due on
 * Friday is invisible to it until the sows have eaten through Saturday.
 */
export class ReorderPointProcurementPolicy implements ProcurementPolicy {
  readonly id = "reorder-point" as const;

  constructor(private readonly forecaster: Forecaster = forecastDemand) {}

  decide(context: ProcurementPlanningContext): ProcurementDecision {
    const { config, stores } = context;
    const { feed } = config;
    const reorderAt = Math.max(feed.reorderCoverDays, 1);
    const target = Math.max(feed.targetCoverDays, reorderAt + 1);
    const forecastDays = feed.deliveryLeadDays + target + feed.safetyCoverDays;
    const forecast = this.forecaster(
      context.farm,
      config,
      stores.day + Math.max(0, forecastDays - 1),
    );

    const claims: Claim[] = [];
    for (const store of STORE_IDS) {
      const room = roomIn(stores, store);
      if (room <= CRUMB_KG) continue;
      const rate = stores.recentDailyKg[store];
      const position = stores.held[store] + stores.onOrder[store];
      const curve = forecast.demandKg[store];
      const protectedDemand = curve
        .slice(0, feed.deliveryLeadDays + feed.safetyCoverDays)
        .reduce((sum, kg) => sum + kg, 0);
      const targetDemand = curve
        .slice(0, feed.deliveryLeadDays + target)
        .reduce((sum, kg) => sum + kg, 0);
      // A store the herd is not drawing on never runs out, so it is never due —
      // but it can still be topped up when a lorry is going anyway.
      const cover = rate > CRUMB_KG ? position / rate : Number.POSITIVE_INFINITY;
      // A supplier will not send a lorry for a handful, so a small order rounds
      // up — but never past what there is room to put away.
      const need = Math.max(
        targetDemand - position,
        rate * target - position,
        Math.min(feed.minimumOrderKg, room),
      );
      // A store cannot hold a buffer bigger than itself. One that tries to — a
      // gas yard holding less than a week of gas against a week's reorder point
      // — is inside its own reorder point every morning of its life and sends
      // for a lorry the moment there is room for one bottle. So the point is
      // also held to what leaves a decent run between deliveries.
      const fullCover =
        rate > CRUMB_KG ? stores.capacities[store] / rate : Number.POSITIVE_INFINITY;
      const sendAt = Math.min(reorderAt, Math.max(0, fullCover - reorderAt));
      claims.push({
        store,
        coverDays: cover,
        // Cover has to carry the herd until a load ordered today could land.
        due:
          position <= protectedDemand + CRUMB_KG ||
          cover <= sendAt + feed.deliveryLeadDays,
        needKg: Math.max(0, need),
        maxKg: room,
        unitKg: stores.unitKg[store],
      });
    }

    const arrivesDay = stores.day + feed.deliveryLeadDays;
    const trips = planTrips(config, claims, arrivesDay, false);
    if (trips.length === 0) {
      return emptyDecision(stores.day, this.id, "no store has fallen to its reorder point");
    }
    return this.book(context, trips, arrivesDay, false, "cover fell to the reorder point");
  }

  decideEmergency(
    context: ProcurementPlanningContext,
    shortfall: Partial<StoreQuantities>,
  ): ProcurementDecision {
    const { config, stores } = context;
    const { feed } = config;
    const cover = Math.max(feed.reorderCoverDays, 1);
    const claims: Claim[] = [];
    for (const store of STORE_IDS) {
      const room = roomIn(stores, store);
      if (room <= CRUMB_KG) continue;
      const short = shortfall[store] ?? 0;
      const rate = stores.recentDailyKg[store];
      const position = stores.held[store] + stores.onOrder[store];
      claims.push({
        store,
        coverDays: rate > CRUMB_KG ? position / rate : Number.POSITIVE_INFINITY,
        // Only a store that actually ran short is a reason to pay the premium.
        due: short > CRUMB_KG,
        needKg: Math.max(short, rate * cover),
        maxKg: room,
        unitKg: stores.unitKg[store],
      });
    }
    const arrivesDay = stores.day + feed.emergencyLeadDays;
    const trips = planTrips(config, claims, arrivesDay, true);
    if (trips.length === 0) return emptyDecision(stores.day, this.id, "no store ran short");
    return this.book(context, trips, arrivesDay, true, "store empty");
  }

  private book(
    context: ProcurementPlanningContext,
    trips: readonly Trip[],
    arrivesDay: number,
    emergency: boolean,
    reason: string,
  ): ProcurementDecision {
    const { stores } = context;
    const kgByStore = zeroStores();
    for (const trip of trips) for (const line of trip.lines) kgByStore[line.store] += line.kg;
    const lines: PlannedOrderLine[] = STORE_IDS.filter(
      (store) => kgByStore[store] > CRUMB_KG,
    ).map((store) => {
      const unit = stores.unitKg[store];
      const rate = stores.recentDailyKg[store];
      const standing = stores.held[store] + stores.onOrder[store];
      return {
        store,
        kg: kgByStore[store],
        units: unit > 0 ? Math.round(kgByStore[store] / unit) : kgByStore[store],
        projectedExhaustionDayBefore:
          rate > CRUMB_KG ? stores.day + Math.floor(standing / rate) : null,
        projectedExhaustionDayAfter:
          rate > CRUMB_KG ? stores.day + Math.floor((standing + kgByStore[store]) / rate) : null,
      };
    });
    return {
      day: stores.day,
      policy: this.id,
      dispatch: emergency ? "emergency" : "normal",
      arrivesDay,
      targetDay: null,
      lines,
      trips: [...trips],
      constrainedStores: [],
      nextDispatchDay: null,
      reason,
      ...costOf(context, trips, emergency, arrivesDay + context.config.feed.targetCoverDays),
    };
  }
}

// ------------------------------------------------------------ the rolling plan

/**
 * One store's position across the whole forecast, in the two arrays the coverage
 * arithmetic needs.
 *
 * `need[i]` is the kilograms this store is short of its safety floor `i` days
 * from now, given what is standing in it and every load already confirmed.
 * Positive means it has gone under; negative is the cushion it still has.
 * Everything the planner asks — when does this run out, how much brings it to
 * the target, is it still safe when a later lorry arrives — is a question about
 * that one array, which keeps both fixed-cover and capacity-balanced planning
 * cheap enough to redo every morning.
 *
 * `peak[i]` is the running maximum of `need` from the arrival day onwards. It is
 * non-decreasing, so "the first day this store goes under, given x kilograms
 * delivered" is a binary search rather than a walk — and the answer moves the
 * right way as x grows, which is what makes the max-min allocation terminate.
 */
type StorePosition = {
  store: StoreId;
  arrivalIndex: number;
  need: readonly number[];
  peak: readonly number[];
  /** Index of the first day the store is under its floor with nothing added. */
  riskIndex: number | null;
  /** Index of the first day it is physically empty, which is a different day. */
  emptyIndex: number | null;
  /** Kilograms there is room to put away, now and for the rest of the horizon. */
  roomKg: number;
  /**
   * Kilograms required through the caller's allocation horizon. For rolling-cover
   * that is the fixed target date; for balanced-load it is only a far look-ahead
   * cap so the deck is never filled with goods having no visible future demand.
   */
  targetKg: number;
  /** Kilograms it must have to be safe from the lorry landing until then. */
  protectKg: number;
  unitKg: number;
};

/** Running totals of a store's forecast demand: `cum[i]` covers days [0, i). */
function cumulative(demand: readonly number[]): number[] {
  const cum = new Array<number>(demand.length + 1).fill(0);
  for (let i = 0; i < demand.length; i += 1) cum[i + 1] = cum[i] + demand[i];
  return cum;
}

/** Confirmed deliveries landing on or before each day, cumulatively. */
function arrivalsOf(
  store: StoreId,
  orders: readonly PendingOrderView[],
  committed: readonly { arrivesDay: number; kg: number; store: StoreId }[],
  fromDay: number,
  days: number,
): number[] {
  const perDay = new Array<number>(days + 1).fill(0);
  const put = (arrivesDay: number, kg: number) => {
    perDay[Math.max(0, Math.min(days, arrivesDay - fromDay))] += kg;
  };
  for (const order of orders) {
    for (const line of order.lines) {
      if (line.store === store) put(order.arrivesDay, line.kg);
    }
  }
  for (const load of committed) {
    if (load.store === store) put(load.arrivesDay, load.kg);
  }
  const running = new Array<number>(days + 1).fill(0);
  let total = 0;
  for (let i = 0; i <= days; i += 1) {
    total += perDay[i];
    running[i] = total;
  }
  return running;
}

/** The first index at or after `from` where a non-decreasing series exceeds a value. */
function firstAbove(series: readonly number[], from: number, value: number): number | null {
  let low = Math.max(0, from);
  let high = series.length - 1;
  if (low > high || series[high] <= value) return null;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (series[mid] > value) high = mid;
    else low = mid + 1;
  }
  return low;
}

/**
 * Works one store's position out from the forecast and what is already coming.
 *
 * The identity the whole policy rests on, derived once here:
 *
 * ```text
 * stock on day i         = held + arrivals[i] - demand[0, i)
 * safety floor on day i  = demand[i, i + safetyCoverDays)
 * need[i]                = floor - stock
 *                        = cum[i + safety] - arrivals[i] - held
 * ```
 *
 * The demand terms collapse, so coverage calculations come to one subtraction a
 * day rather than a second simulation. Existing stock and pending deliveries are
 * deducted once and only once; the caller decides how far into `peak` it wants
 * to allocate.
 */
function positionOf(
  store: StoreId,
  stores: ProcurementSnapshot,
  forecast: DemandForecastResult,
  committed: readonly { arrivesDay: number; kg: number; store: StoreId }[],
  arrivalIndex: number,
  safetyDays: number,
  targetIndex: number,
): StorePosition {
  const demand = forecast.demandKg[store];
  const days = demand.length;
  const cum = cumulative(demand);
  const supply = arrivalsOf(store, stores.pendingOrders, committed, forecast.fromDay, days);
  const held = stores.held[store];

  const span = Math.max(1, days - safetyDays);
  const need = new Array<number>(span).fill(0);
  for (let i = 0; i < span; i += 1) need[i] = cum[i + safetyDays] - supply[i] - held;

  let riskIndex: number | null = null;
  let emptyIndex: number | null = null;
  for (let i = 0; i < span; i += 1) {
    if (riskIndex === null && need[i] > CRUMB_KG) riskIndex = i;
    if (emptyIndex === null && held + supply[i] - cum[i] < -CRUMB_KG) emptyIndex = i;
    if (riskIndex !== null && emptyIndex !== null) break;
  }

  const from = Math.min(Math.max(0, arrivalIndex), span - 1);
  const peak = new Array<number>(span).fill(Number.NEGATIVE_INFINITY);
  let running = Number.NEGATIVE_INFINITY;
  for (let i = from; i < span; i += 1) {
    running = Math.max(running, need[i]);
    peak[i] = running;
  }

  // Room is not only the room on the day the lorry comes. A load put away today
  // has to still fit when the next confirmed delivery lands on top of it, so the
  // binding day is whichever one the store is fullest on.
  let fullest = 0;
  for (let i = from; i < days; i += 1) fullest = Math.max(fullest, held + supply[i] - cum[i]);
  const roomKg = Math.max(0, stores.capacities[store] - fullest);

  const target = Math.min(span - 1, Math.max(from, targetIndex));
  const protectIndex = Math.min(span - 1, from + safetyDays);
  return {
    store,
    arrivalIndex: from,
    need,
    peak,
    riskIndex,
    emptyIndex,
    roomKg,
    // A confirmed delivery later in the horizon can make `need` fall again.
    // Buying only the amount missing on the target date would then leave the
    // store below its safety floor before that delivery lands. The binding
    // requirement is the greatest shortfall from this arrival through the
    // common target date, not merely the shortfall on the final day.
    targetKg: Math.max(0, peak[target]),
    protectKg: Math.max(0, peak[protectIndex]),
    unitKg: stores.unitKg[store],
  };
}

/** The day this store next touches its safety floor, given kilograms delivered. */
function coverIndex(position: StorePosition, kg: number): number {
  const index = firstAbove(position.peak, position.arrivalIndex, kg);
  return index === null ? position.peak.length : index;
}

/**
 * The rolling ninety-day planner.
 *
 * Every morning it forecasts what the farm standing here will eat, projects each
 * store forward through the loads already coming, and asks one question: is
 * anything going to reach its safety floor before a lorry ordered today could
 * land? If not, it buys nothing. If so, it recalculates the whole compatible
 * load — not just the store that triggered it — up to one common date ninety
 * days past the delivery, cuts it to bags and canisters, holds it to the bins
 * and the deck, and books only today's order.
 *
 * Tomorrow it does the whole thing again from whatever actually happened. No
 * future order is ever committed, which is what makes the plan honest: the farm
 * may see next month's expected delivery, and next month's delivery may move.
 */
export class RollingCoverProcurementPolicy implements ProcurementPolicy {
  readonly id = "rolling-cover" as const;

  /**
   * Where the demand curve comes from. It is the real forecaster in every run;
   * the seam exists so the allocation can be held to a curve chosen by hand in a
   * test, and so a shadow run can be fed a curve from somewhere else without the
   * ordering rules being copied to go with it.
   */
  constructor(private readonly forecaster: Forecaster = forecastDemand) {}

  decide(context: ProcurementPlanningContext): ProcurementDecision {
    const { config, stores } = context;
    const { feed } = config;
    const forecast = this.forecast(context, feed.deliveryLeadDays);

    // The daily risk check: cheap, and run whether or not anything is ordered.
    // It is what turns a ninety-day plan into a rolling one — a bin going down
    // faster than the forecast said shows up here the morning it starts to, not
    // the morning it is empty.
    const risk = this.riskCheck(context, forecast, feed.deliveryLeadDays);
    if (risk.emergency.length > 0) {
      return this.plan(
        context,
        this.forecast(context, feed.emergencyLeadDays),
        risk.emergency,
        feed.emergencyLeadDays,
        true,
        "a store cannot be held until a normal delivery could land",
      );
    }
    if (risk.normal.length > 0) {
      return this.plan(context, forecast, risk.normal, feed.deliveryLeadDays, false, risk.reason);
    }
    return emptyDecision(
      stores.day,
      this.id,
      "every store is covered past the day a load ordered today would land",
      risk.nextDispatchDay,
    );
  }

  decideEmergency(
    context: ProcurementPlanningContext,
    shortfall: Partial<StoreQuantities>,
  ): ProcurementDecision {
    const { config, stores } = context;
    const kinds = new Set<TripKind>();
    for (const store of STORE_IDS) {
      if ((shortfall[store] ?? 0) > CRUMB_KG) kinds.add(tripKindOf(store));
    }
    if (kinds.size === 0) return emptyDecision(stores.day, this.id, "no store ran short");
    return this.plan(
      context,
      this.forecast(context, config.feed.emergencyLeadDays),
      [...kinds],
      config.feed.emergencyLeadDays,
      true,
      "a store ran dry before its load landed",
    );
  }

  /**
   * The demand curve, run far enough forward to answer the coverage question:
   * the lead time to get the goods here, the cover being bought, the safety
   * period sitting past the end of it, and a fortnight in hand for loads that
   * spill onto later delivery days.
   */
  private forecast(context: ProcurementPlanningContext, leadDays: number): DemandForecastResult {
    const { config, stores, farm } = context;
    const horizon =
      leadDays +
      config.feed.rollingTargetCoverDays +
      config.feed.safetyCoverDays +
      SPILL_SLACK_DAYS;
    return this.forecaster(farm, config, stores.day + horizon);
  }

  /**
   * Which lorries have to go today, and why.
   *
   * A store that will reach its safety floor on or before the day a normal load
   * would land is a reason to order now. A store that will be physically empty
   * before then cannot be saved by a normal load at all, and is the only thing
   * that justifies the premium — dipping into a safety buffer is what a safety
   * buffer is for, and paying 35% to avoid it would be the policy buying its own
   * caution.
   */
  private riskCheck(
    context: ProcurementPlanningContext,
    forecast: DemandForecastResult,
    leadDays: number,
  ): { normal: TripKind[]; emergency: TripKind[]; nextDispatchDay: number | null; reason: string } {
    const { config, stores } = context;
    const normal = new Set<TripKind>();
    const emergency = new Set<TripKind>();
    let soonestRisk: number | null = null;
    let firstStore: StoreId | null = null;

    for (const store of STORE_IDS) {
      const position = positionOf(
        store,
        stores,
        forecast,
        [],
        leadDays,
        config.feed.safetyCoverDays,
        leadDays + config.feed.rollingTargetCoverDays,
      );
      if (position.riskIndex === null) continue;
      if (soonestRisk === null || position.riskIndex < soonestRisk) {
        soonestRisk = position.riskIndex;
        firstStore = store;
      }
      if (position.emptyIndex !== null && position.emptyIndex < leadDays) {
        emergency.add(tripKindOf(store));
      } else if (position.riskIndex <= leadDays) {
        normal.add(tripKindOf(store));
      }
    }

    // A kind going out at a premium does not drag a merely-due kind onto the
    // same invoice: bedding that is comfortable for another fortnight has no
    // business paying for the feed lorry's hurry.
    for (const kind of emergency) normal.delete(kind);

    return {
      normal: [...normal],
      emergency: [...emergency],
      nextDispatchDay:
        soonestRisk === null ? null : stores.day + Math.max(0, soonestRisk - leadDays),
      reason:
        firstStore === null
          ? "a store is due"
          : firstStore + " is projected to reach its safety stock",
    };
  }

  /**
   * Buys every compatible store up to the common date and cuts the result into
   * lorries.
   *
   * The allocation is the part worth reading. Goods go out one purchase unit at
   * a time, and each unit goes to whichever store is projected to run out first
   * on what it has been given so far. That single rule does all the work the
   * specification asks for: it protects the lead time before it chases the
   * ninety days, it raises the least-covered store rather than the largest bin,
   * and because it counts in bags and canisters it lands every store on the same
   * date to within one package without ever being told to.
   *
   * A deck is a journey and not a limit on the order: when the requirement will
   * not fit, the next lorry follows it, and when the day's allowance of lorries
   * runs out the rest are scheduled for the following days — with each later
   * arrival's storage and consumption recalculated rather than assumed.
   */
  private plan(
    context: ProcurementPlanningContext,
    forecast: DemandForecastResult,
    kinds: readonly TripKind[],
    leadDays: number,
    emergency: boolean,
    reason: string,
  ): ProcurementDecision {
    const { config, stores } = context;
    const { feed } = config;
    const day = stores.day;
    const arrivesDay = day + leadDays;
    const targetDay = arrivesDay + feed.rollingTargetCoverDays;
    const targetIndex = leadDays + feed.rollingTargetCoverDays;
    const deck = Math.max(feed.truckCapacityKg, 1);
    const premium = emergency ? 1 + feed.emergencyPremiumPct / 100 : 1;
    const tripsPerDay = Math.max(1, feed.maxSupplyTripsPerDay);

    const committed: { arrivesDay: number; kg: number; store: StoreId }[] = [];
    const trips: Trip[] = [];
    const constrained = new Set<StoreId>();
    const before = new Map<StoreId, number | null>();
    const ordered = zeroStores();

    for (const kind of kinds) {
      const members = STORE_IDS.filter((store) => tripKindOf(store) === kind);
      let arrivalIndex = leadDays;
      let tripsOnDay = 0;

      while (trips.length < MAX_TRIPS_PER_DECISION) {
        const positions = members.map((store) =>
          positionOf(
            store,
            stores,
            forecast,
            committed,
            arrivalIndex,
            feed.safetyCoverDays,
            targetIndex,
          ),
        );
        for (const position of positions) {
          if (before.has(position.store)) continue;
          before.set(position.store, position.riskIndex === null ? null : day + position.riskIndex);
        }

        // A later lorry may only carry stores that will still be standing when
        // it arrives. One that will not has to be served by an earlier load, and
        // where no earlier load could hold it that is a constraint to report
        // rather than a promise to make.
        const eligible = positions.filter((position) => {
          if (position.roomKg <= CRUMB_KG) return false;
          if (position.targetKg <= CRUMB_KG) return false;
          if (
            arrivalIndex > leadDays &&
            position.emptyIndex !== null &&
            position.emptyIndex < arrivalIndex
          ) {
            constrained.add(position.store);
            return false;
          }
          return true;
        });
        if (eligible.length === 0) break;

        const load = fillDeck(eligible, deck);
        const payloadKg = [...load.values()].reduce((kg, line) => kg + line, 0);
        if (payloadKg <= CRUMB_KG) break;

        const lines: TripLine[] = [];
        for (const store of STORE_IDS) {
          const kg = load.get(store) ?? 0;
          if (kg <= CRUMB_KG) continue;
          lines.push({ store, kg });
          committed.push({ arrivesDay: day + arrivalIndex, kg, store });
          ordered[store] += kg;
        }
        lines.sort((a, b) => b.kg - a.kg || a.store.localeCompare(b.store));
        trips.push({
          day: day + arrivalIndex,
          neededFromDay: day + arrivalIndex,
          kind,
          payloadKg,
          cost:
            (kind === "bedding" ? config.housing.beddingDeliveryCost : feed.deliveryCostPerTrip) *
            premium,
          lines,
        });

        // Done when every store on this queue reached the target on this deck.
        const short = eligible.some(
          (position) => (load.get(position.store) ?? 0) + CRUMB_KG < position.targetKg,
        );
        if (!short) break;

        tripsOnDay += 1;
        if (tripsOnDay >= tripsPerDay) {
          // Until supplier operating calendars are modelled, the next available
          // delivery day is simply the next one.
          arrivalIndex += 1;
          tripsOnDay = 0;
        }
      }
    }

    if (trips.length === 0) {
      return emptyDecision(day, this.id, "nothing could be loaded: every store is full");
    }

    // What the plan achieved, store by store, read back off the final allocation
    // rather than off what it set out to do.
    const lines: PlannedOrderLine[] = [];
    for (const store of STORE_IDS) {
      if (ordered[store] <= CRUMB_KG) continue;
      const position = positionOf(
        store,
        stores,
        forecast,
        committed,
        leadDays,
        feed.safetyCoverDays,
        targetIndex,
      );
      if (position.targetKg > CRUMB_KG) constrained.add(store);
      lines.push({
        store,
        kg: ordered[store],
        units:
          stores.unitKg[store] > 0
            ? Math.round(ordered[store] / stores.unitKg[store])
            : ordered[store],
        projectedExhaustionDayBefore: before.get(store) ?? null,
        projectedExhaustionDayAfter:
          position.riskIndex === null ? null : day + position.riskIndex,
      });
    }

    return {
      day,
      policy: this.id,
      dispatch: emergency ? "emergency" : "normal",
      arrivesDay,
      targetDay,
      lines,
      trips,
      constrainedStores: STORE_IDS.filter((store) => constrained.has(store)),
      nextDispatchDay: null,
      reason,
      ...costOf(context, trips, emergency, targetDay),
    };
  }
}

/**
 * Loads one deck by the max-min rule: the next package goes to whichever store
 * is covered for the shortest time on what it has been given so far.
 *
 * Protection comes first — every store on the queue has to be safe from the day
 * the lorry lands through its safety period before any of them is topped up
 * towards ninety days — and after that it is one queue, strictly by the date
 * each store would next touch its floor, settled by store order where two are
 * level. That tie-break is the whole of the determinism guarantee for this step.
 */
function fillDeck(positions: readonly StorePosition[], deck: number): Map<StoreId, number> {
  const load = new Map<StoreId, number>();
  let deckLeft = deck;

  const got = (position: StorePosition) => load.get(position.store) ?? 0;
  const fits = (position: StorePosition, step: number) =>
    step <= deckLeft + CRUMB_KG && got(position) + step <= position.roomKg + CRUMB_KG;
  const give = (position: StorePosition, step: number) => {
    load.set(position.store, got(position) + step);
    deckLeft -= step;
  };
  const stepFor = (position: StorePosition, want: number) =>
    position.unitKg > 0 ? position.unitKg : Math.min(LOOSE_STEP_KG, want);

  // ---- the lead time and the safety period ---------------------------------
  const queue = [...positions].sort(
    (a, b) =>
      coverIndex(a, 0) - coverIndex(b, 0) ||
      STORE_IDS.indexOf(a.store) - STORE_IDS.indexOf(b.store),
  );
  for (const position of queue) {
    while (got(position) + CRUMB_KG < position.protectKg) {
      const step = stepFor(position, position.protectKg - got(position));
      if (step <= CRUMB_KG || !fits(position, step)) break;
      give(position, step);
    }
  }

  // ---- then extend the least-covered store towards the caller's horizon ----
  for (;;) {
    let best: StorePosition | null = null;
    let bestCover = Number.POSITIVE_INFINITY;
    let bestStep = 0;
    for (const position of positions) {
      const have = got(position);
      if (have + CRUMB_KG >= position.targetKg) continue;
      const step = stepFor(position, position.targetKg - have);
      if (step <= CRUMB_KG || !fits(position, step)) continue;
      const cover = coverIndex(position, have);
      if (best === null || cover < bestCover) {
        best = position;
        bestCover = cover;
        bestStep = step;
      }
    }
    if (best === null) break;
    give(best, bestStep);
  }

  return load;
}


/**
 * Capacity-balanced operational procurement ("zvipererane").
 *
 * A store reaching its safety floor is what justifies the journey. Once the
 * journey exists, the vehicle capacity is the budget: the next bag/canister goes
 * to whichever compatible store would otherwise hit its safety floor first.
 * There is no configured cover target and one decision does not create a train
 * of lorries merely to chase one.
 */
export class BalancedLoadProcurementPolicy implements ProcurementPolicy {
  readonly id = "balanced-load" as const;

  constructor(private readonly forecaster: Forecaster = forecastDemand) {}

  decide(context: ProcurementPlanningContext): ProcurementDecision {
    const { config, stores } = context;
    // Most mornings need only the cheap near-term risk check. The longer demand
    // walk is deferred until a truck is genuinely due.
    const riskForecast = this.forecast(
      context,
      config.feed.deliveryLeadDays,
      BALANCED_RISK_LOOKAHEAD_DAYS,
    );
    const risk = this.riskCheck(context, riskForecast, config.feed.deliveryLeadDays);

    if (risk.emergency.length > 0) {
      return this.plan(
        context,
        this.forecast(
          context,
          config.feed.emergencyLeadDays,
          BALANCED_ALLOCATION_LOOKAHEAD_DAYS,
        ),
        risk.emergency,
        config.feed.emergencyLeadDays,
        true,
        "a store cannot be held until a normal delivery could land",
      );
    }
    if (risk.normal.length > 0) {
      return this.plan(
        context,
        this.forecast(
          context,
          config.feed.deliveryLeadDays,
          BALANCED_ALLOCATION_LOOKAHEAD_DAYS,
        ),
        risk.normal,
        config.feed.deliveryLeadDays,
        false,
        risk.reason,
      );
    }
    return emptyDecision(
      stores.day,
      this.id,
      "every store is covered past the day a load ordered today would land",
      risk.nextDispatchDay,
    );
  }

  decideEmergency(
    context: ProcurementPlanningContext,
    shortfall: Partial<StoreQuantities>,
  ): ProcurementDecision {
    const kinds = new Set<TripKind>();
    for (const store of STORE_IDS) {
      if ((shortfall[store] ?? 0) > CRUMB_KG) kinds.add(tripKindOf(store));
    }
    if (kinds.size === 0) {
      return emptyDecision(context.stores.day, this.id, "no store ran short");
    }
    return this.plan(
      context,
      this.forecast(
        context,
        context.config.feed.emergencyLeadDays,
        BALANCED_ALLOCATION_LOOKAHEAD_DAYS,
      ),
      [...kinds],
      context.config.feed.emergencyLeadDays,
      true,
      "a store ran dry before its load landed",
    );
  }

  /**
   * A look-ahead is required to know which store would run out next after the
   * deck is filled. It is deliberately not a cover target: the allocator may
   * stop anywhere inside this window as soon as the vehicle is full.
   */
  private forecast(
    context: ProcurementPlanningContext,
    leadDays: number,
    lookAheadDays: number,
  ): DemandForecastResult {
    const { config, stores, farm } = context;
    const horizon = leadDays + config.feed.safetyCoverDays + Math.max(1, lookAheadDays);
    return this.forecaster(farm, config, stores.day + horizon);
  }

  private riskCheck(
    context: ProcurementPlanningContext,
    forecast: DemandForecastResult,
    leadDays: number,
  ): { normal: TripKind[]; emergency: TripKind[]; nextDispatchDay: number | null; reason: string } {
    const { config, stores } = context;
    const normal = new Set<TripKind>();
    const emergency = new Set<TripKind>();
    let soonestRisk: number | null = null;
    let firstStore: StoreId | null = null;
    const horizonTarget = forecast.demandKg[STORE_IDS[0]].length;

    for (const store of STORE_IDS) {
      const position = positionOf(
        store,
        stores,
        forecast,
        [],
        leadDays,
        config.feed.safetyCoverDays,
        horizonTarget,
      );
      if (position.riskIndex === null) continue;
      if (soonestRisk === null || position.riskIndex < soonestRisk) {
        soonestRisk = position.riskIndex;
        firstStore = store;
      }
      if (position.emptyIndex !== null && position.emptyIndex < leadDays) {
        emergency.add(tripKindOf(store));
      } else if (position.riskIndex <= leadDays) {
        normal.add(tripKindOf(store));
      }
    }

    for (const kind of emergency) normal.delete(kind);
    return {
      normal: [...normal],
      emergency: [...emergency],
      nextDispatchDay:
        soonestRisk === null ? null : stores.day + Math.max(0, soonestRisk - leadDays),
      reason:
        firstStore === null
          ? "a store is due"
          : firstStore + " is projected to reach its safety stock",
    };
  }

  private plan(
    context: ProcurementPlanningContext,
    forecast: DemandForecastResult,
    kinds: readonly TripKind[],
    leadDays: number,
    emergency: boolean,
    reason: string,
  ): ProcurementDecision {
    const { config, stores } = context;
    const { feed } = config;
    const day = stores.day;
    const arrivesDay = day + leadDays;
    const deck = Math.max(feed.truckCapacityKg, 1);
    const premium = emergency ? 1 + feed.emergencyPremiumPct / 100 : 1;
    const horizonTarget = forecast.demandKg[STORE_IDS[0]].length;

    const committed: { arrivesDay: number; kg: number; store: StoreId }[] = [];
    const trips: Trip[] = [];
    const constrained = new Set<StoreId>();
    const before = new Map<StoreId, number | null>();
    const ordered = zeroStores();

    for (const kind of kinds) {
      const members = STORE_IDS.filter((store) => tripKindOf(store) === kind);
      const positions = members.map((store) =>
        positionOf(
          store,
          stores,
          forecast,
          committed,
          leadDays,
          feed.safetyCoverDays,
          horizonTarget,
        ),
      );

      for (const position of positions) {
        before.set(position.store, position.riskIndex === null ? null : day + position.riskIndex);
      }

      const eligible = positions.filter(
        (position) => position.roomKg > CRUMB_KG && position.targetKg > CRUMB_KG,
      );
      if (eligible.length === 0) continue;

      // Exactly one ordinary deck is allocated per kind in this morning's
      // decision. If one truck is not enough, tomorrow's rolling check sees the
      // committed load and can justify the next truck on its own merits.
      const load = fillDeck(eligible, deck);
      const payloadKg = [...load.values()].reduce((kg, line) => kg + line, 0);
      if (payloadKg <= CRUMB_KG) continue;

      const lines: TripLine[] = [];
      for (const store of STORE_IDS) {
        const kg = load.get(store) ?? 0;
        if (kg <= CRUMB_KG) continue;
        lines.push({ store, kg });
        committed.push({ arrivesDay, kg, store });
        ordered[store] += kg;
      }
      lines.sort((a, b) => b.kg - a.kg || a.store.localeCompare(b.store));
      trips.push({
        day: arrivesDay,
        neededFromDay: arrivesDay,
        kind,
        payloadKg,
        cost:
          (kind === "bedding" ? config.housing.beddingDeliveryCost : feed.deliveryCostPerTrip) *
          premium,
        lines,
      });

      for (const position of eligible) {
        const kg = load.get(position.store) ?? 0;
        // Not reaching the protection requirement is a real service constraint.
        if (kg + CRUMB_KG < position.protectKg) constrained.add(position.store);
        // Reaching physical room before the forecast could use more is also a
        // useful constraint to expose (gas-canister capacity is the common case).
        if (
          kg + CRUMB_KG >= position.roomKg &&
          position.roomKg + CRUMB_KG < position.targetKg
        ) {
          constrained.add(position.store);
        }
      }
    }

    if (trips.length === 0) {
      return emptyDecision(day, this.id, "nothing useful could be loaded into the available stores");
    }

    const lines: PlannedOrderLine[] = [];
    let soonestAfter: number | null = null;
    for (const kind of kinds) {
      for (const store of STORE_IDS.filter((id) => tripKindOf(id) === kind)) {
        const position = positionOf(
          store,
          stores,
          forecast,
          committed,
          leadDays,
          feed.safetyCoverDays,
          horizonTarget,
        );
        if (position.riskIndex !== null && (soonestAfter === null || position.riskIndex < soonestAfter)) {
          soonestAfter = position.riskIndex;
        }
        if (ordered[store] <= CRUMB_KG) continue;
        lines.push({
          store,
          kg: ordered[store],
          units:
            stores.unitKg[store] > 0
              ? Math.round(ordered[store] / stores.unitKg[store])
              : ordered[store],
          projectedExhaustionDayBefore: before.get(store) ?? null,
          projectedExhaustionDayAfter:
            position.riskIndex === null ? null : day + position.riskIndex,
        });
      }
    }

    const achievedCoverageDay = soonestAfter === null ? null : day + soonestAfter;
    const nextDispatchDay =
      soonestAfter === null ? null : day + Math.max(0, soonestAfter - feed.deliveryLeadDays);
    const cashThrough = Math.max(
      ...trips.map((trip) => trip.day + feed.supplierPaymentDays),
      arrivesDay,
    );

    return {
      day,
      policy: this.id,
      dispatch: emergency ? "emergency" : "normal",
      arrivesDay,
      // Kept for shared read-model compatibility. Under balanced-load this is
      // the limiting coverage date achieved by the full deck, not a requested target.
      targetDay: achievedCoverageDay,
      lines,
      trips,
      constrainedStores: STORE_IDS.filter((store) => constrained.has(store)),
      nextDispatchDay,
      reason,
      ...costOf(context, trips, emergency, cashThrough),
    };
  }
}

/** The policy a configuration asks for. */
export function policyFor(config: PlannerConfig): ProcurementPolicy {
  if (config.feed.operationalPolicy === "balanced-load") return new BalancedLoadProcurementPolicy();
  if (config.feed.operationalPolicy === "rolling-cover") return new RollingCoverProcurementPolicy();
  return new ReorderPointProcurementPolicy();
}

/**
 * Whether two decisions say materially different things. An identical "no order"
 * every morning is noise, and a log that prints it is a log nobody reads.
 */
export function decisionsDiffer(
  previous: ProcurementDecision | null,
  next: ProcurementDecision,
): boolean {
  if (previous === null) return next.dispatch !== "none";
  if (previous.dispatch !== next.dispatch) return true;
  if (previous.arrivesDay !== next.arrivesDay) return true;
  if (previous.targetDay !== next.targetDay) return true;
  if (previous.nextDispatchDay !== next.nextDispatchDay) return true;
  if (previous.lines.length !== next.lines.length) return true;
  for (let index = 0; index < next.lines.length; index += 1) {
    if (previous.lines[index].store !== next.lines[index].store) return true;
    if (Math.abs(previous.lines[index].kg - next.lines[index].kg) > CRUMB_KG) return true;
  }
  return false;
}
