import { describe, expect, it } from "vitest";

import { cloneDefaultConfig, type PlannerConfig } from "../config";
import { runEngine } from "./engine";

/**
 * The event log as a record you can count, rather than a log you can read.
 *
 * A read-out in 2.0 is a fold over the events, so a thing that happened once has
 * to appear once. Crowding used to announce its losses twice — the housing
 * system said them when it booked them and the mortality system said them again
 * an hour later when it carried them out — and both sentences were true, which
 * is exactly why nothing caught it until something tried to add them up.
 */

function crowdedPlan(): PlannerConfig {
  const input = cloneDefaultConfig();
  input.project.months = 24;
  input.project.variation = "settled";
  input.stock.sows = 20;
  input.herd.startMode = "staggered";
  input.herd.maxSows = 20;
  // Short of finishing places, the grower house carries the queue and goes well
  // over its own, which is the only stress this model has.
  input.housing.finisherPlaces = 5;
  return input;
}

const run = runEngine(crowdedPlan(), 1_000, { keepEveryEvent: true });

const announced = (type: string) =>
  run.events
    .filter((event) => event.type === type)
    .reduce((total, event) => total + Number(event.changes?.pigs ?? 0), 0);

describe("A death is announced once", () => {
  it("books crowding losses as their own event, not as a death", () => {
    expect(run.lifetime.crowdingDeaths).toBeGreaterThan(0);

    const booked = run.events.filter((event) => event.type === "CrowdingDeathsScheduled");
    expect(booked.length).toBeGreaterThan(0);
    expect(booked[0].cause).toBe("stocking density");
    expect(booked[0].message).toMatch(/loss(es)? booked against overcrowding/);

    // Every crowding loss is accounted for by this event and by nothing else.
    expect(announced("CrowdingDeathsScheduled")).toBe(run.lifetime.crowdingDeaths);
    const deaths = run.events.filter((event) => event.type === "PigDied");
    expect(deaths.some((event) => /overcrowding/.test(event.message))).toBe(false);
  });

  it("does not count a crowding loss twice over the event stream", () => {
    // The guard that would have failed before: the herd's PigDied events used to
    // total the settled deaths plus every crowding loss again on top.
    const recorded = run.lifetime.pigletDeaths + run.lifetime.growingDeaths;
    expect(recorded).toBeGreaterThan(0);
    // 481 of these 713 are crowding losses, so the old stream announced 1,194.
    expect(announced("PigDied")).toBe(recorded);
  });
});
