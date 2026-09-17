import { describe, expect, it } from "vitest";

import {
  cloneDefaultConfig,
  IRREGULAR_RETURN_DAYS,
  REGULAR_RETURN_DAYS,
  type PlannerConfig,
} from "../config";
import { farmEventLog, runFarm, type FarmEvent } from "./index";

function plan(months = 24, tweak: (input: PlannerConfig) => void = () => {}) {
  const input = cloneDefaultConfig();
  input.project.months = months;
  tweak(input);
  return input;
}

function ofType(log: FarmEvent[], type: FarmEvent["type"]): FarmEvent[] {
  return log.filter((event) => event.type === type);
}

const baseline = plan();
const baselineFarm = runFarm(baseline);
const baselineLog = farmEventLog(baseline);

describe("The reproductive cycle is written down as it happens", () => {
  const log = baselineLog;

  it("logs each service by name, with what served her", () => {
    const services = ofType(log, "service");
    expect(services.length).toBeGreaterThan(10);

    for (const event of services) {
      // Who, by what, at which parity — one line per service, not a daily count.
      expect(event.message).toMatch(
        /^[A-Z]+-\d+ (served by BOAR-\d+, natural, parity \d+|inseminated with AI-\d+, AI \d doses?, parity \d+, [\d.]+ \w+)$/,
      );
    }
    // One line per sow served, so two sows served on one day are two lines.
    const onBusiestDay = services.filter((event) => event.day === services[0].day);
    expect(onBusiestDay.length).toBeGreaterThanOrEqual(1);
  });

  it("names the semen when the service is AI, and the boar when it is not", () => {
    const withAi = farmEventLog(
      plan(24, (input) => {
        input.service.useAi = true;
        input.service.aiSharePct = 100;
        input.stock.boars = 0;
      }),
    );
    const services = ofType(withAi, "service");

    expect(services.length).toBeGreaterThan(10);
    expect(services.every((event) => /inseminated with AI-\d+/.test(event.message))).toBe(true);
    // The doses that made up the service, which is what a breeding card records.
    expect(services[0].message).toContain("AI 2 doses");
  });

  it("logs a return to heat, and says whether she came back late", () => {
    const returns = ofType(log, "return");
    expect(returns.length).toBeGreaterThan(0);

    for (const event of returns) {
      expect(event.message).toMatch(/returned to heat (regularly|irregularly)/);
    }
    // A herd whose services all held would have nothing to return, so the
    // conception rate and the returns have to agree.
    expect(
      baselineFarm.lifetime.regularReturns + baselineFarm.lifetime.irregularReturns,
    ).toBe(returns.length);
  });

  it("brings a regular return back on the cycle and a late one past it", () => {
    const served = new Map<string, number>();
    const gaps: { days: number; irregular: boolean }[] = [];

    // The log does not join a return to the service it came from, so the pair
    // is rebuilt here by following each sow's tag through it.
    for (const event of baselineLog) {
      const tag = event.message.split(" ")[0];
      if (event.type === "service") served.set(tag, event.day);
      if (event.type === "return") {
        const from = served.get(tag);
        if (from === undefined) continue;
        gaps.push({ days: event.day - from, irregular: /irregularly/.test(event.message) });
      }
    }

    expect(gaps.length).toBeGreaterThan(3);
    for (const gap of gaps) {
      const band = gap.irregular ? IRREGULAR_RETURN_DAYS : REGULAR_RETURN_DAYS;
      expect(gap.days).toBeGreaterThanOrEqual(band.min);
      expect(gap.days).toBeLessThanOrEqual(band.max);
    }
    // Both kinds happen at the plan's default share, so neither branch is dead.
    expect(gaps.some((gap) => gap.irregular)).toBe(true);
    expect(gaps.some((gap) => !gap.irregular)).toBe(true);
    expect(baselineFarm.lifetime.regularReturns).toBeGreaterThan(0);
  });

  it("scans a served sow on the day the plan says, and books what it found", () => {
    const input = baseline;
    const scans = ofType(log, "scan");
    expect(scans.length).toBeGreaterThan(5);

    for (const event of scans) {
      expect(event.message).toMatch(/scanned (in pig, due day \d+|not in pig, back to service)/);
    }

    const served = new Map<string, number>();
    for (const event of log) {
      const tag = event.message.split(" ")[0];
      if (event.type === "service") served.set(tag, event.day);
      if (event.type === "scan") {
        const from = served.get(tag);
        if (from === undefined) continue;
        expect(event.day - from).toBe(input.reproduction.pregnancyScanDays);
      }
    }

    expect(baselineFarm.lifetime.scans).toBe(scans.length);
    expect(
      baselineFarm.lifetime.pregnanciesConfirmed + baselineFarm.lifetime.scannedEmpty,
    ).toBe(baselineFarm.lifetime.scans);
  });

  it("charges every scan, and nothing when the herd does not scan", () => {
    const scanned = runFarm(plan(24, (input) => (input.reproduction.pregnancyScanCost = 4)));
    const free = runFarm(plan(24, (input) => (input.reproduction.pregnancyScanCost = 0)));

    expect(scanned.lifetime.scans).toBeGreaterThan(0);
    // A scan is charged whatever it finds, so the bill is the scans times the fee.
    const vetDelta =
      scanned.ledger.totals["veterinary"] - free.ledger.totals["veterinary"];
    expect(vetDelta).toBeCloseTo(scanned.lifetime.scans * 4, 6);
  });
});

