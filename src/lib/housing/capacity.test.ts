import { describe, expect, it } from "vitest";

import {
  analyzeHousingCapacity,
  constructionPhasesFor,
  derivedReservePens,
  firstRequiredDay,
  reservePensFor,
  utilizationOf,
  type DemandSeries,
} from "./capacity";
import { housingPolicy } from "./rules";

/**
 * The questions a peak cannot answer.
 *
 * Everything here is a reading of one series — how many pens had to exist on
 * each morning of the plan — so the cases are written as series rather than as
 * simulated farms. A run of numbers is a great deal easier to reason about than
 * a herd, and every property worth holding about the reserve, the phasing and
 * the shortage analysis is a property of the run of numbers.
 */

function series(pensInUse: number[], firstDay = 0): DemandSeries {
  return { firstDay, pensInUse };
}

/** Flat, then a one-way climb it never comes back down from: growth. */
const GROWTH = series([...Array(50).fill(4), ...Array(50).fill(8)]);
/** Ten pens with a recurring swing up to twelve: a house absorbing surges. */
const LUMPY = series(
  Array.from({ length: 200 }, (_, day) => (day % 20 < 3 ? 12 : 10)),
);
/** The same number every morning for a year. */
const STEADY = series(Array(365).fill(6));

describe("when capacity was first needed", () => {
  it("finds the first morning a level was reached, and says so when it never was", () => {
    expect(firstRequiredDay(GROWTH, 4)).toBe(0);
    expect(firstRequiredDay(GROWTH, 5)).toBe(50);
    expect(firstRequiredDay(GROWTH, 8)).toBe(50);
    expect(firstRequiredDay(GROWTH, 9)).toBeNull();
  });

  it("counts from the day the plan starts, not from zero", () => {
    expect(firstRequiredDay(series([1, 2, 3], 400), 3)).toBe(402);
  });
});

describe("the reserve", () => {
  it("adds nothing at all under `none`", () => {
    const policy = housingPolicy((edit) => (edit.structure.reserveMode = "none"));
    expect(reservePensFor(LUMPY, 12, policy)).toBe(0);
    expect(reservePensFor(STEADY, 6, policy)).toBe(0);
  });

  it("keeps the old flat margin available under `percentage`", () => {
    const policy = housingPolicy((edit) => {
      edit.structure.reserveMode = "percentage";
      edit.structure.reservePct = 0.1;
    });
    // The behaviour this used to have unconditionally: ten per cent, rounded up,
    // whatever the farm did — which is why a single boar pen became two.
    expect(reservePensFor(series([1]), 1, policy)).toBe(1);
    expect(reservePensFor(STEADY, 6, policy)).toBe(1);
    expect(reservePensFor(LUMPY, 12, policy)).toBe(2);
  });

  it("gives a house whose requirement never moves nothing", () => {
    const policy = housingPolicy();
    expect(policy.structure.reserveMode).toBe("simulation-derived");
    expect(derivedReservePens(STEADY, 6, policy)).toBe(0);
  });

  it("does not mistake growth for a surge", () => {
    // Four pens becoming eight and staying there is a house that grew. The
    // growth is in the peak already, and charging for it a second time as a
    // reserve is exactly the double count the old percentage made.
    expect(derivedReservePens(GROWTH, 8, housingPolicy())).toBe(0);
  });

  it("covers a surge the house takes and gives back", () => {
    // Ten pens most of the time, twelve for three days in twenty, over and over.
    // That is two pens of real operational swing and it recurs all year.
    expect(derivedReservePens(LUMPY, 12, housingPolicy())).toBe(2);
  });

  it("is not set by something that happened once in five years", () => {
    // A herd is stocked, forty-six sows want a service place the same fortnight,
    // and it never happens again. The minimum already holds it; the margin for
    // the other five years should not be built around it.
    const stocking = series([
      ...Array.from({ length: 10 }, (_, day) => day * 5),
      ...Array(1800).fill(3),
    ]);
    expect(derivedReservePens(stocking, 46, housingPolicy())).toBeLessThanOrEqual(1);
  });

  it("never runs away with itself", () => {
    const wild = series(
      Array.from({ length: 400 }, (_, day) => (day % 4 === 0 ? 100 : 1)),
    );
    const policy = housingPolicy((edit) => (edit.structure.reserveMaxPct = 0.2));
    expect(derivedReservePens(wild, 100, policy)).toBeLessThanOrEqual(20);
  });
});

