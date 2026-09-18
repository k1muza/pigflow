import { describe, expect, it } from "vitest";

import { cloneDefaultConfig, type PlannerConfig } from "../config";
import { FEED_RATIONS } from "./animals";
import { feedOf, runFarm } from "./index";

function plan(tweak: (input: PlannerConfig) => void = () => {}) {
  const input = cloneDefaultConfig();
  input.project.months = 24;
  input.project.variation = "settled";
  tweak(input);
  return input;
}

describe("Every consumable is its own store", () => {
  const input = plan();
  const farm = runFarm(input);

  it("charges each ration to its own line, and they add to the feed bill", () => {
    const totals = farm.ledger.totals;
    for (const ration of FEED_RATIONS) {
      const kg = farm.history.reduce((sum, day) => sum + day.feedByRation[ration], 0);
      expect(kg).toBeGreaterThan(0);
    }
    // Five lines, not one, and each priced at its own ration's rate.
    const priced =
      farm.history.reduce((sum, day) => sum + day.feedByRation.sow, 0) * input.feed.sowFeedCostKg;
    expect(totals["feed-sow"]).toBeCloseTo(priced, 6);
    expect(feedOf(totals)).toBeCloseTo(
      totals["feed-sow"] +
        totals["feed-creep"] +
        totals["feed-weaner"] +
        totals["feed-grower"] +
        totals["feed-finisher"],
      6,
    );
  });

  it("keeps each ration's store to itself, and never lets one run dry", () => {
    for (const ration of FEED_RATIONS) {
      const stock = farm.feedPlan.stockByDay[ration];
      expect(stock.length).toBeGreaterThan(0);
      // Nothing is eaten that has not landed: a store never goes negative.
      for (const held of stock) expect(held).toBeGreaterThanOrEqual(-1e-6);
    }
  });

  it("burns gas as a quantity and buys it a canister at a time", () => {
    const burnt = farm.history.reduce((sum, day) => sum + day.gasKg, 0);
    expect(burnt).toBeGreaterThan(0);
    expect(farm.ledger.totals.gas).toBeCloseTo(burnt * input.health.gasCostPerKg, 6);

    const bottles = farm.gasPlan.deliveries;
    expect(bottles.length).toBeGreaterThan(0);
    for (const load of bottles.slice(0, -1)) {
      expect(load.quantity).toBeCloseTo(input.health.gasCanisterKg, 6);
    }
    expect(bottles.reduce((sum, load) => sum + load.quantity, 0)).toBeCloseTo(burnt, 3);
  });

  it("never holds more gas than there are canisters to put it in", () => {
    const held = input.health.gasCanisterKg * input.health.gasCanisters;
    expect(held).toBe(96);

    // A bottle cannot be delivered early into a full store the way feed can be
    // tipped into a part-empty bin, so the cap is never breached.
    for (const standing of farm.gasPlan.stockByDay) {
      expect(standing).toBeLessThanOrEqual(held + 1e-6);
    }
    // And a smaller store is still never overfilled, only visited more often.
    const cramped = runFarm(plan((c) => (c.health.gasCanisters = 1)));
    for (const standing of cramped.gasPlan.stockByDay) {
      expect(standing).toBeLessThanOrEqual(input.health.gasCanisterKg + 1e-6);
    }
    expect(cramped.gasPlan.deliveries.length).toBeGreaterThanOrEqual(
      farm.gasPlan.deliveries.length,
    );
  });

  it("carries the gas on the feed lorry rather than sending its own", () => {
    const feedDays = new Set(farm.feedPlan.deliveries.map((load) => load.day));
    const sharedTrips = farm.gasPlan.deliveries.filter((load) => feedDays.has(load.day));
    const ownTrips = farm.gasPlan.deliveries.filter((load) => !feedDays.has(load.day));

    // Most canisters come with the feed, because a bottle waits for the lorry
    // rather than sending one: the store has room for it long before it is
    // needed, so there is a wide choice of days it could ride in on.
    expect(sharedTrips.length + ownTrips.length).toBe(farm.gasPlan.deliveries.length);
    expect(sharedTrips.length).toBeGreaterThan(ownTrips.length);

    const feedTrips = farm.feedPlan.deliveries.length * input.feed.deliveryCostPerTrip;
    const beddingTrips =
      farm.beddingPlan.deliveries.length * input.housing.beddingDeliveryCost;
    expect(farm.ledger.totals.deliveries).toBeCloseTo(
      feedTrips + ownTrips.length * input.feed.deliveryCostPerTrip + beddingTrips,
      6,
    );
  });

  it("beds down the animals actually housed, not the calendar", () => {
    const head = farm.history.reduce((sum, day) => sum + day.counts.total, 0);
    const used = farm.history.reduce((sum, day) => sum + day.beddingKg, 0);

    // Bedding is laid under the herd standing when it is laid, which is a shade
    // more than the roster at the close of the day: an animal sold or lost that
    // afternoon still lay on it that morning.
    const onTheRoster = head * input.housing.beddingKgPerHeadDay;
    expect(used).toBeGreaterThanOrEqual(onTheRoster);
    expect(used).toBeLessThan(onTheRoster * 1.02);
    expect(farm.ledger.totals.bedding).toBeCloseTo(used * input.housing.beddingCostPerKg, 6);

    // The point of the change: a bigger herd beds down for more money, where the
    // flat monthly figure this replaced charged every herd the same.
    const bigger = runFarm(
      plan((c) => {
        c.herd.maxSows = 60;
        c.stock.sows = 60;
        c.housing.farrowingPlaces = 60;
        c.housing.weanerPlaces = 400;
        c.housing.growerPlaces = 400;
        c.housing.finisherPlaces = 800;
      }),
    );
    expect(bigger.ledger.totals.bedding).toBeGreaterThan(farm.ledger.totals.bedding * 2);
  });

  it("counts every store's loads through the gate", () => {
    expect(farm.lifetime.storeLoads).toBe(
      farm.gasPlan.deliveries.length + farm.beddingPlan.deliveries.length,
    );
    expect(farm.lifetime.feedLoads).toBe(farm.feedPlan.deliveries.length);
  });

  it("reports what each store holds on the day being read", () => {
    const opening = runFarm(input, 0).state();
    const stores = opening.stores;

    // One line per store, priced at what it cost, with the days it will last.
    expect(stores.map((store) => store.id)).toEqual([
      "feed-sow",
      "feed-creep",
      "feed-weaner",
      "feed-grower",
      "feed-finisher",
      "gas",
      "bedding",
    ]);
    expect(stores.reduce((total, store) => total + store.value, 0)).toBeCloseTo(
      opening.finance.storeValue,
      6,
    );
    // Only the gas is limited by something other than money.
    expect(stores.find((store) => store.id === "gas")!.capacity).toBe(96);
    expect(stores.find((store) => store.id === "feed-sow")!.capacity).toBeNull();
    for (const store of stores) {
      expect(store.quantity).toBeGreaterThanOrEqual(0);
      if (store.daysOfCover !== null) expect(store.daysOfCover).toBeGreaterThan(0);
    }
  });

  it("counts what is standing in the stores as worth something", () => {
    // A farm that has just taken a lorry has turned cash into feed, not lost it.
    const opening = runFarm(input, 0).state();
    expect(opening.finance.storeValue).toBeGreaterThan(0);
    expect(opening.finance.netWorth).toBeCloseTo(
      opening.finance.cash + opening.finance.herdValue,
      6,
    );
    expect(opening.finance.herdValue).toBeGreaterThanOrEqual(opening.finance.storeValue);
  });
});

