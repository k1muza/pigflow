import { describe, expect, it } from "vitest";

import type { StoreId } from "./haulage";
import { planLoads, type Claim } from "./loadout";

const DECK = 2_800;
const BOTTLE = 48;

/** A store that wants nothing and has room for plenty, to be overridden. */
function claim(store: StoreId, over: Partial<Claim> = {}): Claim {
  return {
    store,
    coverDays: 30,
    due: false,
    needKg: 0,
    maxKg: 6_000,
    unitKg: 0,
    ...over,
  };
}

/** What one load is carrying of a store, which is 0 if it is not aboard. */
function kgOf(lines: { store: StoreId; kg: number }[], store: StoreId): number {
  return lines.find((line) => line.store === store)?.kg ?? 0;
}

describe("A lorry goes out for something, and comes back full", () => {
  it("sends nothing at all when no store is due", () => {
    // The rule the whole thing rests on. A farm with three weeks of everything
    // in front of it does not send a vehicle, however much room the bins have.
    const loads = planLoads(
      [claim("sow"), claim("weaner"), claim("gas", { unitKg: BOTTLE, maxKg: 96 })],
      DECK,
    );
    expect(loads).toEqual([]);
  });

  it("fills the deck behind the one store that sent for it", () => {
    // The case this was written for: 48 kg of gas is what the farm has run out
    // of, and 48 kg is what used to go on a 2.8 tonne lorry.
    const [load, ...rest] = planLoads(
      [
        claim("gas", { coverDays: 2, due: true, needKg: 40, maxKg: 96, unitKg: BOTTLE }),
        claim("finisher", { coverDays: 9, maxKg: 2_000 }),
        claim("sow", { coverDays: 20, maxKg: 2_000 }),
      ],
      DECK,
    );

    expect(rest).toEqual([]);
    expect(load.payloadKg).toBeCloseTo(DECK, 6);
    // The lorry is here, so the yard is filled rather than the one bottle that
    // was asked for — which is a second journey the farm now does not make.
    expect(kgOf(load.lines, "gas")).toBe(96);
    // The rest goes to the store that runs out next, not to the biggest bin:
    // the finisher feed fills what it can and the sow feed takes the remainder.
    expect(kgOf(load.lines, "finisher")).toBeCloseTo(2_000, 6);
    expect(kgOf(load.lines, "sow")).toBeCloseTo(DECK - 96 - 2_000, 6);
  });

  it("tops up in the same order it was loaded in", () => {
    // The spare deck is not shared out evenly: it goes to the store that will
    // want it first. A bin three days from empty is filled before one that has
    // most of a month in it, even though both had the same room to spare.
    const [load] = planLoads(
      [
        claim("weaner", { coverDays: 3, due: true, needKg: 1_500, maxKg: 6_000 }),
        claim("sow", { coverDays: 25, maxKg: 6_000 }),
      ],
      DECK,
    );
    expect(load.payloadKg).toBeCloseTo(DECK, 6);
    expect(kgOf(load.lines, "weaner")).toBeCloseTo(DECK, 6);
    expect(kgOf(load.lines, "sow")).toBe(0);
  });

  it("spills onto a second lorry when one deck will not hold the order", () => {
    const loads = planLoads(
      [
        claim("sow", { coverDays: 1, due: true, needKg: 4_000, maxKg: 6_000 }),
        claim("creep", { coverDays: 2, due: true, needKg: 500, maxKg: 6_000 }),
      ],
      DECK,
    );
    expect(loads).toHaveLength(2);
    // Urgency decides who gets the first deck, and it goes out full.
    expect(loads[0].payloadKg).toBeCloseTo(DECK, 6);
    expect(kgOf(loads[0].lines, "sow")).toBeCloseTo(DECK, 6);
    // The order is 4,500 kg; the second lorry carries the rest and is topped up.
    expect(loads[1].payloadKg).toBeCloseTo(DECK, 6);
  });

  it("never tips in more than the store will hold", () => {
    const [load] = planLoads(
      [claim("gas", { coverDays: 0, due: true, needKg: 500, maxKg: 96, unitKg: BOTTLE })],
      DECK,
    );
    // Two bottles is the whole yard, however much the deck could have carried.
    expect(kgOf(load.lines, "gas")).toBe(2 * BOTTLE);
    expect(load.payloadKg).toBe(2 * BOTTLE);
  });

  it("buys goods that come in units by the unit", () => {
    // 30 kg of gas is a bottle, because a part-filled bottle is still a bottle.
    const [ordered] = planLoads(
      [claim("gas", { coverDays: 1, due: true, needKg: 30, maxKg: BOTTLE, unitKg: BOTTLE })],
      DECK,
    );
    expect(kgOf(ordered.lines, "gas")).toBe(BOTTLE);

    // And a yard with only 30 kg of room takes nothing: there is nowhere to
    // stand a bottle, so the farm waits for an empty rather than decanting one.
    const [cramped] = planLoads(
      [
        claim("sow", { coverDays: 1, due: true, needKg: 1_000, maxKg: 6_000 }),
        claim("gas", { coverDays: 4, maxKg: 30, unitKg: BOTTLE }),
      ],
      DECK,
    );
    expect(kgOf(cramped.lines, "gas")).toBe(0);
  });

  it("orders the queue by time of use and not by how much is wanted", () => {
    // Two stores, one deck, and not enough of it. The one that runs out on
    // Tuesday is loaded ahead of the one that wants ten times as much on Friday.
    const [load] = planLoads(
      [
        claim("creep", { coverDays: 2, due: true, needKg: 400, maxKg: 400 }),
        claim("finisher", { coverDays: 5, due: true, needKg: 9_000, maxKg: 9_000 }),
      ],
      DECK,
    );
    expect(kgOf(load.lines, "creep")).toBeCloseTo(400, 6);
    expect(kgOf(load.lines, "finisher")).toBeCloseTo(DECK - 400, 6);
  });

  it("reads the order heaviest first, the way a delivery note does", () => {
    const [load] = planLoads(
      [
        claim("gas", { coverDays: 1, due: true, needKg: 40, maxKg: 96, unitKg: BOTTLE }),
        claim("sow", { coverDays: 6, maxKg: 1_000 }),
        claim("weaner", { coverDays: 4, maxKg: 500 }),
      ],
      DECK,
    );
    const kg = load.lines.map((line) => line.kg);
    expect([...kg].sort((a, b) => b - a)).toEqual(kg);
    expect(load.payloadKg).toBeCloseTo(
      kg.reduce((sum, one) => sum + one, 0),
      6,
    );
  });

  it("ignores a store with nowhere to put anything", () => {
    const loads = planLoads(
      [
        claim("sow", { coverDays: 0, due: true, needKg: 900, maxKg: 0 }),
        claim("weaner", { coverDays: 8, maxKg: 400 }),
      ],
      DECK,
    );
    // The only due store has a full bin, so there is nothing to send for and no
    // lorry — the weaner top-up does not get to invent a journey of its own.
    expect(loads).toEqual([]);
  });
});
