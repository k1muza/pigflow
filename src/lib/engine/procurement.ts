import type { PlannerConfig } from "../config";
import { FEED_RATIONS } from "../sim/animals";
import { STORE_IDS, type StoreId, type Trip, type TripKind, type TripLine } from "../sim/haulage";

/**
 * Buying, holding and paying for the things the farm keeps a store of.
 *
 * The haulage planner in {@link ./haulage} works backwards from feeding that has
 * already happened: it knows what the herd will eat before it eats it, so every
 * lorry is full, nothing is wasted and no bin ever runs dry. That is a fine
 * benchmark and a poor farm. This is the other mode — orders placed from what is
 * in the bin this morning and what has been eaten lately, a supplier who takes
 * days to come, a bin that holds only so much, and a store that can run out.
 *
 * It also keeps the four things a set of books keeps apart and the old model ran
 * together: the order, the goods, the invoice and the payment. Feed is bought
 * when the lorry comes, owed to the supplier until the terms fall due, paid out
 * of the bank on that day, and charged to the animals on the day they eat it.
 * Those are four different dates and the plan should not pretend they are one.
 */

/** Days of consumption the reorder policy reads the herd's appetite off. */
const USE_WINDOW_DAYS = 7;

/** Kilograms below which a remainder is not worth ordering. */
const CRUMB_KG = 1e-6;

export type StoreQuantities = Record<StoreId, number>;

export function zeroStores(): StoreQuantities {
  return Object.fromEntries(STORE_IDS.map((store) => [store, 0])) as StoreQuantities;
}

/** One load, once it has been placed and before it has landed. */
export type SupplyOrder = {
  id: number;
  placedDay: number;
  arrivesDay: number;
  /** Day the supplier's invoice comes out of the bank. */
  dueDay: number;
  emergency: boolean;
  lines: TripLine[];
  /** What the goods on it cost, at list price or at the emergency premium. */
  goodsCost: number;
  /** What the journeys cost, on the same terms. */
  deliveryCost: number;
  /** The lorries the load takes, for the day record and the event log. */
  trips: Trip[];
};

/**
 * An invoice raised on delivery and paid when the supplier's terms fall due.
 * It is kept broken down by what it was for, so the money leaving the bank in
 * March lands on the same lines the feed it paid for was charged to.
 */
export type Invoice = { dueDay: number; byStore: StoreQuantities; delivery: number };

/** What a settlement took out of the bank, line by line. */
export type Settlement = { byStore: StoreQuantities; delivery: number; total: number };

function emptySettlement(): Settlement {
  return { byStore: zeroStores(), delivery: 0, total: 0 };
}

/** What one draw on a store actually issued, and what that cost. */
export type Issue = {
  /** Kilograms handed out, which is what was asked for unless the store is short. */
  kg: number;
  /** Weighted average of what the goods standing in the store cost to buy. */
  costPerKg: number;
  /** Weighted average of the journeys that brought them. */
  haulagePerKg: number;
};

export class Supplies {
  private readonly config: PlannerConfig;
  private readonly operational: boolean;
  /** List price of each store's goods, before any emergency premium. */
  private readonly listPrice: StoreQuantities;

  private readonly held = zeroStores();
  private readonly goodsValue = zeroStores();
  private readonly haulageValue = zeroStores();
  /** Ordered and not yet landed, so a second order is not placed on top of it. */
  private readonly onOrder = zeroStores();
  /** What the herd asked each store for, day by day, which is what sizes an order. */
  private readonly demand: Record<StoreId, number[]> = Object.fromEntries(
    STORE_IDS.map((store) => [store, [] as number[]]),
  ) as Record<StoreId, number[]>;

  private pending: SupplyOrder[] = [];
  private invoices: Invoice[] = [];
  private sequence = 0;

  /** Running totals a plan is read on. */
  payables = 0;
  ordersPlaced = 0;
  emergencyOrders = 0;
  emergencyPremiumPaid = 0;
  shortfallKg = 0;

  /**
   * Whether a delivery raises an invoice to be paid on the supplier's terms.
   * Off, the goods are simply taken as a cost on the day they are consumed,
   * which is what the 1.x engine does and what this has to reproduce when the
   * accrual switch is down.
   */
  private readonly invoicing: boolean;

