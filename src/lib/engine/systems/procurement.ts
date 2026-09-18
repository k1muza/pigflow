import type { FeedRation } from "../../sim/animals";
import { FEED_RATIONS } from "../../sim/animals";
import { STORE_LABELS, tripNote } from "../../sim/farm";
import type { LedgerCategory } from "../../sim/ledger";
import type { SupplyOrder } from "../procurement";
import type { World } from "../world";

/**
 * The inventory and procurement system: ordering, taking in, owing and paying.
 *
 * Under perfect foresight the orders were cut before the plan ran, from feeding
 * that had already been simulated, and this system only takes them in.
 * Operationally they are placed here, from what is in the bins this morning and
 * what the herd has been eating lately, and they take the supplier's lead time
 * to arrive.
 *
 * Either way — and this is the part that is accounting rather than logistics —
 * the goods go into the stores and onto the supplier's account rather than
 * straight onto the cash book. A lorryload is not a cost on the day it lands. It
 * is stock, bought on terms, and charged to the animals on the days they eat it.
 * Only the journey is a cost of the day it was made.
 */

/** The cash line each ration is charged to. */
export const RATION_CATEGORY: Record<FeedRation, LedgerCategory> = {
  sow: "feed-sow",
  creep: "feed-creep",
  weaner: "feed-weaner",
  grower: "feed-grower",
  finisher: "feed-finisher",
};

export function runProcurement(world: World): void {
  const { supplies, ledger, policies } = world;
  const day = world.day;
  const record = world.record;

  if (policies.operationalProcurement) {
    for (const order of supplies.review(day)) noteOrder(world, order);
  } else {
    const planned = world.deliveriesByDay.get(day);
    if (planned) supplies.deliverPlanned(day, planned);
  }

  for (const order of supplies.arrive(day)) {
    record.deliveries.push(...order.trips);
    if (order.emergency) {
      record.emergencyOrders += 1;
      world.lifetime.emergencyOrders += 1;
    }
    for (const trip of order.trips) {
      // The journey is the farm's cost the day it is made; the goods on it are
      // the farm's stock until something eats them.
      if (policies.accrualAccounting) ledger.charge("deliveries", trip.cost);
      else ledger.accrue("deliveries", trip.cost);
      record.lorriesIn += 1;
      world.lifetime.lorries += 1;
      world.lifetime.haulageCost += trip.cost;
      for (const line of trip.lines) {
        if (line.store === "gas" || line.store === "bedding") continue;
        record.feedDeliveredKg += line.kg;
        world.lifetime.feedDeliveredKg += line.kg;
      }
      world.emit(
        "DeliveryReceived",
        order.emergency ? "Emergency " + tripNote(trip).toLowerCase() : tripNote(trip),
        {
          cause: order.emergency ? "a store had run dry" : "scheduled order",
          changes: { payloadKg: trip.payloadKg, tripCost: trip.cost },
          postings: [{ category: "deliveries", accrued: trip.cost }],
        },
      );
    }
    const invoiced = order.goodsCost + order.deliveryCost;
    world.emit("InvoiceRaised", "Supplier invoice for " + Math.round(invoiced), {
      changes: { amount: invoiced, dueDay: order.dueDay },
    });
  }
  world.lifetime.emergencyPremium = supplies.emergencyPremiumPaid;

  // And the supplier is paid when his terms fall due, which — with the books
  // kept properly — is the only day any of this touches the bank.
  const paid = supplies.settleDue(day);
  if (paid.total <= 0) return;
  if (!policies.accrualAccounting) return;
  for (const ration of FEED_RATIONS) ledger.pay(RATION_CATEGORY[ration], paid.byStore[ration]);
  ledger.pay("gas", paid.byStore.gas);
  ledger.pay("bedding", paid.byStore.bedding);
  ledger.pay("deliveries", paid.delivery);
  world.emit("InvoicePaid", "Paid suppliers " + Math.round(paid.total), {
    changes: { amount: paid.total },
    postings: [
      ...FEED_RATIONS.map((ration) => ({
        category: RATION_CATEGORY[ration],
        cash: paid.byStore[ration],
      })),
      { category: "deliveries" as LedgerCategory, cash: paid.delivery },
    ].filter((posting) => (posting.cash ?? 0) > 0),
  });
}

/** One line for an order going in, so the log shows the decision and not just the lorry. */
function noteOrder(world: World, order: SupplyOrder): void {
  const goods = order.lines
    .filter((line) => line.kg >= 0.5)
    .map((line) => STORE_LABELS[line.store] + " " + Math.round(line.kg) + " kg")
    .join(", ");
  if (!goods) return;
  world.emit(
    "OrderPlaced",
    (order.emergency ? "Emergency order placed" : "Order placed") +
      " for delivery day " +
      order.arrivesDay +
      ": " +
      goods,
    {
      cause: order.emergency ? "store empty" : "cover fell to the reorder point",
      changes: { arrivesDay: order.arrivesDay, goodsCost: order.goodsCost },
    },
  );
}