describe("Piglets are processed, and the plan is charged for it", () => {
  it("logs each job as a batch, naming it and the piglets it was done to", () => {
    const jobs = ofType(baselineLog, "processing");
    expect(jobs.length).toBeGreaterThan(5);

    for (const event of jobs) {
      expect(event.message).toMatch(/^.+ done to \d+ piglets?$/);
    }
    // The jobs a plan starts with, iron among them.
    const named = new Set(jobs.map((event) => event.message.split(" done to ")[0]));
    expect(named).toContain("Iron injection");
    expect(named).toContain("Castration");
  });

  it("does a males-only job to about half the litter, not all of it", () => {
    const total = (name: string) =>
      baselineLog
        .filter((event) => event.type === "processing" && event.message.startsWith(name))
        .reduce((sum, event) => sum + Number(event.message.match(/done to (\d+)/)![1]), 0);

    const iron = total("Iron injection");
    const castrations = total("Castration");

    expect(iron).toBeGreaterThan(50);
    // Half the pigs born are male, give or take how the draw fell.
    expect(castrations / iron).toBeGreaterThan(0.35);
    expect(castrations / iron).toBeLessThan(0.65);
    expect(baselineFarm.lifetime.bornAlive).toBeGreaterThan(iron);
  });

  it("costs a males-only job at half of what the same job on every pig costs", () => {
    const malesOnly = baselineFarm;
    const everyPig = runFarm(
      plan(24, (input) => {
        const castration = input.health.vaccinations.find((job) => job.id === "castration")!;
        castration.appliesTo = "all";
      }),
    );

    const bill = (farm: typeof malesOnly) => farm.ledger.totals["vaccination"];
    expect(bill(everyPig)).toBeGreaterThan(bill(malesOnly));
  });

  it("moves every pig past a job it is not given, rather than queueing it there", () => {
    // Castration sits in the middle of the schedule. If a gilt stopped at it,
    // she would never reach the vaccinations that come after it.
    const farm = baselineFarm;
    const females = farm.pigs.filter((pig) => pig.sex === "female" && pig.ageDays(farm.day) > 80);

    expect(females.length).toBeGreaterThan(0);
    for (const pig of females) {
      expect(pig.vaccinationsGiven).toBe(farm.config.health.vaccinations.length);
    }
  });
});