  constructor(
    config: PlannerConfig,
    operational = config.feed.procurementMode === "operational",
    invoicing = config.finance.accrualAccounting,
  ) {
    this.config = config;
    this.operational = operational;
    this.invoicing = invoicing;
    this.listPrice = {
      sow: config.feed.sowFeedCostKg,
      creep: config.feed.creepFeedCostKg,
      weaner: config.feed.weanerFeedCostKg,
      grower: config.feed.growerFeedCostKg,
      finisher: config.feed.finisherFeedCostKg,
      gas: config.health.gasCostPerKg,
      bedding: config.housing.beddingCostPerKg,
    };
  }

  /**
   * What a store holds, which is the only cap the farm has to respect when a
   * lorry lands. Feed sits in bins and bedding in a barn — both bounded in
   * operational mode and left open under perfect foresight, where the planner
   * has always been free to tip a load in wherever it fitted. Gas is bottles in
   * either mode: there is nowhere to put a third canister on a two-canister yard.
   */
  capacity(store: StoreId): number | null {
    const { config } = this;
    if (store === "gas") return config.health.gasCanisterKg * config.health.gasCanisters;
    if (!this.operational) return null;
    if (store === "bedding") return config.housing.beddingStoreKg;
    return config.feed.binCapacityKg;
  }

  /** Everything standing in the stores, at what it cost to buy. */
  get storeValue(): number {
    return STORE_IDS.reduce((total, store) => total + this.goodsValue[store], 0);
  }

  quantity(store: StoreId): number {
    return this.held[store];
  }

  value(store: StoreId): number {
    return this.goodsValue[store];
  }

  /**
   * What a kilogram out of this store cost to buy, averaged over what is in it.
   *
   * The average only means anything where a store can hold goods bought at
   * different prices, which is to say where an emergency load can have been
   * bought at a premium. Under foresight nothing is, so the list price is the
   * answer and is used directly — dividing a drifted value by a near-empty store
   * is a good way to turn a rounding error into a price.
   */
  priceOf(store: StoreId): number {
    if (!this.operational) return this.listPrice[store];
    const quantity = this.held[store];
    return quantity > CRUMB_KG ? this.goodsValue[store] / quantity : this.listPrice[store];
  }

  /** What a kilogram out of this store carries of the journey that brought it. */
  haulagePerKg(store: StoreId): number {
    const quantity = this.held[store];
    return quantity > CRUMB_KG ? this.haulageValue[store] / quantity : 0;
  }

  /**
   * Kilograms the herd could be given out of this store today.
   *
   * Under perfect foresight this is unbounded, and deliberately so: that mode's
   * whole claim is that the schedule was cut to fit consumption exactly, so it
   * cannot also be allowed to run out. It is the benchmark the operational mode
   * is measured against, and a benchmark that goes hungry measures nothing.
   */
  available(store: StoreId): number {
    if (!this.operational) return Number.POSITIVE_INFINITY;
    return Math.max(0, this.held[store]);
  }

  /**
   * Puts a delivered load into the stores. What will not fit is refused at the
   * gate — a bin that is full is full, and the policy is written so it does not
   * happen, but a plan changed underneath a placed order can still produce it.
   */
  receive(store: StoreId, kg: number, goodsCost: number, haulageCost: number): number {
    const capacity = this.capacity(store);
    // The foresight planner has already sized every load to the room it will
    // find, so refusing anything here would only be floating-point noise turning
    // into a shortage the plan never had.
    const room = capacity === null || !this.operational ? kg : Math.max(0, capacity - this.held[store]);
    const taken = Math.min(kg, room);
    if (taken <= CRUMB_KG) return 0;
    const share = taken / kg;
    this.held[store] += taken;
    this.goodsValue[store] += goodsCost * share;
    this.haulageValue[store] += haulageCost * share;
    return taken;
  }

  /**
   * Takes feed out of a store. A store that cannot cover the draw hands out what
   * it has: the shortfall is the herd going hungry, not the plan quietly
   * inventing feed that was never bought.
   */
  draw(store: StoreId, kg: number): Issue {
    if (kg <= CRUMB_KG) {
      return { kg: 0, costPerKg: this.priceOf(store), haulagePerKg: this.haulagePerKg(store) };
    }
    const costPerKg = this.priceOf(store);
    const haulagePerKg = this.haulagePerKg(store);
    const issued = this.operational ? Math.min(kg, this.held[store]) : kg;
    if (issued <= CRUMB_KG) return { kg: 0, costPerKg, haulagePerKg };
    this.held[store] = Math.max(0, this.held[store] - issued);
    this.goodsValue[store] = Math.max(0, this.goodsValue[store] - issued * costPerKg);
    this.haulageValue[store] = Math.max(0, this.haulageValue[store] - issued * haulagePerKg);
    return { kg: issued, costPerKg, haulagePerKg };
  }