describe("Consumables that come in packs are paid for by the pack", () => {
  it("charges the whole vial when one is opened for a single litter", () => {
    const byDose = runFarm(
      plan((c) => {
        for (const job of c.health.vaccinations) job.dosesPerPack = 1;
      }),
    );
    const byVial = runFarm(
      plan((c) => {
        for (const job of c.health.vaccinations) {
          if (job.kind === "vaccination") job.dosesPerPack = 50;
        }
      }),
    );

    // Same pigs, same needles — but a fifty dose vial opened for a small herd is
    // paid for whole, so the bill is higher and the biology is not.
    expect(byVial.lifetime.sold).toBe(byDose.lifetime.sold);
    expect(byVial.ledger.totals.vaccination).toBeGreaterThan(byDose.ledger.totals.vaccination);
    // Nothing is wasted on the jobs bought by the dose.
    expect(byVial.ledger.totals.processing).toBeCloseTo(byDose.ledger.totals.processing, 6);
  });

  it("throws away what is left in a pack when its days run out", () => {
    // Same vial, same doses in it — the only difference is how long it keeps
    // once broached. A herd that cannot use fifty doses inside a month opens
    // more vials and pays for more of them.
    const keepsForever = runFarm(
      plan((c) => {
        for (const job of c.health.vaccinations) {
          if (job.kind === "vaccination") {
            job.dosesPerPack = 50;
            job.openPackKeepsDays = 0;
          }
        }
      }),
    );
    const keepsAMonth = runFarm(
      plan((c) => {
        for (const job of c.health.vaccinations) {
          if (job.kind === "vaccination") {
            job.dosesPerPack = 50;
            job.openPackKeepsDays = 28;
          }
        }
      }),
    );
    const keepsADay = runFarm(
      plan((c) => {
        for (const job of c.health.vaccinations) {
          if (job.kind === "vaccination") {
            job.dosesPerPack = 50;
            job.openPackKeepsDays = 1;
          }
        }
      }),
    );

    expect(keepsAMonth.ledger.totals.vaccination).toBeGreaterThan(
      keepsForever.ledger.totals.vaccination,
    );
    // A pack that keeps a day is a pack per batch: the shortest life is dearest.
    expect(keepsADay.ledger.totals.vaccination).toBeGreaterThan(
      keepsAMonth.ledger.totals.vaccination,
    );
    // And none of it touches the pigs.
    expect(keepsADay.lifetime.sold).toBe(keepsForever.lifetime.sold);
  });

  it("draws the rest of an opened pack down before opening another", () => {
    const wasteful = runFarm(plan((c) => {
      for (const job of c.health.vaccinations) {
        if (job.id === "mycoplasma") job.dosesPerPack = 50;
      }
    }));
    const single = runFarm(plan((c) => {
      for (const job of c.health.vaccinations) {
        if (job.id === "mycoplasma") job.dosesPerPack = 1;
      }
    }));

    // A pack covers fifty piglets, so the bill is a whole number of packs rather
    // than one pack for every pig through the gate.
    const extra = wasteful.ledger.totals.vaccination - single.ledger.totals.vaccination;
    const dosed = single.ledger.totals.vaccination;
    expect(extra).toBeGreaterThan(0);
    expect(extra).toBeLessThan(dosed);
  });
});
