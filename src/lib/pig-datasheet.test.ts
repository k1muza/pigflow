import { describe, expect, it } from "vitest";

import { cloneDefaultConfig } from "./config";
import { buildPigDatasheetWorkbook } from "./export-pig-datasheet";
import { pigDatasheetFor } from "./pig-datasheet";
import { answerSimulationRequest } from "./simulation-worker";

function traceablePlan() {
  const config = cloneDefaultConfig();
  config.project.months = 12;
  config.project.variation = "settled";
  config.project.engine = "1.x";
  config.reproduction.farrowingSuccessPct = 100;
  config.reproduction.preWeanMortalityPct = 0;
  config.growth.weanerMortalityPct = 0;
  config.growth.growerMortalityPct = 0;
  config.growth.finisherMortalityPct = 0;
  config.herd.sowAnnualMortalityPct = 0;
  return config;
}

describe("individual pig datasheet", () => {
  it("traces daily weight, heating and scheduled care for one pig", () => {
    const sheet = pigDatasheetFor(traceablePlan(), "PIG-00001");

    expect(sheet.tag).toBe("PIG-00001");
    expect(sheet.birthDay).not.toBeNull();
    expect(sheet.daily.length).toBeGreaterThan(70);
    expect(sheet.daily.every((row) => Number.isFinite(row.weightKg))).toBe(true);
    expect(sheet.daily.some((row) => row.dailyGainKg !== null && row.dailyGainKg > 0)).toBe(true);
    expect(sheet.daily.some((row) => row.underHeat)).toBe(true);

    expect(
      sheet.events.some(
        (event) => event.type === "Processing" && event.event === "Iron injection",
      ),
    ).toBe(true);
    expect(
      sheet.events.some(
        (event) => event.type === "Vaccination" && event.event === "Mycoplasma",
      ),
    ).toBe(true);
    expect(sheet.events.some((event) => event.type === "Heating")).toBe(true);
  });

  it("can be requested through the one-off simulation worker protocol", () => {
    const response = answerSimulationRequest({
      type: "pig-datasheet",
      id: 17,
      config: traceablePlan(),
      tag: "PIG-00001",
    });

    expect(response.type).toBe("pig-datasheet");
    if (response.type !== "pig-datasheet") return;
    expect(response.id).toBe(17);
    expect(response.sheet.tag).toBe("PIG-00001");
    expect(response.sheet.daily.length).toBeGreaterThan(0);
  });

  it("writes an Excel workbook with the individual record", async () => {
    const sheet = pigDatasheetFor(traceablePlan(), "PIG-00001");
    const workbook = await buildPigDatasheetWorkbook(sheet, new Date("2026-09-24T00:00:00Z"));
    expect(workbook.byteLength).toBeGreaterThan(5_000);
  });
});