  /** Records what the herd asked for today, which is what the next order is sized on. */
  noteDemand(store: StoreId, kg: number): void {
    const series = this.demand[store];
    series.push(kg);
    if (series.length > USE_WINDOW_DAYS) series.shift();
  }

  /** What the herd has been drawing on this store lately, per day. */
  dailyRate(store: StoreId): number {
    const series = this.demand[store];
    if (series.length === 0) return 0;
    return series.reduce((sum, kg) => sum + kg, 0) / series.length;
  }

  /** Days the store will last at the rate the herd is going through it. */
  daysOfCover(store: StoreId): number | null {
    const rate = this.dailyRate(store);
    return rate > CRUMB_KG ? this.held[store] / rate : null;
  }

  // ------------------------------------------------------------------ ordering

  /**
   * Opening inventory: the feed, gas and bedding a farm has in front of it on
   * the morning the plan starts. Without it the first week of every operational
   * plan is a famine, which says nothing about the plan and everything about
   * where the simulation happened to begin. It is bought and invoiced like any
   * other load — the farm owns feed on day one, and owes for it.
   *
   * The rate it is sized on is today's requirement from the stock actually
   * standing there, which is a thing the farm can see, not a forecast.
   */
  openStores(day: number, ratePerDay: Partial<StoreQuantities>): SupplyOrder[] {
    if (!this.operational) return [];
    const cover = Math.max(this.config.feed.targetCoverDays, 1);
    const wanted = zeroStores();
    for (const store of STORE_IDS) {
      const rate = ratePerDay[store] ?? 0;
      if (rate <= CRUMB_KG) continue;
      this.noteDemand(store, rate);
      wanted[store] = this.roundToUnit(store, rate * cover, this.roomIn(store));
    }
    return this.dispatch(day, day, wanted, false);
  }

  /**
   * The day's ordering. Each store is looked at on its own: what is in it, what
   * is already coming, and how long that will last at the rate the herd has been
   * going through it. Below the reorder cover an order goes in, sized to bring
   * the store back up to the target and bounded by the room there will be to put
   * it. Nothing here looks past today.
   */
  review(day: number): SupplyOrder[] {
    if (!this.operational) return [];
    const { feed } = this.config;
    const reorderAt = Math.max(feed.reorderCoverDays, 1);
    const target = Math.max(feed.targetCoverDays, reorderAt + 1);

    const wanted = zeroStores();
    for (const store of STORE_IDS) {
      const rate = this.dailyRate(store);
      if (rate <= CRUMB_KG) continue;
      const position = this.held[store] + this.onOrder[store];
      // Cover has to carry the herd until a load ordered today could land.
      if (position / rate > reorderAt + feed.deliveryLeadDays) continue;
      const room = this.roomIn(store);
      if (room <= CRUMB_KG) continue;
      let want = rate * target - position;
      if (want <= CRUMB_KG) continue;
      // A supplier will not send a lorry for a handful, so a small order rounds
      // up — but never past what there is room to put away.
      want = Math.max(want, Math.min(feed.minimumOrderKg, room));
      wanted[store] = this.roundToUnit(store, want, room);
    }
    return this.dispatch(day, day + feed.deliveryLeadDays, wanted, false);
  }

  /**
   * The load a farm sends for when the bin is empty. It comes at a premium on
   * both the goods and the journey, and it still takes a day, which is the day
   * the herd goes short on. That day is the point of modelling procurement at
   * all: the cost of a bad ordering policy is not the premium, it is the gain.
   */
  emergency(day: number, shortfall: Partial<StoreQuantities>): SupplyOrder[] {
    if (!this.operational) return [];
    const { feed } = this.config;
    const cover = Math.max(feed.reorderCoverDays, 1);
    const wanted = zeroStores();
    for (const store of STORE_IDS) {
      const short = shortfall[store] ?? 0;
      if (short <= CRUMB_KG) continue;
      const room = this.roomIn(store);
      if (room <= CRUMB_KG) continue;
      const rate = this.dailyRate(store);
      wanted[store] = this.roundToUnit(store, Math.max(short, rate * cover), room);
    }
    return this.dispatch(day, day + feed.emergencyLeadDays, wanted, true);
  }

  /** Room there will be in a store once everything already ordered has landed. */
  private roomIn(store: StoreId): number {
    const capacity = this.capacity(store);
    if (capacity === null) return Number.POSITIVE_INFINITY;
    return Math.max(0, capacity - this.held[store] - this.onOrder[store]);
  }

