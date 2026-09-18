import { describe, expect, it } from "vitest";

import { cloneDefaultConfig, type PlannerConfig } from "../config";
import { FEED_RATIONS } from "../sim/animals";
import { Supplies } from "./procurement";

/**
 * A farm whose two rations are priced a long way apart, so that pricing a mixed
 * load by the average of what was on it is visible rather than a rounding error.
 */
function plan(tweak: (c: PlannerConfig) => void = () => {}): PlannerConfig {
  const config = cloneDefaultConfig();
  config.feed.sowFeedCostKg = 1;
  config.feed.weanerFeedCostKg = 9;
  tweak(config);
  return config;
}

/** Puts a day's worth of demand in front of the policy so it orders something. */
function stockedUp(config: PlannerConfig): Supplies {
  const supplies = new Supplies(config, true, true);
  supplies.openStores(0, { sow: 40, weaner: 40 });
  supplies.arrive(0);
  return supplies;
}

describe("A mixed load is priced line by line, not by the lorry", () => {
  it("puts each ration into its bin at its own price", () => {
    const config = plan();
    const supplies = stockedUp(config);

    const sowKg = supplies.quantity("sow");
    const weanerKg = supplies.quantity("weaner");
    expect(sowKg).toBeGreaterThan(0);
    expect(weanerKg).toBeGreaterThan(0);

    // The bug this pins: the order was costed line by line and then unpicked on
    // arrival, the total spread back over the payload by weight. Both bins came
    // out at the same price a kilogram — the average of the two — which is a
    // price neither ration was ever bought at.
    expect(supplies.priceOf("sow")).toBeCloseTo(config.feed.sowFeedCostKg, 6);
    expect(supplies.priceOf("weaner")).toBeCloseTo(config.feed.weanerFeedCostKg, 6);
    expect(supplies.priceOf("weaner")).toBeGreaterThan(supplies.priceOf("sow") * 5);

    // And what the stores are worth is what the two lines cost, added up.
    expect(supplies.value("sow")).toBeCloseTo(sowKg * config.feed.sowFeedCostKg, 6);
    expect(supplies.value("weaner")).toBeCloseTo(weanerKg * config.feed.weanerFeedCostKg, 6);
  });

  it("still splits the journey by weight, because a journey is shared", () => {
    const config = plan();
    const supplies = stockedUp(config);

    // Haulage is the one cost on a delivery note that really is the load's
    // rather than the goods': a kilogram takes a kilogram's share of the trip
    // whatever the kilogram happens to be. So the two rations, unlike their
    // prices, do carry the same haulage.
    expect(supplies.haulagePerKg("sow")).toBeGreaterThan(0);
    expect(supplies.haulagePerKg("weaner")).toBeCloseTo(supplies.haulagePerKg("sow"), 9);
  });

  it("bills the supplier for the same money it put in the bins", () => {
    const config = plan();
    const supplies = stockedUp(config);

    // The split changed; the total did not. What is owed is still the goods plus
    // the journeys, and settling it takes exactly that out of the bank.
    const held = FEED_RATIONS.reduce((money, ration) => money + supplies.value(ration), 0);
    const paid = supplies.settleDue(config.feed.supplierPaymentDays);
    const goods = FEED_RATIONS.reduce((money, ration) => money + paid.byStore[ration], 0);

    expect(goods).toBeCloseTo(held, 6);
    expect(paid.delivery).toBeGreaterThan(0);
    expect(paid.total).toBeCloseTo(goods + paid.delivery, 6);
    expect(supplies.payables).toBeCloseTo(0, 6);
  });

  it("carries the emergency premium onto the line that was rushed", () => {
    const config = plan();
    const supplies = new Supplies(config, true, true);
    supplies.openStores(0, { sow: 40 });
    supplies.arrive(0);
    const listed = supplies.priceOf("sow");
    expect(listed).toBeCloseTo(config.feed.sowFeedCostKg, 6);

    supplies.emergency(1, { weaner: 500 });
    supplies.arrive(1 + config.feed.emergencyLeadDays);
    const premium = 1 + config.feed.emergencyPremiumPct / 100;

    // The ration that ran dry is billed at its own list price plus the premium,
    // not at the premium on the average of the lorry.
    expect(supplies.priceOf("weaner")).toBeCloseTo(config.feed.weanerFeedCostKg * premium, 6);

    // And the bin that did not run dry is dearer than it was, because the rushed
    // lorry had deck to spare and topped it up — at the rushed price, since the
    // whole load is one order to one supplier on one day. It is worth knowing
    // that is what the farm is buying: the premium is the price of the journey
    // being unplanned, and everything that rides on it pays it.
    expect(supplies.priceOf("sow")).toBeGreaterThan(listed);
    expect(supplies.priceOf("sow")).toBeLessThan(config.feed.sowFeedCostKg * premium);
  });
});
