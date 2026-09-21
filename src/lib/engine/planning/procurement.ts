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
 * follow: a second ordering rule could be written as the same kind of object
 * and swapped in, and a decision can be asserted on in a test without a
 * `World`, a ledger or a day being run.
 *
 * One operational policy lives here.
 *
 * {@link BalancedLoadProcurementPolicy} is the capacity-balanced rule: a due
 * store justifies one trip, then the truck itself is the budget and the next
 * package goes to whichever compatible store would otherwise become risky first.
 *
 * It had a predecessor, `rolling-cover`, which forecast the herd and bought
 * every compatible store up to one configured common date. Measured against V1
 * perfect foresight it sent about a fifth more lorries than it needed to, so it
 * has been withdrawn; the seam the two shared is what remains.
 */

export type OperationalProcurementPolicy = "balanced-load";

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

/**
 * The balanced policy's numbers, as values rather than as constants baked into
 * it.
 *
 * These are not settings a farm should be asked about — they describe how far
 * ahead the allocator looks and how finely it shares a deck out, which is the
 * policy's own business. They are named here so the tuning bench can vary them
 * against V1 foresight and so the figure that wins can be committed as the
 * default, rather than the whole thing being a magic number nobody may question.
 */
export type BalancedLoadTuning = {
  /** Days past the lead time and safety window the daily risk check looks. */
  riskLookAheadDays: number;
  /** How far the allocator may rank stores once a deck is being filled. */
  allocationLookAheadDays: number;
  /** Notional sack size loose feed is shared out in. */
  looseStepKg: number;
};

export const BALANCED_LOAD_TUNING: BalancedLoadTuning = {
  riskLookAheadDays: BALANCED_RISK_LOOKAHEAD_DAYS,
  allocationLookAheadDays: BALANCED_ALLOCATION_LOOKAHEAD_DAYS,
  looseStepKg: LOOSE_STEP_KG,
};

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
   * The limiting coverage date the full deck achieved — a read-out, not a
   * target that was asked for. Null where nothing was sent for.
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
 * kilogram, which is the whole reason the policy works to fill one.
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
 * own. Ordering and opening the stores both end here, because a vehicle is a
 * vehicle whatever decided to fill it.
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
 * that one array, which keeps capacity-balanced planning cheap enough to redo
 * every morning.
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
   * Kilograms required through the caller's allocation horizon, which is only a
   * far look-ahead cap so the deck is never filled with goods having no visible
   * future demand. It is not a stock target.
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
 * Loads one deck by the max-min rule: the next package goes to whichever store
 * is covered for the shortest time on what it has been given so far, settled by
 * store order where two are level. That tie-break is the whole of the
 * determinism guarantee for this step.
 *
 * There is one queue and it starts from the first bag. There used to be two: a
 * protection pass that carried each store past its safety period in turn, and
 * then the balancing pass. The protection pass is not needed, because balancing
 * already does the same work — the next package goes to the store with the
 * earliest floor date, and every store on the deck shares one protection date,
 * so no store is extended materially past that date while another is still
 * short of it.
 *
 * What the protection pass added was an order of service: it filled the most
 * urgent store to its floor before the next store got anything, so a deck that
 * could not hold everything left the early stores safe and the late ones
 * untouched. Balancing spreads the same shortfall across all of them instead,
 * which is the better failure — the deck is short because another lorry is owed,
 * and a farm waiting for it is better off with every bin equally low than with
 * some full and one empty.
 *
 * `protectKg` is therefore no longer an allocation input. It survives as the
 * test the caller applies to the finished deck, to decide whether that further
 * lorry has to go.
 */