  /**
   * Goods that only come in whole units come in whole units. A gas bottle is a
   * bottle and a bedding load is a load; feed is tipped by the kilogram and is
   * rounded only to keep the delivery notes readable.
   */
  private roundToUnit(store: StoreId, kg: number, room: number): number {
    const unit =
      store === "gas"
        ? this.config.health.gasCanisterKg
        : store === "bedding"
          ? this.config.housing.beddingLoadKg
          : 0;
    if (unit <= 0) return Math.min(Math.round(kg), Math.floor(room));
    const units = Math.min(Math.ceil(kg / unit), Math.floor((room + CRUMB_KG) / unit));
    return Math.max(0, units) * unit;
  }

  /**
   * Turns a day's wants into lorries and books them. Feed travels mixed, as it
   * does in the foresight planner; gas rides in the weight held back for it when
   * a feed run is going anyway; bedding travels on its own and pays its own way.
   */
  private dispatch(
    placedDay: number,
    arrivesDay: number,
    wanted: StoreQuantities,
    emergency: boolean,
  ): SupplyOrder[] {
    const { config } = this;
    const premium = emergency ? 1 + config.feed.emergencyPremiumPct / 100 : 1;
    const gross = Math.max(config.feed.truckCapacityKg, 1);
    const forFeed = Math.max(gross - config.feed.sundriesAllowanceKg, 1);
    const orders: SupplyOrder[] = [];

    const supplyTrips = packTrips(
      FEED_RATIONS.filter((ration) => wanted[ration] > CRUMB_KG).map((ration) => ({
        store: ration as StoreId,
        kg: wanted[ration],
      })),
      forFeed,
      arrivesDay,
      "supplies",
      config.feed.deliveryCostPerTrip * premium,
    );

    // Gas takes the space held back for it on a run that is already going, and
    // only sends for a lorry of its own when there is none with room on it.
    let gasLeft = wanted.gas;
    for (const trip of supplyTrips) {
      if (gasLeft <= CRUMB_KG) break;
      const room = gross - trip.payloadKg;
      const riding = Math.min(room, gasLeft);
      if (riding <= CRUMB_KG) continue;
      trip.lines.push({ store: "gas", kg: riding });
      trip.lines.sort((a, b) => b.kg - a.kg || a.store.localeCompare(b.store));
      trip.payloadKg += riding;
      gasLeft -= riding;
    }
    if (gasLeft > CRUMB_KG) {
      supplyTrips.push(
        ...packTrips(
          [{ store: "gas", kg: gasLeft }],
          gross,
          arrivesDay,
          "supplies",
          config.feed.deliveryCostPerTrip * premium,
        ),
      );
    }
    if (supplyTrips.length > 0) orders.push(this.book(placedDay, arrivesDay, supplyTrips, emergency, premium));

    if (wanted.bedding > CRUMB_KG) {
      const beddingTrips = packTrips(
        [{ store: "bedding", kg: wanted.bedding }],
        Math.min(Math.max(config.housing.beddingLoadKg, 1), gross),
        arrivesDay,
        "bedding",
        config.housing.beddingDeliveryCost * premium,
      );
      if (beddingTrips.length > 0) {
        orders.push(this.book(placedDay, arrivesDay, beddingTrips, emergency, premium));
      }
    }

    return orders;
  }

  /** Writes an order into the books and holds it until the day it lands. */
  private book(
    placedDay: number,
    arrivesDay: number,
    trips: Trip[],
    emergency: boolean,
    premium: number,
  ): SupplyOrder {
    this.sequence += 1;
    const lines: TripLine[] = [];
    let goodsCost = 0;
    let deliveryCost = 0;
    for (const trip of trips) {
      deliveryCost += trip.cost;
      for (const line of trip.lines) {
        lines.push(line);
        this.onOrder[line.store] += line.kg;
        goodsCost += line.kg * this.listPrice[line.store] * premium;
      }
    }
    const order: SupplyOrder = {
      id: this.sequence,
      placedDay,
      arrivesDay,
      dueDay: arrivesDay + this.config.feed.supplierPaymentDays,
      emergency,
      lines,
      goodsCost,
      deliveryCost,
      trips,
    };
    this.pending.push(order);
    this.ordersPlaced += 1;
    if (emergency) this.emergencyOrders += 1;
    return order;
  }

