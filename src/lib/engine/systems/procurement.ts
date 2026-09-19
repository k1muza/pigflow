import type { FeedRation } from "../../sim/animals";
import { FEED_RATIONS } from "../../sim/animals";
import { STORE_LABELS, tripNote } from "../../sim/farm";
import type { LedgerCategory } from "../../sim/ledger";
import { decisionsDiffer, type ProcurementDecision } from "../planning/procurement";
import type { StoreQuantities, SupplyOrder } from "../procurement";
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
  const premiumBefore = world.lifetime.emergencyPremium;

  if (policies.operationalProcurement) {
    // The morning's decision, taken before anything is fed and taken from a
    // picture of the farm rather than from the farm itself. Booking it is a
    // separate step, which is what lets the same decision be inspected, logged
    // and asserted on without a lorry having moved.
    const decision = world.procurement.decide(world.procurementContext(day));
    noteDecision(world, decision);
    for (const order of supplies.place(day, decision)) noteOrder(world, order, decision);
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
  record.emergencyPremium = world.lifetime.emergencyPremium - premiumBefore;

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

/**
 * The load a farm sends for when a bin is already empty.
 *
 * It comes at a premium on both the goods and the journey, and it still takes a
 * day — which is the day the herd goes short on, and the point of modelling
 * procurement at all: the cost of a thin ordering policy is not the premium, it
 * is the gain. The lorry is coming at that price either way, so the whole
 * compatible load is recalculated before it leaves rather than after.
 */
export function runEmergencyProcurement(
  world: World,
  shortfall: Partial<StoreQuantities>,
): void {
  if (!world.policies.operationalProcurement) return;
  const day = world.day;
  const decision = world.procurement.decideEmergency(world.procurementContext(day), shortfall);
  if (decision.dispatch === "none") return;
  noteDecision(world, decision);
  for (const order of world.supplies.place(day, decision)) {
    world.emit("OrderPlaced", "Emergency order placed for delivery day " + order.arrivesDay, {
      cause: decision.reason,
      changes: { arrivesDay: order.arrivesDay, goodsCost: order.goodsCost },
    });
  }
}

/** One line for an order going in, so the log shows the decision and not just the lorry. */
function noteOrder(world: World, order: SupplyOrder, decision: ProcurementDecision): void {
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
      cause: order.emergency ? "store empty" : decision.reason,
      changes: { arrivesDay: order.arrivesDay, goodsCost: order.goodsCost },
    },
  );
}

/**
 * The planner's own record: what it worked out this morning, and what changed.
 *
 * Only the rolling policy writes these. The reorder rule has nothing to say
 * beyond the order itself — it has no plan, no target date and no forecast to
 * revise — and giving it a plan event would be dressing one policy up as the
 * other in the log.
 *
 * Three things are worth an entry and nothing else is. The plan changed
 * materially; the lorry was brought forward; or a store could not be bought up
 * to the common date and the farm should know which and why. An identical "no
 * order today" every morning for three years is noise, so it is not written.
 */
function noteDecision(world: World, decision: ProcurementDecision): void {
  if (decision.policy !== "rolling-cover") return;
  const previous = world.lastProcurementDecision;
  const expected = world.expectedNextDispatchDay;

  if (
    decision.dispatch !== "none" &&
    expected !== null &&
    expected > decision.day &&
    previous !== null
  ) {
    world.emit(
      "ProcurementDispatchAdvanced",
      "The lorry was brought forward from day " + expected + " to day " + decision.day,
      {
        cause: decision.reason,
        changes: {
          broughtForwardDays: expected - decision.day,
          arrivesDay: decision.arrivesDay ?? decision.day,
        },
      },
    );
  }

  if (decisionsDiffer(previous, decision)) {
    world.emit("ProcurementPlanRecalculated", planSentence(decision), {
      cause: decision.reason,
      changes: {
        dispatch: decision.dispatch,
        arrivesDay: decision.arrivesDay ?? -1,
        targetDay: decision.targetDay ?? -1,
        trips: decision.trips.length,
        goodsCost: decision.expectedGoodsCost,
        deliveryCost: decision.expectedDeliveryCost,
        inventoryValue: decision.projectedInventoryValue,
        lowestCash: decision.projectedMinimumCash,
        fundingRequired: decision.additionalFundingRequired,
      },
    });
  }

  if (decision.constrainedStores.length > 0) {
    world.emit(
      "ProcurementPlanConstrained",
      decision.constrainedStores.map((store) => STORE_LABELS[store]).join(", ") +
        (decision.constrainedStores.length === 1
          ? " could not be bought up to the target date"
          : " could not be bought up to the target date"),
      {
        cause: "storage, packaging or the day's lorries would not carry it",
        changes: { stores: decision.constrainedStores.length },
      },
    );
  }

  world.lastProcurementDecision = decision;
  world.expectedNextDispatchDay =
    decision.dispatch === "none" ? decision.nextDispatchDay : null;
}

/** The plan in a sentence, which is what a person reads the log for. */
function planSentence(decision: ProcurementDecision): string {
  if (decision.dispatch === "none") {
    return decision.nextDispatchDay === null
      ? "No delivery is expected: nothing is being drawn on"
      : "No order today; the next delivery is expected around day " + decision.nextDispatchDay;
  }
  const goods = decision.lines
    .map((line) => {
      const packages = line.units;
      return (
        STORE_LABELS[line.store] +
        " " +
        Math.round(line.kg) +
        " kg" +
        (packages > 0 && Number.isInteger(packages) ? " (" + packages + ")" : "")
      );
    })
    .join(", ");
  const trips = decision.trips.length;
  return (
    (decision.dispatch === "emergency" ? "Emergency replan" : "Replanned") +
    " to day " +
    (decision.targetDay ?? 0) +
    ", arriving day " +
    (decision.arrivesDay ?? 0) +
    ": " +
    goods +
    ", in " +
    trips +
    (trips === 1 ? " trip" : " trips")
  );
}