function fillDeck(
  positions: readonly StorePosition[],
  deck: number,
  looseStepKg: number = LOOSE_STEP_KG,
): Map<StoreId, number> {
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
    position.unitKg > 0 ? position.unitKg : Math.min(looseStepKg, want);

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
      // Strictly less than, so the store-order tie-break stands: `positions`
      // is walked in store order and the first store at the earliest floor date
      // keeps the package.
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

  private readonly tuning: BalancedLoadTuning;

  constructor(
    private readonly forecaster: Forecaster = forecastDemand,
    tuning: Partial<BalancedLoadTuning> = {},
  ) {
    this.tuning = { ...BALANCED_LOAD_TUNING, ...tuning };
  }

  decide(context: ProcurementPlanningContext): ProcurementDecision {
    const { config, stores } = context;
    // Most mornings need only the cheap near-term risk check. The longer demand
    // walk is deferred until a truck is genuinely due.
    const riskForecast = this.forecast(
      context,
      config.feed.deliveryLeadDays,
      this.tuning.riskLookAheadDays,
    );
    const risk = this.riskCheck(context, riskForecast, config.feed.deliveryLeadDays);

    if (risk.emergency.length > 0) {
      return this.plan(
        context,
        this.forecast(
          context,
          config.feed.emergencyLeadDays,
          this.tuning.allocationLookAheadDays,
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
          this.tuning.allocationLookAheadDays,
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
        this.tuning.allocationLookAheadDays,
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
    /** What the deck currently being loaded could not cover, for this kind only. */
    const kindConstrained = new Set<StoreId>();
    const before = new Map<StoreId, number | null>();
    const ordered = zeroStores();

    for (const kind of kinds) {
      const members = STORE_IDS.filter((store) => tripKindOf(store) === kind);
      const positionsNow = () =>
        members.map((store) =>
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

      kindConstrained.clear();
      let positions = positionsNow();
      for (const position of positions) {
        before.set(position.store, position.riskIndex === null ? null : day + position.riskIndex);
      }

      /**
       * One deck is the ordinary answer, and on most farms it is the only one.
       *
       * It used to be the only answer allowed, on the reasoning that tomorrow's
       * check would see today's committed load and justify the next lorry on its
       * own merits. That holds only while one deck a day can outrun the herd. It
       * cannot on a large one — two hundred sows eat rather more in a day than a
       * 2.8 tonne lorry carries — and the farm then spends every morning one
       * load behind, ordering at a premium and still running its bins dry. The
       * policy was not making a bad trade in that case; it was unable to express
       * the right one.
       *
       * Every deck is loaded the same way, by balancing from the first bag. What
       * decides whether another one goes is the state the last one left behind:
       * a further lorry is owed only while a compatible store still cannot be
       * held through the lead time and its safety period, still has room to put
       * a load away, and the deck that just went out was full. A deck that came
       * back short is the proof that there was nothing more to load, and a half
       * empty lorry is a journey paid for twice.
       *
       * Whether anything is still unprotected is read off the deck just filled
       * rather than by projecting the stores again. `protectKg` is what a store
       * needed before this lorry and `load` is what it got, so the comparison is
       * the same one — and projecting every store over the whole forecast is far
       * and away the most expensive thing this policy does. Recomputing costs a
       * second full projection on every dispatch in the year, which is a real
       * slowdown on a farm that never needs a second lorry.
       */
      const maxDecks = Math.max(1, feed.maxSupplyTripsPerDay);
      for (let sent = 0; sent < maxDecks; sent += 1) {
        const eligible = positions.filter(
          (position) => position.roomKg > CRUMB_KG && position.targetKg > CRUMB_KG,
        );
        if (eligible.length === 0) break;

        const load = fillDeck(eligible, deck, this.tuning.looseStepKg);
        const payloadKg = [...load.values()].reduce((kg, line) => kg + line, 0);
        if (payloadKg <= CRUMB_KG) break;

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

        // The constraints this deck leaves behind. They are recorded fresh each
        // time rather than accumulated, because a store this lorry could not
        // protect is not constrained if the next one in the same decision does.
        kindConstrained.clear();
        for (const position of eligible) {
          const kg = load.get(position.store) ?? 0;
          // Not reaching the protection requirement is a real service constraint.
          if (kg + CRUMB_KG < position.protectKg) kindConstrained.add(position.store);
          // Reaching physical room before the forecast could use more is also a
          // useful constraint to expose (gas-canister capacity is the common case).
          if (kg + CRUMB_KG >= position.roomKg && position.roomKg + CRUMB_KG < position.targetKg) {
            kindConstrained.add(position.store);
          }
        }

        // Another deck is worth sending only for a store that is both still
        // short of protection and still has somewhere to put it. A bin that
        // could not be filled because it is physically full is not a reason to
        // send a second lorry: the next one cannot unload into it either, and
        // the deck would go to whatever else happened to be eligible.
        const worthAnother = eligible.some(
          (position) =>
            (load.get(position.store) ?? 0) + CRUMB_KG < position.protectKg &&
            (load.get(position.store) ?? 0) + CRUMB_KG < position.roomKg,
        );
        // And only if this one left with nothing to spare. If the deck came
        // back short then every kilogram the stores could take is already on
        // it, and whatever is still unprotected is short because a bin, a
        // package size or the forecast says so — none of which a second lorry
        // can mend.
        const deckWasFull = payloadKg + CRUMB_KG >= deck;
        if (!worthAnother || !deckWasFull || sent + 1 >= maxDecks) break;
        // Only now is a further projection worth paying for.
        positions = positionsNow();
      }

      for (const store of kindConstrained) constrained.add(store);
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

/**
 * The operational policy, built.
 *
 * There is one, so this takes nothing to choose between; the seam is kept rather
 * than inlined because the caller already goes through it, the decision it
 * returns is stamped with the policy that made it, and a second rule would be
 * added here rather than by unpicking the caller.
 */
export function policyFor(): ProcurementPolicy {
  return new BalancedLoadProcurementPolicy();
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
