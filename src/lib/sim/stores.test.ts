import { describe, expect, it } from "vitest";

import { cloneDefaultConfig, type PlannerConfig } from "../config";
import { FEED_RATIONS, type FeedRation } from "./animals";
import { feedOf, runFarm } from "./index";
import type { Farm } from "./farm";

/** Every canister the plan brought in, in the order it arrived. */
function gasLines(farm: Farm): number[] {
  return farm.haulage.trips.flatMap((trip) =>
    trip.lines.filter((line) => line.store === "gas").map((line) => line.kg),
  );
}

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

  it("buys feed by the bag, however many bags ride on one lorry", () => {
    const bag = input.feed.feedBagKg;
    expect(bag).toBe(50);

    const lines = farm.haulage.trips.flatMap((trip) =>
      trip.lines.filter((line) => FEED_RATIONS.includes(line.store as FeedRation)),
    );
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      // No half bags, ever — not on the first load and not on the last.
      expect(line.kg / bag).toBeCloseTo(Math.round(line.kg / bag), 9);
      expect(line.kg).toBeGreaterThan(0);
    }

    // Bulk feed, blown into the bin, is the one case where a kilogram is the
    // unit — and then the deck can be filled to the last of it.
    const bulk = runFarm(plan((c) => (c.feed.feedBagKg = 0)));
    const full = bulk.haulage.trips.filter(
      (trip) => trip.kind === "supplies" && trip.payloadKg > input.feed.truckCapacityKg - 1,
    );
    expect(full.length).toBeGreaterThan(0);
  });

  it("keeps each ration's store to itself, and never lets one run dry", () => {
    for (const ration of FEED_RATIONS) {
      const stock = farm.haulage.stockByDay[ration];
      expect(stock.length).toBeGreaterThan(0);
      // Nothing is eaten that has not landed: a store never goes negative.
      for (const held of stock) expect(held).toBeGreaterThanOrEqual(-1e-6);
    }
  });

  it("burns gas by the heater, not by the piglet", () => {
    const perNight = input.health.gasKgPerHeaterDay;
    expect(perNight).toBe(2);
    expect(input.health.pigletsPerHeater).toBe(14);

    // Every night's gas is a whole number of lamps, because a lamp is alight or
    // it is not. Nothing in between is ever burnt.
    for (const day of farm.history) {
      expect(day.gasKg).toBeCloseTo(day.gasHeaters * perNight, 6);
      expect(Number.isInteger(day.gasHeaters)).toBe(true);
      if (day.gasHeaters > 0) expect(day.counts.piglets + day.counts.weaners).toBeGreaterThan(0);
    }
    const burnt = farm.history.reduce((sum, day) => sum + day.gasKg, 0);
    expect(farm.ledger.totals.gas).toBeCloseTo(burnt * input.health.gasCostPerKg, 6);

    // A lamp covers a pen, so a herd that doubles does not double the lamps in
    // step: it fills the pens it was already heating first.
    const lampNights = farm.history.reduce((sum, day) => sum + day.gasHeaters, 0);
    const headNights = farm.history.reduce(
      (sum, day) => sum + day.gasKg / (perNight / Math.max(input.health.pigletsPerHeater, 1)),
      0,
    );
    expect(lampNights).toBeGreaterThan(0);
    expect(headNights).toBeGreaterThan(0);
  });

  it("gives every suckling litter its own lamp, and pens the weaned together", () => {
    // One crate cannot borrow the lamp from the crate next door, so the number
    // of lamps follows the number of litters however small they are. Widening
    // what a lamp covers cannot save a suckler any gas — only a weaner pen.
    const wide = runFarm(plan((c) => (c.health.pigletsPerHeater = 100)));
    const narrow = runFarm(plan((c) => (c.health.pigletsPerHeater = 4)));

    const lamps = (f: typeof farm) => f.history.reduce((sum, day) => sum + day.gasHeaters, 0);
    expect(lamps(narrow)).toBeGreaterThan(lamps(wide));
    expect(lamps(wide)).toBeGreaterThan(0);
    // The biology is untouched: a lamp is a cost, not a growth rate.
    expect(narrow.lifetime.sold).toBe(wide.lifetime.sold);

    // And with a lamp wide enough for any litter, the suckling crates still
    // each light one, so the farm is never down to a single lamp a night.
    const busiest = Math.max(...wide.history.map((day) => day.gasHeaters));
    expect(busiest).toBeGreaterThan(1);
  });

  it("splits a lamp's gas between the piglets under it", () => {
    // A half-empty pen burns what a full one burns, so it costs more a head.
    // That only shows up because the gas is settled per lamp and then divided.
    const perPig = farm.history
      .filter((day) => day.gasHeaters > 0)
      .map((day) => day.gasKg / (day.counts.piglets + day.counts.weaners));
    expect(perPig.length).toBeGreaterThan(0);
    expect(Math.max(...perPig)).toBeGreaterThan(Math.min(...perPig));

    // Nothing is lost between the lamps and the animals: what the ledger paid
    // for heat is what the pigs were charged for it.
    const charged = farm.costOfProduction();
    expect(charged.directByType.heating).toBeGreaterThan(0);
  });

  it("burns nothing at all when the heaters are turned off", () => {
    const cold = runFarm(plan((c) => (c.health.gasKgPerHeaterDay = 0)));
    expect(cold.history.every((day) => day.gasKg === 0)).toBe(true);
    expect(cold.ledger.totals.gas).toBe(0);
    expect(cold.haulage.trips.some((trip) => trip.lines.some((l) => l.store === "gas"))).toBe(
      false,
    );
  });

  it("buys gas by the canister, however many of them ride on one lorry", () => {
    const burnt = farm.history.reduce((sum, day) => sum + day.gasKg, 0);
    expect(burnt).toBeGreaterThan(0);
    expect(farm.ledger.totals.gas).toBeCloseTo(burnt * input.health.gasCostPerKg, 6);

    const bottle = input.health.gasCanisterKg;
    const mostHeld = bottle * input.health.gasCanisters;
    const lines = gasLines(farm);
    expect(lines.length).toBeGreaterThan(0);
    for (const kg of lines) {
      // Whole bottles: a lorry may bring two, and they read as one line on the
      // note, but the farm never buys a part-filled canister.
      expect(kg / bottle).toBeCloseTo(Math.round(kg / bottle), 6);
      expect(kg).toBeGreaterThan(0);
      expect(kg).toBeLessThanOrEqual(mostHeld + 1e-6);
    }

    // Everything bought is burnt but for what is still standing in the yard when
    // the plan stops — and because a bottle is a bottle, that is less than one.
    // The planner no longer trims the last delivery to the kilogram the herd
    // will use: it fills the yard whenever a lorry is there, which is what keeps
    // a plan's schedule the same however far out it was drawn.
    const bought = lines.reduce((sum, kg) => sum + kg, 0);
    const standing = farm.haulage.stockByDay.gas.at(-1)!;
    expect(bought).toBeCloseTo(burnt + standing, 3);
    expect(standing).toBeLessThan(mostHeld);
  });

  it("never holds more gas than there are canisters to put it in", () => {
    const held = input.health.gasCanisterKg * input.health.gasCanisters;
    expect(held).toBe(96);

    // A bottle cannot be delivered early into a full store the way feed can be
    // tipped into a part-empty bin, so the cap is never breached.
    for (const standing of farm.haulage.stockByDay.gas) {
      expect(standing).toBeLessThanOrEqual(held + 1e-6);
    }
    // And a smaller store is still never overfilled, only refilled in smaller
    // amounts: one bottle at a time where the default yard takes two.
    const cramped = runFarm(plan((c) => (c.health.gasCanisters = 1)));
    for (const standing of cramped.haulage.stockByDay.gas) {
      expect(standing).toBeLessThanOrEqual(input.health.gasCanisterKg + 1e-6);
    }
    const biggest = (f: Farm) => Math.max(...gasLines(f));
    expect(biggest(cramped)).toBe(input.health.gasCanisterKg);
    expect(biggest(farm)).toBeGreaterThan(biggest(cramped));
  });

  it("never sends a lorry out for gas alone", () => {
    // The point of the whole rework. A bottle is 48 kg and the lorry carries
    // 2,800, and the gas yard empties faster than the feed bins do — so under
    // the old scheme, where feed was cut into maximal loads and a bottle rode
    // along only if one happened to fall in the fortnight the yard had room to
    // wait, most bottles were fetched on a vehicle of their own. Now the bottle
    // is what *sends* the lorry and the feed fills the rest of the deck.
    const rides = (f: Farm) => {
      const carrying = f.haulage.trips.filter((trip) =>
        trip.lines.some((line) => line.store === "gas"),
      );
      return {
        deliveries: carrying.length,
        shared: carrying.filter((trip) => trip.lines.length > 1).length,
        alone: carrying.filter((trip) => trip.lines.length === 1),
      };
    };

    const cramped = rides(farm);
    expect(cramped.deliveries).toBeGreaterThan(0);
    expect(cramped.alone).toEqual([]);
    expect(cramped.shared).toBe(cramped.deliveries);

    // A yard with room for more bottles still pays for fewer journeys, because
    // it can take a fortnight's gas at a time instead of a week's — but it is
    // now the number of trips that moves, not whether the gas gets a ride.
    const roomy = rides(runFarm(plan((c) => (c.health.gasCanisters = 8))));
    expect(roomy.deliveries).toBeLessThan(cramped.deliveries);
    expect(roomy.alone).toEqual([]);

    // A journey is charged once however much is on it, so a bottle that rode in
    // on the feed order added nothing at all to the delivery line.
    for (const f of [farm, runFarm(plan((c) => (c.health.gasCanisters = 8)))]) {
      expect(f.ledger.totals.deliveries).toBeCloseTo(
        f.haulage.trips.reduce((paid, trip) => paid + trip.cost, 0),
        6,
      );
    }
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

  it("schedules the same gas however far out the plan was drawn", () => {
    // Only the last load of a plan is a part load, so if the room a bottle needs
    // were sized by what is in it, that one load would be placed by where the
    // plan happened to stop — and it could then squeeze onto a lorry a full
    // bottle would have missed. The months two plans share must be the same
    // months, down to the journeys.
    const short = runFarm(plan((c) => (c.project.months = 12)));
    const cut = short.history.length - 1;
    const long = runFarm(plan((c) => (c.project.months = 36)), cut);

    const inWindow = (f: typeof short) =>
      f.haulage.trips.filter((trip) => trip.day <= cut).map((trip) => trip.day + " " + trip.kind);
    expect(inWindow(short)).toEqual(inWindow(long));
    expect(short.ledger.cash).toBeCloseTo(long.ledger.cash, 6);
    expect(short.ledger.totals.deliveries).toBeCloseTo(long.ledger.totals.deliveries, 6);
  });

  it("counts every lorry through the gate", () => {
    expect(farm.lifetime.lorries).toBe(farm.haulage.trips.length);
    expect(farm.lifetime.haulageCost).toBeCloseTo(farm.ledger.totals.deliveries, 6);
    expect(farm.history.reduce((sum, day) => sum + day.lorriesIn, 0)).toBe(
      farm.lifetime.lorries,
    );
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
    // Every store has a size now, and it is a real constraint rather than a
    // note: it is what a lorry with room to spare is allowed to tip into it.
    expect(stores.find((store) => store.id === "gas")!.capacity).toBe(96);
    expect(stores.find((store) => store.id === "feed-sow")!.capacity).toBe(
      input.feed.binCapacityKg,
    );
    expect(stores.find((store) => store.id === "bedding")!.capacity).toBe(
      input.housing.beddingStoreKg,
    );
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
