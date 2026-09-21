import { addMonths, differenceInCalendarDays, parseISO } from "date-fns";
import { describe, expect, it } from "vitest";

import { cloneDefaultConfig, type PlannerConfig } from "./config";
import { calculateProjection } from "./model";
import { planStateAt, planTimeline } from "./plan";
import { simulatePlan, type PlanSimulation } from "./simulation";
import { farmStateAt, farmTimeline, horizonDay, timelineOf, type DayRecord } from "./sim";
import { resetRunCounts, runCounts } from "./sim/instrument";
import { Farm } from "./sim/farm";

/**
 * One farm per settled plan.
 *
 * The projection, the simulator's calendar and the day panel were three reads
 * of the same plan and three runs of the same farm; picking another date on the
 * calendar started a fourth. They agreed with each other, which is exactly why
 * nobody noticed — the only evidence was the wait. These tests hold the answers
 * to what they were before, and count the runs it takes to get them.
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

const FIRST_DATE = "2027-05-14T23:00";
const SECOND_DATE = "2027-02-03T23:00";

/**
 * Reads a plan through once and throws the answer away, so that the run being
 * counted afterwards is not also paying for the haulage probe the first farm on
 * a config builds.
 */
function warm(config: PlannerConfig): void {
  read(simulatePlan(config, { snapshots: false }));
  resetRunCounts();
}

/** Reads a simulation the way a page does, for its effect on the run behind it. */
function read(simulation: PlanSimulation): PlanSimulation {
  expect(simulation.projection.months.length).toBeGreaterThan(0);
  expect(simulation.timeline.days.length).toBeGreaterThan(0);
  return simulation;
}

function farmsAndEngines(): number {
  const counts = runCounts();
  return counts.farms + counts.engines;
}

describe("A plan is simulated once and read many times", () => {
  for (const engine of ["1.x", "2.0"] as const) {
    describe("engine " + engine, () => {
      it("derives the projection, the timeline and two days from one run", () => {
        const config = plan(engine);
        warm(config);

        const simulation = simulatePlan(config);
        // Reading all four of these is what a person does by opening the
        // cashflow page and then clicking two dates on the calendar.
        expect(simulation.projection.months.length).toBe(config.project.months);
        expect(simulation.timeline.days.length).toBe(horizonDay(config) + 1);
        expect(simulation.stateAt(FIRST_DATE).date).toBe("2027-05-14");
        expect(simulation.stateAt(SECOND_DATE).date).toBe("2027-02-03");

        expect(farmsAndEngines()).toBe(1);
        expect(simulation.stats.days).toBe(horizonDay(config) + 1);
        // A reading kept for every day of the plan, and one for the day before
        // it opened.
        expect(simulation.stats.snapshots).toBe(horizonDay(config) + 2);
      }, 120_000);

      it("does not run the farm again when another date is picked", () => {
        const config = plan(engine);
        warm(config);
        const simulation = read(simulatePlan(config));

        const built = farmsAndEngines();
        for (const date of [
          "2027-01-01T23:00",
          "2027-07-19T23:00",
          "2027-03-02T23:00",
          "2027-12-30T23:00",
          // Backwards again, which is the move that used to cost the most: the
          // farm had to be stood back up and walked forward from the start.
          "2027-01-15T23:00",
        ]) {
          expect(simulation.stateAt(date).date).toBe(date.slice(0, 10));
        }
        expect(farmsAndEngines()).toBe(built);
        expect(simulation.stats.replays).toBe(0);
      }, 120_000);

      it("reads a day exactly as a farm run to that day reads it", () => {
        const config = plan(engine);
        const simulation = simulatePlan(config);

        for (const timestamp of [FIRST_DATE, SECOND_DATE, "2026-12-31T23:00"]) {
          // planStateAt stands a farm up and walks it to the day, which is what
          // the simulator did for every click before this.
          expect(simulation.stateAt(timestamp)).toEqual(planStateAt(config, timestamp));
        }
      }, 120_000);

      it("gives the same projection and timeline as reading them one at a time", () => {
        const config = plan(engine);
        const simulation = simulatePlan(config);

        expect(simulation.projection).toEqual(calculateProjection(config));
        expect(simulation.timeline).toEqual(planTimeline(config));
      }, 120_000);

      it("repeats itself exactly for the same seed, and moves for another", () => {
        // A settled plan has no chance in it to seed, so this one takes its
        // chances — which is the setting a seed is for.
        const config = plan(engine);
        config.project.variation = "chance";
        const again = simulatePlan(config);
        expect(simulatePlan(config).projection).toEqual(again.projection);

        const reseeded = {
          ...config,
          project: { ...config.project, seed: config.project.seed + 1 },
        };
        expect(simulatePlan(reseeded).projection.summary.totalPigsSold).not.toBe(
          again.projection.summary.totalPigsSold,
        );
      }, 180_000);

      it("runs a new farm when something the farm can feel changes", () => {
        const config = plan(engine);
        warm(config);

        const first = read(simulatePlan(config));
        const after = farmsAndEngines();

        const bigger = { ...config, herd: { ...config.herd, maxSows: config.herd.maxSows + 6 } };
        const second = read(simulatePlan(bigger));

        expect(farmsAndEngines()).toBeGreaterThan(after);
        expect(second.projection.summary.totalPigsSold).not.toBe(
          first.projection.summary.totalPigsSold,
        );
      }, 180_000);
    });
  }

  it("leaves the 1.x farm's own read models exactly where they were", () => {
    const config = plan("1.x");
    const simulation = simulatePlan(config);

    expect(simulation.timeline).toEqual(farmTimeline(config));
    expect(simulation.stateAt(FIRST_DATE)).toEqual(farmStateAt(config, FIRST_DATE));
  }, 120_000);

  it("writes out a roster for a day it has already passed", () => {
    const config = plan("1.x");
    const simulation = read(simulatePlan(config));

    // Nothing on screen reads these, so they are not kept for every day; asking
    // for one costs a run to that day, and the answer is the farm's own.
    const state = simulation.stateAt(FIRST_DATE);
    expect(state.stock).toEqual(farmStateAt(config, FIRST_DATE).stock);
    expect(state.sows).toEqual(farmStateAt(config, FIRST_DATE).sows);
    expect(simulation.stats.replays).toBe(1);
  }, 120_000);

  it("keeps a day outside the horizon at the nearest day inside it", () => {
    const config = plan("1.x");
    const simulation = simulatePlan(config);
    const start = config.project.startDate;

    expect(simulation.stateAt("2020-01-01T23:00").day).toBe(-1);
    expect(simulation.stateAt("2099-01-01T23:00").day).toBe(horizonDay(config));
    expect(simulation.stateAt(`${start}T00:00`).date).toBe(start);
  }, 120_000);
});

