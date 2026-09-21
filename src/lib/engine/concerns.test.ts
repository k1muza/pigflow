import { describe, expect, it } from "vitest";

import { cloneDefaultConfig } from "../config";
import { engineEventLog } from "./read";
import { engineHorizonDay, runEngine } from "./engine";

function plan() {
  const config = cloneDefaultConfig();
  config.project.engine = "2.0";
  config.project.months = 18;
  config.project.variation = "settled";
  config.feed.procurementMode = "operational";
  return config;
}

describe("event-log realism concerns", () => {
  it("keeps exactly one farrowing row per litter and records cohort creation separately", () => {
    const config = plan();
    const engine = runEngine(config, engineHorizonDay(config), { keepEveryEvent: true });
    const log = engineEventLog(engine.events);

    expect(log.filter((event) => event.type === "farrowing")).toHaveLength(
      engine.lifetime.litters,
    );
    expect(log.filter((event) => event.type === "inventory")).toHaveLength(
      engine.lifetime.litters,
    );
    expect(log.find((event) => event.type === "farrowing")?.message).toMatch(
      /total born, \d+ live, \d+ stillborn, \d+ mummified, parity \d+/,
    );
  });

  it("loses confirmed pregnancies and books non-fatal treatment cost and delay", () => {
    const lossPlan = plan();
    lossPlan.reproduction.pregnancyLossPct = 100;
    const losses = runEngine(lossPlan, engineHorizonDay(lossPlan), { keepEveryEvent: true });
    expect(losses.lifetime.pregnancyLosses).toBeGreaterThan(0);
    expect(losses.events.some((event) => event.type === "PregnancyLost")).toBe(true);

    const healthPlan = plan();
    healthPlan.reproduction.pregnancyLossPct = 0;
    healthPlan.health.treatmentAnnualPct = 100;
    const health = runEngine(healthPlan, engineHorizonDay(healthPlan), { keepEveryEvent: true });
    expect(health.lifetime.treatments).toBeGreaterThan(0);
    expect(health.events.some((event) => event.type === "TreatmentGiven")).toBe(true);
    expect(health.world.ledger.totals.veterinary).toBeGreaterThan(0);
  });

  it("does not turn the mature plan into drip-feed supply deliveries", () => {
    const config = plan();
    config.project.months = 36;
    const engine = runEngine(config, engineHorizonDay(config), { keepEveryEvent: true });
    const supplyLoads = engine.events.filter(
      (event) =>
        event.type === "DeliveryReceived" &&
        event.date.startsWith("2029-") &&
        event.message.startsWith("Lorry in"),
    );
    const payloads = supplyLoads
      .map((event) =>
        typeof event.changes?.payloadKg === "number" ? event.changes.payloadKg : 0,
      )
      .sort((a, b) => a - b);

    expect(supplyLoads.length).toBeLessThanOrEqual(75);
    expect(payloads[Math.floor(payloads.length / 2)]).toBeGreaterThan(2_000);
    expect(payloads.filter((kg) => kg < 1_000).length).toBeLessThanOrEqual(20);
  });

  it("repeats the complete result for the same settled plan", () => {
    const config = plan();
    const first = runEngine(config, engineHorizonDay(config), { keepEveryEvent: true });
    const second = runEngine(config, engineHorizonDay(config), { keepEveryEvent: true });

    expect(second.lifetime).toEqual(first.lifetime);
    expect(second.history).toEqual(first.history);
    expect(second.events).toEqual(first.events);
  });
});
