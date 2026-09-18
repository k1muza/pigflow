import { describe, expect, it } from "vitest";

import { cloneDefaultConfig, type PlannerConfig } from "../config";
import { Engine, runEngine } from "./engine";

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

  it("walks a pen through the grower house rather than round it", () => {
    // Weight says whether a pen is ready to move. It must not say where to,
    // because there is only one room after each room.
    //
    // Shut a pen out of the grower house and it goes on growing in the weaner
    // pens; in a few weeks it is heavy enough for the finisher house. When the
    // destination was read off weight alone it was then sent there directly, out
    // of the weaner pens, and the grower house was never entered at all — on this
    // plan 32 pigs went that way and more pigs reached the finishing house than
    // ever reached the grower house, which is not a thing that can happen on a
    // farm. Grower places became something a plan could grow its way around, and
    // the queue a shortage causes landed one room downstream of the shortage.
    const input = plan((config) => {
      config.housing.growerPlaces = 1;
      config.housing.finisherPlaces = 400;
    });
    const engine = new Engine(input);
    const standing = new Map<string, string>();
    let skipped = 0;
    let toGrower = 0;
    let toFinisher = 0;
    for (let day = 0; day <= 800; day += 1) {
      engine.step(day);
      for (const pig of engine.world.pigs) {
        if (!pig.alive) continue;
        const before = standing.get(pig.tag);
        standing.set(pig.tag, pig.stage);
        if (before === undefined || before === pig.stage) continue;
        if (before === "weaner" && pig.stage === "finisher") skipped += 1;
        if (pig.stage === "grower") toGrower += 1;
        if (pig.stage === "finisher") toFinisher += 1;
      }
    }

    expect(skipped).toBe(0);
    // Nothing reaches the finishing house except through the grower house, so a
    // grower house this small is a ceiling on everything behind it.
    expect(toFinisher).toBeGreaterThan(0);
    expect(toFinisher).toBeLessThanOrEqual(toGrower);
    expect(engine.world.housing.report().find((room) => room.id === "grower")!.movementsBlocked)
      .toBeGreaterThan(0);
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

  it("grows a held pig to its mature size and no further", () => {
    // What a queue does to a pig. Growth here is a rate per stage, read off
    // tables measured inside the growout, and taking those at their word past
    // sale weight meant a pig held for want of a finishing place gained 0.85 kg
    // a day for two years and reached 519 kg. That is not an animal, and the
    // damage was not confined to the weight: its upkeep, the feed ordered for
    // it, its valuation and its cost per kilogram were all worked off it.
    //
    // Now the rate falls away above sale weight and reaches nothing at the
    // mature weight of the genotype. The queue is still there, still expensive,
    // still late — it is a queue of pigs rather than of elephants.
    const input = plan((config) => {
      // Room upstream, so nothing is slowed by crowding: whatever stops these
      // pigs growing is the growth curve and not a full pen.
      config.housing.weanerPlaces = 2_000;
      config.housing.growerPlaces = 2_000;
      config.housing.finisherPlaces = 1;
    });
    const run = runEngine(input, DAYS);
    const live = run.world.pigs.filter((pig) => pig.alive);

    // The queue is real and long — this is a farm with one finishing place.
    const waiting = live.filter((pig) => pig.heldSinceDay !== null);
    expect(waiting.length).toBeGreaterThan(0);
    expect(run.lifetime.heldAtSaleWeightDays).toBeGreaterThan(0);

    // And every animal in it is a pig.
    const heaviest = Math.max(...live.map((pig) => pig.weightKg));
    expect(heaviest).toBeLessThanOrEqual(input.growth.matureWeightKg);
    expect(heaviest).toBeGreaterThan(input.growth.saleWeightKg);
  });

  it("leaves a plan that sells on time exactly where it was", () => {
    // The curve is normalised to 1 at sale weight, so it describes what happens
    // past the growout and says nothing inside it. A farm with places for its
    // herd must therefore be untouched by it — otherwise this is not a mature
    // weight, it is a quiet cut to every daily gain in the model.
    const roomy = plan((config) => {
      config.housing.weanerPlaces = 800;
      config.housing.growerPlaces = 800;
      config.housing.finisherPlaces = 800;
    });
    const withCurve = runEngine(roomy, DAYS);
    const without = runEngine(roomy, DAYS, { policies: { matureGrowthCurve: false } });

    expect(withCurve.lifetime.sold).toBe(without.lifetime.sold);
    // Feed moves by 350 kg in 377 tonnes — a tenth of a percent. A pen goes when
    // its average reaches sale weight, so its forwardest pigs are a little over
    // it by then and those few days are genuinely on the curve. Every pig inside
    // the growout is untouched.
    const drift =
      Math.abs(withCurve.lifetime.feedDeliveredKg - without.lifetime.feedDeliveredKg) /
      without.lifetime.feedDeliveredKg;
    expect(drift).toBeLessThan(0.002);
  });
});