describe("how hard a house is worked", () => {
  it("reads the average from the day it opened, not from the day the plan did", () => {
    // Empty for the first hundred mornings, then six pens in use out of ten.
    const late = series([...Array(100).fill(0), ...Array(100).fill(6)]);
    expect(utilizationOf(late, 10).averageOccupiedPct).toBe(60);
  });

  it("says how brief a peak was", () => {
    const spike = series([...Array(99).fill(5), 20]);
    const metrics = utilizationOf(spike, 20);
    expect(metrics.peakOccupiedPct).toBe(100);
    expect(metrics.peakDurationDays).toBe(1);
    expect(metrics.daysAt100Pct).toBe(1);
    expect(metrics.daysAbove90Pct).toBe(1);
    expect(metrics.averageOccupiedPct).toBeLessThan(30);
  });

  it("counts the days a house ran near its limit", () => {
    const metrics = utilizationOf(LUMPY, 12);
    expect(metrics.daysAt100Pct).toBe(30);
    expect(metrics.daysAbove80Pct).toBe(200);
  });
});

describe("what building less would have cost", () => {
  it("reports nothing to report when the capacity covers the run", () => {
    expect(analyzeHousingCapacity(LUMPY, 12)).toEqual({
      firstShortageDay: undefined,
      shortageDays: 0,
      maximumShortagePens: 0,
    });
  });

  it("names the first day, the days and the worst of a shortfall", () => {
    const failure = analyzeHousingCapacity(LUMPY, 10);
    expect(failure.firstShortageDay).toBe(0);
    expect(failure.shortageDays).toBe(30);
    expect(failure.maximumShortagePens).toBe(2);
  });

  it("is analysis and nothing else: the series it was given is untouched", () => {
    const pens = [1, 5, 2];
    const input = series(pens);
    analyzeHousingCapacity(input, 1);
    expect(pens).toEqual([1, 5, 2]);
  });
});

describe("construction phases", () => {
  const policy = housingPolicy((edit) => {
    edit.structure.constructionLeadDays = 100;
    edit.structure.minPhaseSpacingDays = 200;
    edit.structure.maxRoomsPerBuilding = 6;
  });

  /** Four pens from the start, eight from day 800, twelve from day 1600. */
  const stepped = series([
    ...Array(800).fill(4),
    ...Array(800).fill(8),
    ...Array(800).fill(12),
  ]);

  it("dates each step from the first morning it is wanted, less the lead time", () => {
    const phases = constructionPhasesFor({
      housingType: "finisher",
      series: stepped,
      pensPerRoom: 4,
      roomCount: 3,
      policy,
    });
    expect(phases.map((phase) => phase.buildByDay)).toEqual([0, 700, 1500]);
    expect(phases.map((phase) => phase.pensAdded)).toEqual([4, 4, 4]);
    expect(phases.map((phase) => phase.resultingCapacity)).toEqual([4, 8, 12]);
    expect(phases.map((phase) => phase.phase)).toEqual([1, 2, 3]);
  });

  it("never lets a phase land after the capacity it provides is wanted", () => {
    const phases = constructionPhasesFor({
      housingType: "finisher",
      series: stepped,
      pensPerRoom: 4,
      roomCount: 3,
      policy,
    });
    for (const phase of phases) {
      const wanted = firstRequiredDay(stepped, phase.resultingCapacity);
      if (wanted === null) continue;
      expect(phase.buildByDay, `phase ${phase.phase}`).toBeLessThanOrEqual(wanted);
    }
  });

  it("does not turn one ramp into five phases a fortnight apart", () => {
    // A house that fills over its first two months is one piece of work, not
    // one per room. Without the spacing rule this is five phases.
    const ramp = series([
      ...Array(14).fill(4),
      ...Array(14).fill(8),
      ...Array(14).fill(12),
      ...Array(14).fill(16),
      ...Array(1000).fill(20),
    ]);
    const phases = constructionPhasesFor({
      housingType: "weaner",
      series: ramp,
      pensPerRoom: 4,
      roomCount: 5,
      policy,
    });
    expect(phases).toHaveLength(1);
    expect(phases[0].roomsAdded).toBe(5);
    expect(phases[0].resultingCapacity).toBe(20);
  });

  it("puts the rooms nobody ever fills up with the last ones that are wanted", () => {
    // Twelve pens are needed; the module rounds to sixteen. The spare room is
    // built with the phase before it, because a module goes up whole.
    const phases = constructionPhasesFor({
      housingType: "finisher",
      series: stepped,
      pensPerRoom: 4,
      roomCount: 4,
      policy,
    });
    expect(phases).toHaveLength(3);
    expect(phases[2].roomsAdded).toBe(2);
    expect(phases[2].resultingCapacity).toBe(16);
  });

  it("counts the buildings each phase adds", () => {
    const phases = constructionPhasesFor({
      housingType: "finisher",
      series: stepped,
      pensPerRoom: 1,
      roomCount: 12,
      policy,
    });
    const buildings = phases.reduce((total, phase) => total + (phase.buildingsAdded ?? 0), 0);
    expect(buildings).toBe(2);
  });

  it("gives back nothing to build when there is nothing to build", () => {
    expect(
      constructionPhasesFor({
        housingType: "boar",
        series: STEADY,
        pensPerRoom: 0,
        roomCount: 0,
        policy,
      }),
    ).toEqual([]);
  });
});