/**
 * The month roll-up walks the history once rather than filtering the whole of
 * it per month. Sixty months of a five year plan filtering five years of days
 * is thirty times the reading the answer needs.
 */
describe("Grouping a run into months", () => {
  function monthsOf(config: PlannerConfig, history: readonly DayRecord[]) {
    const start = parseISO(config.project.startDate);
    return timelineOf(config, history, (date) => differenceInCalendarDays(date, start));
  }

  it("picks the same days per month as filtering the whole history would", () => {
    const config = plan("1.x");
    const farm = new Farm(config).advanceTo(horizonDay(config));
    // A history with holes in it, so the scan cannot pass by counting.
    const gapped = farm.history.filter((day) => day.day % 7 !== 3);
    const start = parseISO(config.project.startDate);

    for (const history of [farm.history, gapped]) {
      const timeline = monthsOf(config, history);
      let expected = 0;
      for (let index = 0; index < config.project.months; index += 1) {
        const firstDay = differenceInCalendarDays(addMonths(start, index), start);
        const lastDay = differenceInCalendarDays(addMonths(start, index + 1), start) - 1;
        const records = history.filter((day) => day.day >= firstDay && day.day <= lastDay);
        if (records.length === 0) continue;
        const month = timeline.months[expected];
        expected += 1;
        expect(month.index).toBe(index);
        expect(month.endDate).toBe(records[records.length - 1].date);
        expect(month.sold).toBe(records.reduce((total, day) => total + day.sold, 0));
        expect(month.lorriesIn).toBe(records.reduce((total, day) => total + day.lorriesIn, 0));
        expect(month.closingCash).toBe(records[records.length - 1].closingCash);
      }
      expect(timeline.months.length).toBe(expected);
    }
  }, 120_000);
});
