import { describe, expect, it } from "vitest";

import { cloneDefaultConfig, type PlannerConfig } from "./config";
import { simulatePlan } from "./simulation";
import {
  dayIndexAt,
  daySnapshotAt,
  planResultOf,
  planResultTransfers,
  type PlanSimulationResult,
} from "./simulation-result";

/**
 * The plan, flattened for the journey out of the worker.
 *
 * A day travels as numbers in a `Float64Array` rather than as an object with a
 * hundred key names on it, which is the difference between nine megabytes and
 * seven hundred kilobytes and, on arrival, between a tenth of a second of the
 * main thread and none of it. That only holds if a day comes back out exactly
 * as it went in, for every day of the plan and not just the one somebody
 * checked — so that is what this asserts.
 */

function plan(engine: "1.x" | "2.0"): PlannerConfig {
  const input = cloneDefaultConfig();
  input.project.engine = engine;
  input.project.months = 12;
  input.project.variation = "settled";
  input.stock.sows = 12;
  input.herd.startMode = "staggered";
  input.herd.maxSows = 12;
  return input;
}

describe("A finished plan, in the shape that crosses to the page", () => {
  for (const engine of ["1.x", "2.0"] as const) {
    it(`reads back every day of a ${engine} plan exactly as the farm gave it`, () => {
      const config = plan(engine);
      const simulation = simulatePlan(config);
      const result = planResultOf(simulation);

      expect(result.days.dates.length).toBe(simulation.horizonDay + 1);
      expect(result.horizonDay).toBe(simulation.horizonDay);

      for (const [index, date] of result.days.dates.entries()) {
        const read = daySnapshotAt(result, date + "T23:00");
        const farm = simulation.stateAt(date + "T23:00");
        expect(read.day, date).toBe(farm.day);
        expect(read.date, date).toBe(farm.date);
        expect(read.liveweightKg, date).toBe(farm.herd.liveweightKg);
        expect(read.finance, date).toEqual(farm.finance);
        expect(read.stores, date).toEqual(farm.stores);
        expect(read.costOfProduction, date).toEqual(farm.costOfProduction);
        expect(index).toBe(dayIndexAt(result, date + "T23:00"));
      }
    }, 120_000);
  }

  it("carries the projection and the timeline across untouched", () => {
    const config = plan("1.x");
    const simulation = simulatePlan(config);
    const result = planResultOf(simulation);

    expect(result.projection).toEqual(simulation.projection);
    expect(result.timeline).toEqual(simulation.timeline);
    expect(result.config).toEqual(simulation.config);
  }, 120_000);

  it("survives the journey a worker would send it on", () => {
    const result = planResultOf(simulatePlan(plan("1.x")));
    const before = daySnapshotAt(result, result.days.dates[200] + "T23:00");

    // What postMessage does, minus the worker: the day columns are handed over
    // rather than copied, so this is the copy the page would actually read.
    const sent = structuredClone(result, {
      transfer: planResultTransfers(result),
    }) as PlanSimulationResult;

    expect(sent.days.values.length).toBeGreaterThan(0);
    expect(daySnapshotAt(sent, sent.days.dates[200] + "T23:00")).toEqual(before);
    expect(sent.projection).toEqual(result.projection);
    // Handed over means given away: the sender is left holding nothing, which
    // is what makes it free.
    expect(result.days.values.length).toBe(0);
  }, 120_000);

  it("reads the nearest day of the plan for a moment outside it", () => {
    const result = planResultOf(simulatePlan(plan("1.x")));
    const last = result.days.dates.length - 1;

    expect(dayIndexAt(result, "2020-01-01T23:00")).toBe(0);
    expect(dayIndexAt(result, "2099-01-01T23:00")).toBe(last);
    expect(dayIndexAt(result, "not a date")).toBe(0);
    expect(daySnapshotAt(result, "2099-01-01T23:00").date).toBe(result.days.dates[last]);
  }, 120_000);

  it("is small enough to be worth sending", () => {
    const result = planResultOf(simulatePlan(plan("1.x")));
    const days = result.days;

    // One Float64Array for the whole plan rather than a day per object: about
    // eighty figures a day, and nothing repeated from the timeline beside it.
    expect(days.values.length).toBe(days.dates.length * days.fields.length);
    expect(days.fields.length).toBeGreaterThan(60);
    expect(days.fields.length).toBeLessThan(120);
    // The store names, units and ids are the same on every day of the plan, so
    // they are kept once rather than eleven hundred times.
    expect(days.template.stores.length).toBeGreaterThan(0);
    expect(days.fields.some((field) => field.endsWith(".label"))).toBe(false);
  }, 120_000);
});
