import type { PlannerConfig } from "../config";
import { STORE_IDS, type StoreId, type Trip, type TripKind, type TripLine } from "../sim/haulage";
import { planLoads, type Claim, type Load } from "../sim/loadout";

/**
 * Buying, holding and paying for the things the farm keeps a store of.
 *
 * The haulage planner in {@link ./haulage} reads the whole plan's feeding before
 * a day of it is run: it knows what the herd will eat before it eats it, so no
 * bin ever runs dry and nothing is delivered that is not used. That is a fine
 * benchmark and a poor farm. This is the other mode — orders placed from what is
 * in the bin this morning and what has been eaten lately, a supplier who takes
 * days to come, a bin that holds only so much, and a store that can run out.
 *
 * What the two modes share is the lorry. Both cut their loads through
 * {@link ../sim/loadout}: a vehicle is sent only when some store is actually due,
 * and it leaves with every other store that is close behind aboard, ranked by how
 * soon each runs out. All that separates them is where that ranking comes from —
 * the future, or the last week's consumption.
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
   * lorry lands. Feed sits in bins, bedding in a barn and gas in bottles, and
   * all three bind in either mode: the foresight planner tops a deck up with
   * whatever the farm will want next, so it has to know what there is room to
   * put away. Before it did, an empty bin was a licence to deliver anything.
   */
  capacity(store: StoreId): number {
    const { config } = this;
    if (store === "gas") return config.health.gasCanisterKg * config.health.gasCanisters;
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
    // The foresight planner sizes every load to the room it can see the store
    // having, but it sized it against a probe run rather than this one. Holding
    // it to the bin here would turn a kilogram of drift into a shortage the plan
    // never had, so a planned load always lands and only a live order is refused.
    const room = this.operational ? Math.max(0, this.capacity(store) - this.held[store]) : kg;
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
    const claims: Claim[] = [];
    for (const store of STORE_IDS) {
      const rate = ratePerDay[store] ?? 0;
      if (rate <= CRUMB_KG) continue;
      this.noteDemand(store, rate);
      claims.push({
        store,
        // Nothing is in any of them, so nothing is more urgent than anything
        // else and the deck is shared out by what each one asked for.
        coverDays: 0,
        due: true,
        needKg: rate * cover,
        maxKg: this.roomIn(store),
        unitKg: this.unitOf(store),
      });
    }
    return this.dispatch(day, day, claims, false);
  }

  /**
   * The day's ordering.
   *
   * Each store says how long what is in it and already coming will last at the
   * rate the herd has been going through it. That figure — days of cover — is
   * the whole policy. A store that has fallen far enough to run out before a
   * load ordered today could land is **due**, and one due store is what sends a
   * lorry. Everything else then queues for the space that order left on the
   * deck, in the same order of cover, and rides along for nothing.
   *
   * What this replaced looked at each store alone and sent for each one alone,
   * which is how a farm came to run a 2.8 tonne vehicle out for a single bottle
   * of gas on the Tuesday and again for the weaner feed on the Friday. Nothing
   * here looks past today; it only stops looking at one bin at a time.
   */
  review(day: number): SupplyOrder[] {
    if (!this.operational) return [];
    const { feed } = this.config;
    const reorderAt = Math.max(feed.reorderCoverDays, 1);
    const target = Math.max(feed.targetCoverDays, reorderAt + 1);

    const claims: Claim[] = [];
    for (const store of STORE_IDS) {
      const room = this.roomIn(store);
      if (room <= CRUMB_KG) continue;
      const rate = this.dailyRate(store);
      const position = this.held[store] + this.onOrder[store];
      // A store the herd is not drawing on never runs out, so it is never due —
      // but it can still be topped up when a lorry is going anyway.
      const cover = rate > CRUMB_KG ? position / rate : Number.POSITIVE_INFINITY;
      // A supplier will not send a lorry for a handful, so a small order rounds
      // up — but never past what there is room to put away.
      const need = Math.max(rate * target - position, Math.min(feed.minimumOrderKg, room));
      // A store cannot hold a buffer bigger than itself. One that tries to — a
      // gas yard holding less than a week of gas against a week's reorder point
      // — is inside its own reorder point every morning of its life, and sends
      // for a lorry the moment there is room for one bottle. So the point is
      // also held to what leaves a decent run between deliveries.
      const fullCover = rate > CRUMB_KG ? this.capacity(store) / rate : Number.POSITIVE_INFINITY;
      const sendAt = Math.min(reorderAt, Math.max(0, fullCover - reorderAt));
      claims.push({
        store,
        coverDays: cover,
        // Cover has to carry the herd until a load ordered today could land.
        due: cover <= sendAt + feed.deliveryLeadDays,
        needKg: Math.max(0, need),
        maxKg: room,
        unitKg: this.unitOf(store),
      });
    }
    return this.dispatch(day, day + feed.deliveryLeadDays, claims, false);
  }

  /**
   * The load a farm sends for when the bin is empty. It comes at a premium on
   * both the goods and the journey, and it still takes a day, which is the day
   * the herd goes short on. That day is the point of modelling procurement at
   * all: the cost of a bad ordering policy is not the premium, it is the gain.
   *
   * The lorry is coming at a premium either way, so it goes out loaded: the
   * store that ran dry is what sends it, and everything else on the farm takes
   * the rest of the deck in the order it will be wanted. Paying the premium on
   * a full vehicle is dear; paying it on an empty one is worse.
   */
  emergency(day: number, shortfall: Partial<StoreQuantities>): SupplyOrder[] {
    if (!this.operational) return [];
    const { feed } = this.config;
    const cover = Math.max(feed.reorderCoverDays, 1);
    const claims: Claim[] = [];
    for (const store of STORE_IDS) {
      const room = this.roomIn(store);
      if (room <= CRUMB_KG) continue;
      const short = shortfall[store] ?? 0;
      const rate = this.dailyRate(store);
      const position = this.held[store] + this.onOrder[store];
      claims.push({
        store,
        coverDays: rate > CRUMB_KG ? position / rate : Number.POSITIVE_INFINITY,
        // Only a store that actually ran short is a reason to pay the premium.
        due: short > CRUMB_KG,
        needKg: Math.max(short, rate * cover),
        maxKg: room,
        unitKg: this.unitOf(store),
      });
    }
    return this.dispatch(day, day + feed.emergencyLeadDays, claims, true);
  }

  /** Room there will be in a store once everything already ordered has landed. */
  private roomIn(store: StoreId): number {
    return Math.max(0, this.capacity(store) - this.held[store] - this.onOrder[store]);
  }

  /**
   * What a store's goods come in. Feed comes in bags, gas as whole canister
   * fillings, bedding by the load — and a part-used one of any of them takes the
   * same corner of the deck and the same corner of the store as a full one. A
   * bag size of 0 is feed blown into the bin loose, and only then is a kilogram
   * really the unit.
   */
  private unitOf(store: StoreId): number {
    if (store === "gas") return Math.max(this.config.health.gasCanisterKg, 1);
    if (store === "bedding") return Math.max(this.config.housing.beddingLoadKg, 1);
    return Math.max(this.config.feed.feedBagKg, 0);
  }

  /**
   * Turns a day's claims into lorries and books them.
   *
   * Feed and gas share a deck and are cut through the same queue the foresight
   * planner uses, so the two modes load a vehicle by one rule rather than two.
   * Bedding is sent for on its own — it is bulky and dirty and does not belong
   * on a feed order — but it still fills the lorry that fetches it rather than
   * riding out for a single bale.
   */
  private dispatch(
    placedDay: number,
    arrivesDay: number,
    claims: readonly Claim[],
    emergency: boolean,
  ): SupplyOrder[] {
    const { config } = this;
    const premium = emergency ? 1 + config.feed.emergencyPremiumPct / 100 : 1;
    const deck = Math.max(config.feed.truckCapacityKg, 1);
    const orders: SupplyOrder[] = [];

    const shared = claims.filter((claim) => claim.store !== "bedding");
    const supplyTrips = tripsFor(
      planLoads(shared, deck),
      arrivesDay,
      "supplies",
      config.feed.deliveryCostPerTrip * premium,
    );
    if (supplyTrips.length > 0) {
      orders.push(this.book(placedDay, arrivesDay, supplyTrips, emergency, premium));
    }

    const beddingTrips = tripsFor(
      planLoads(
        claims.filter((claim) => claim.store === "bedding"),
        deck,
      ),
      arrivesDay,
      "bedding",
      config.housing.beddingDeliveryCost * premium,
    );
    if (beddingTrips.length > 0) {
      orders.push(this.book(placedDay, arrivesDay, beddingTrips, emergency, premium));
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
      const premium = order.emergency ? 1 + this.config.feed.emergencyPremiumPct / 100 : 1;
      for (const line of order.lines) {
        this.onOrder[line.store] = Math.max(0, this.onOrder[line.store] - line.kg);
        // Goods go in at what that store's goods cost. Spreading the order's
        // total over the payload by weight instead priced every line on the
        // lorry the same, so a load of cheap sow feed and dear weaner feed put
        // both bins in at the average of the two — and every figure read off a
        // bin afterwards was wrong with it: what the stock is worth, what a pig
        // ate, and which stage carried the cost of it.
        //
        // The journey is the one thing that genuinely is shared, and it is
        // still split by weight: a kilogram takes a kilogram's share of the
        // trip whatever the kilogram happens to be.
        const share = payload > 0 ? line.kg / payload : 0;
        this.receive(
          line.store,
          line.kg,
          line.kg * this.listPrice[line.store] * premium,
          order.deliveryCost * share,
        );
      }
      if (!this.invoicing) continue;
      const byStore = zeroStores();
      for (const line of order.lines) {
        byStore[line.store] += line.kg * this.listPrice[line.store] * premium;
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
 * Dresses the loads the shared planner cut as trips: the day they land, what
 * they are, and the journey they cost. The cost is per lorry and not per
 * kilogram, which is the whole reason the planner works to fill one.
 */
function tripsFor(loads: readonly Load[], day: number, kind: TripKind, tripCost: number): Trip[] {
  return loads.map((load) => ({
    day,
    neededFromDay: day,
    kind,
    payloadKg: load.payloadKg,
    cost: tripCost,
    lines: load.lines,
  }));
}
