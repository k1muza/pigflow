import { describe, expect, it } from "vitest";

import { cloneDefaultConfig } from "./config";
import { buildEventLogCsv, eventLogFilename } from "./export-event-log";
import { farmEventLog, farmTimeline, runFarm } from "./sim";

function plan(months = 24) {
  const input = cloneDefaultConfig();
  input.project.months = months;
  return input;
}

/** The data rows, without the byte order mark, the header or the trailing blank. */
function dataRows(csv: string): string[] {
  return csv.replace(/^﻿/, "").trimEnd().split("\r\n").slice(1);
}

describe("The farm's own log of the run", () => {
  it("keeps every line, where the running log keeps only the last of them", () => {
    // Long enough that the plan writes past the cap the running log holds to,
    // which four years is by some hundreds of lines.
    const input = plan(48);
    const running = runFarm(input).events;
    const whole = farmEventLog(input);

    expect(running.length).toBe(400);
    expect(whole.length).toBeGreaterThan(running.length);
    // The running log is the tail of the whole one, not a different account of it.
    expect(whole.slice(-400).map((event) => event.message)).toEqual(
      running.map((event) => event.message),
    );
    // Two runs of four years, which is slower than the default allows for.
  }, 30_000);

  it("reads back as the run, in the order it happened", () => {
    const rows = dataRows(buildEventLogCsv(plan()));

    expect(rows.length).toBeGreaterThan(0);
    const days = rows.map((row) => Number(row.split(",")[0]));
    expect([...days].sort((a, b) => a - b)).toEqual(days);
  });

  it("quotes a message carrying a comma rather than splitting it into a column", () => {
    const csv = buildEventLogCsv(plan());
    const withComma = dataRows(csv).find((row) => row.includes("live piglets, parity"));

    expect(withComma).toBeDefined();
    // Four columns, because the comma inside the message is inside its quotes.
    expect(withComma!.match(/^(\d+),([\d-]+),(\w+),"(.+)"$/)).not.toBeNull();
  });

  it("opens as UTF-8 in a spreadsheet, separators and all", () => {
    expect(buildEventLogCsv(plan()).startsWith("﻿")).toBe(true);
  });

  it("names the file after the plan", () => {
    const input = plan();
    input.project.name = "Green Valley Piggery (Phase 2)";
    expect(eventLogFilename(input)).toBe("green-valley-piggery-phase-2-event-log.csv");
  });

  it("writes a line for every service by AI, naming the stud and the cost", () => {
    const input = plan();
    input.service.useAi = true;
    input.service.aiSharePct = 100;
    input.stock.boars = 0;
    const farm = runFarm(input);

    const aiLines = farmEventLog(input).filter((event) => event.message.includes("inseminated"));
    // One line per service, not one per day: two sows served on a day are two.
    expect(aiLines.length).toBe(farm.lifetime.aiServices);

    for (const event of aiLines) {
      expect(event.message).toMatch(/inseminated with AI-\d+, AI \d doses?, parity \d+/);
      expect(event.message).toContain(String(input.service.aiCostPerService));
    }
  });
});

describe("The simulator shows how the sows were served", () => {
  it("says nothing about AI on a herd that does not use it", () => {
    const labels = farmTimeline(plan())
      .months.flatMap((month) => month.events)
      .filter((event) => event.type === "service")
      .map((event) => event.label);

    expect(labels.length).toBeGreaterThan(0);
    expect(labels.some((label) => label.includes("AI"))).toBe(false);
  });

  it("splits the service line when the herd runs both channels", () => {
    const input = plan();
    input.herd.maxSows = 60;
    input.stock.sows = 60;
    input.stock.boars = 3;
    input.housing = {
      ...input.housing,
      farrowingPlaces: 60,
      weanerPlaces: 400,
      growerPlaces: 400,
      finisherPlaces: 800,
    };
    input.service.useAi = true;
    input.service.aiSharePct = 40;

    const split = farmTimeline(input)
      .months.flatMap((month) => month.events)
      .find((event) => event.label.includes("by AI,"));

    expect(split).toBeDefined();
    const [, total, byAi, toBoar] = split!.label.match(/Service (\d+) sows · (\d+) by AI, (\d+)/)!;
    expect(Number(byAi) + Number(toBoar)).toBe(Number(total));
    expect(split!.count).toBe(Number(total));
  });

  it("reads as all AI when no boar stands at all", () => {
    const input = plan();
    input.service.useAi = true;
    input.service.aiSharePct = 100;
    input.stock.boars = 0;

    const labels = farmTimeline(input)
      .months.flatMap((month) => month.events)
      .filter((event) => event.type === "service" && event.label.startsWith("Serve"));

    expect(labels.length).toBeGreaterThan(0);
    expect(labels.every((event) => /^Serve \d+ sows? by AI$/.test(event.label))).toBe(true);
  });
});