  /**
   * The loads landing today. Each one puts its goods into the stores and raises
   * an invoice for them, which is a liability rather than a payment: the money
   * does not leave the bank until the supplier's terms fall due.
   */
  arrive(day: number): SupplyOrder[] {
    if (this.pending.length === 0) return [];
    const landing = this.pending.filter((order) => order.arrivesDay <= day);
    if (landing.length === 0) return [];
    this.pending = this.pending.filter((order) => order.arrivesDay > day);

    for (const order of landing) {
      const payload = order.lines.reduce((kg, line) => kg + line.kg, 0);
      for (const line of order.lines) {
        this.onOrder[line.store] = Math.max(0, this.onOrder[line.store] - line.kg);
        const share = payload > 0 ? line.kg / payload : 0;
        this.receive(
          line.store,
          line.kg,
          line.kg * (order.goodsCost / Math.max(payload, CRUMB_KG)),
          order.deliveryCost * share,
        );
      }
      if (!this.invoicing) continue;
      const byStore = zeroStores();
      for (const line of order.lines) {
        byStore[line.store] += payload > 0 ? (line.kg / payload) * order.goodsCost : 0;
      }
      const invoiced = order.goodsCost + order.deliveryCost;
      this.payables += invoiced;
      this.invoices.push({ dueDay: order.dueDay, byStore, delivery: order.deliveryCost });
      if (order.emergency) {
        const premium = this.config.feed.emergencyPremiumPct / 100;
        this.emergencyPremiumPaid += invoiced - invoiced / (1 + premium);
      }
    }
    return landing;
  }

  /** What the supplier has to be paid today, and it comes out of the bank now. */
  settleDue(day: number): Settlement {
    if (this.invoices.length === 0) return emptySettlement();
    const paid = emptySettlement();
    const left: Invoice[] = [];
    for (const invoice of this.invoices) {
      if (invoice.dueDay > day) {
        left.push(invoice);
        continue;
      }
      for (const store of STORE_IDS) {
        paid.byStore[store] += invoice.byStore[store];
        paid.total += invoice.byStore[store];
      }
      paid.delivery += invoice.delivery;
      paid.total += invoice.delivery;
    }
    this.invoices = left;
    this.payables = Math.max(0, this.payables - paid.total);
    return paid;
  }

  /** The kilograms the herd asked for and the stores could not give it. */
  noteShortfall(kg: number): void {
    this.shortfallKg += kg;
  }

  /**
   * A load the foresight planner cut, delivered on the day it cut it for. The
   * goods and the journey are booked exactly as an operational order is — into
   * the stores, and onto the supplier's account — so that both modes keep
   * purchasing, inventory, cost and cash as four separate things.
   */
  deliverPlanned(day: number, trips: readonly Trip[]): SupplyOrder | null {
    if (trips.length === 0) return null;
    this.sequence += 1;
    const lines: TripLine[] = [];
    let goodsCost = 0;
    let deliveryCost = 0;
    for (const trip of trips) {
      deliveryCost += trip.cost;
      for (const line of trip.lines) {
        lines.push(line);
        this.onOrder[line.store] += line.kg;
        goodsCost += line.kg * this.listPrice[line.store];
      }
    }
    const order: SupplyOrder = {
      id: this.sequence,
      placedDay: day,
      arrivesDay: day,
      dueDay: day + this.config.feed.supplierPaymentDays,
      emergency: false,
      lines,
      goodsCost,
      deliveryCost,
      trips: [...trips],
    };
    this.pending.push(order);
    this.ordersPlaced += 1;
    return order;
  }
}

/**
 * Packs a day's order onto lorries. The loads are full but for the last, which
 * carries the remainder — the same rule the foresight planner cuts to, so the
 * two modes cost a journey the same way and can be read off against each other.
 */
function packTrips(
  lines: readonly TripLine[],
  capacityKg: number,
  day: number,
  kind: TripKind,
  tripCost: number,
): Trip[] {
  const payload = Math.max(capacityKg, 1);
  const trips: Trip[] = [];
  let current: Trip | null = null;

  for (const line of lines) {
    let left = line.kg;
    while (left > CRUMB_KG) {
      if (current === null || current.payloadKg >= payload - CRUMB_KG) {
        current = { day, neededFromDay: day, kind, payloadKg: 0, cost: tripCost, lines: [] };
        trips.push(current);
      }
      const take = Math.min(payload - current.payloadKg, left);
      const already = current.lines.find((entry) => entry.store === line.store);
      if (already) already.kg += take;
      else current.lines.push({ store: line.store, kg: take });
      current.payloadKg += take;
      left -= take;
    }
  }

  for (const trip of trips) {
    trip.lines.sort((a, b) => b.kg - a.kg || a.store.localeCompare(b.store));
  }
  return trips;
}

