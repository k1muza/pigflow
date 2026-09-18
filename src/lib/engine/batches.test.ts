import { describe, expect, it } from "vitest";

import { cloneDefaultConfig, type PlannerConfig } from "../config";
import { runEngine } from "./engine";

/**
 * Housing as a throughput ceiling.
 *
 * Places used to delay a movement and constrain nothing. A pig held back for
 * want of a finishing place went on growing where it stood and was sold out of
 * the weaner house, so a farm could run its whole herd through a shed it had no
 * room for. Two rules together close that: a market pig is only sold out of the
 * finishing house, and the thing that is given a place is the pen rather than
 * the animal.
 */

const DAYS = 1_000;

function plan(tweak: (input: PlannerConfig) => void = () => {}): PlannerConfig {
  const input = cloneDefaultConfig();
  input.project.months = 36;
  input.project.variation = "settled";
  input.stock.sows = 20;
  input.herd.startMode = "staggered";
  input.herd.maxSows = 20;
  tweak(input);
  return input;
}

function withFinisherPlaces(places: number) {
  const input = plan((config) => (config.housing.finisherPlaces = places));
  return { input, run: runEngine(input, DAYS) };
}

describe("Finishing places are a ceiling on what the farm can sell", () => {
  it("sells fewer pigs the less finishing accommodation there is", () => {
    const roomy = withFinisherPlaces(800).run;
    const tight = withFinisherPlaces(40).run;
    const cramped = withFinisherPlaces(5).run;

    // The whole point: the shed is a real constraint, and a monotonic one.
    expect(tight.lifetime.sold).toBeLessThan(roomy.lifetime.sold);
    expect(cramped.lifetime.sold).toBeLessThan(tight.lifetime.sold);

    // Room enough and nothing queues at all — the ceiling is not a tax the model
    // charges every farm, it is what a short farm runs into.
    expect(roomy.lifetime.heldAtSaleWeightDays).toBe(0);
    expect(cramped.lifetime.heldAtSaleWeightDays).toBeGreaterThan(0);
  });

  it("holds sale-weight pigs outside the finisher rather than selling them", () => {
    const { input, run } = withFinisherPlaces(5);

    // They are at weight and they are not sold, because they are in the wrong
    // house. They are not lost either: they are a queue the farm can see.
    const worstDay = run.history.reduce(
      (most, day) => Math.max(most, day.heldAtSaleWeight),
      0,
    );
    expect(worstDay).toBeGreaterThan(0);

    const warned = run.world.log.events.filter((event) => event.type === "SaleHeldForSpace");
    expect(warned.length).toBeGreaterThan(0);
    expect(warned[0].message).toMatch(/sale-weight pigs? (is|are) held outside finishing/);
    expect(warned[0].room).toBe("finisher");

    // And they go on eating while they wait, which is the cost of being short of
    // a shed: more feed for the same pig, and the sale later than it should be.
    const roomy = withFinisherPlaces(800).run;
    const feedPerPig = (engine: typeof run) =>
      engine.lifetime.feedDeliveredKg / Math.max(engine.lifetime.sold, 1);
    expect(feedPerPig(run)).toBeGreaterThan(feedPerPig(roomy));
    expect(input.housing.finisherPlaces).toBe(5);
  });

  it("splits a pen when the next house has room for part of it", () => {
    const { run } = withFinisherPlaces(40);
    expect(run.lifetime.batchesSplit).toBeGreaterThan(0);

    const splits = run.world.log.events.filter((event) => event.type === "BatchSplit");
    expect(splits.length).toBeGreaterThan(0);
    // A split is a decision with a record, not a silent reshuffle: it says how
    // many went, how many stayed and which pen they came out of.
    expect(splits[0].changes).toMatchObject({ moved: expect.any(Number) });
    expect(splits[0].message).toMatch(/stay behind for want of a place/);
  });

  it("keeps a child pen's parentage, birth range and housing history", () => {
    const { run } = withFinisherPlaces(40);
    const children = run.world.batches.all().filter((batch) => batch.parentId !== null);
    expect(children.length).toBeGreaterThan(0);

    for (const batch of children.slice(0, 20)) {
      expect(batch.parentId).toMatch(/^B\d+$/);
      expect(batch.bornTo).toBeGreaterThanOrEqual(batch.bornFrom);
      // It has stood somewhere before wherever it is now, and the record of it
      // survived the split.
      expect(batch.history.length).toBeGreaterThan(0);
      expect(batch.history.at(-1)!.room).toBe(batch.room);
      expect(batch.members.size).toBeGreaterThan(0);
    }
  });

  it("does not deadlock when the house is smaller than the pen", () => {
    // The reason movement splits instead of being strictly atomic. A pen of
    // thirty headed for a shed with one place would wait for a place that can
    // never exist, and the farm would stop selling entirely.
    const single = withFinisherPlaces(1).run;
    expect(single.lifetime.sold).toBeGreaterThan(0);
    expect(single.lifetime.batchesSplit).toBeGreaterThan(0);
  });

  it("drafts a selected gilt out of the pen instead of carrying her in it", () => {
    // She is not going to the next house, so the batch rules do not apply to
    // her. Left in the pen she earned no room and was never promoted either —
    // one such pig reached 608 kg and held the only finishing place for a whole
    // plan while every market pig behind her queued at sale weight.
    const { input, run } = withFinisherPlaces(1);
    const carried = run.world.pigs.filter(
      (pig) =>
        pig.alive &&
        pig.destination === "breeding" &&
        pig.weightKg >= input.herd.giltServiceWeightKg &&
        pig.stage !== "gilt",
    );
    expect(carried).toEqual([]);

    // And the farm does still breed its own replacements under the ceiling.
    expect(run.lifetime.giltsSelected).toBeGreaterThan(0);
    expect(run.world.sows.filter((sow) => sow.alive).length).toBeGreaterThan(0);
  });

  it("leaves held market pigs growing without a mature weight to stop them", () => {
    // Not an assertion that this is right — it is a marker on something the
    // ceiling has exposed. Growth here is stage and thriftiness and nothing
    // else: there is no mature weight and no plateau, so a pig that queues long
    // enough simply keeps gaining. Starve a farm of finishing places and market
    // pigs sit in the grower house for two years and pass 600 kg, which is not a
    // pig. The queue is real modelling; the animal at the end of it is not.
    //
    // Fixing it belongs with condition-dependent performance, where a gain
    // factor can fall away as a pig approaches its mature weight. Until then
    // this test says plainly that the behaviour is known, so that nobody reads
    // a 600 kg grower as a finding about housing.
    const { input, run } = withFinisherPlaces(1);
    const overgrown = run.world.pigs.filter(
      (pig) => pig.alive && pig.weightKg > input.growth.saleWeightKg * 4,
    );
    expect(overgrown.length).toBeGreaterThan(0);
    expect(overgrown.every((pig) => pig.destination === "market")).toBe(true);
    // They are queuing, not lost: every one of them is held somewhere upstream.
    expect(overgrown.every((pig) => pig.heldSinceDay !== null)).toBe(true);
  });
});
