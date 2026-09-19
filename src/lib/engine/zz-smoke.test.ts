import { describe, expect, it } from "vitest";
import { cloneDefaultConfig, type PlannerConfig } from "../config";
import { Engine } from "./engine";
import { observeFarm } from "./planning/observe";
import { forecastDemand } from "./planning/forecast";

function farmOf(sows: number, rolling: boolean): PlannerConfig {
  const config: PlannerConfig = cloneDefaultConfig();
  config.project.engine = "2.0";
  config.project.months = 18;
  config.stock.sows = sows;
  config.stock.boars = Math.max(1, Math.round(sows / 25));
  config.herd.maxSows = sows;
  config.housing.farrowingPlaces = Math.max(8, Math.ceil(sows / 4));
  config.housing.weanerPlaces = sows * 12;
  config.housing.growerPlaces = sows * 12;
  config.housing.finisherPlaces = sows * 12;
  config.feed.procurementMode = "operational";
  if (rolling) config.feed.operationalPolicy = "rolling-cover";
  return config;
}

async function run(sows: number, rolling: boolean) {
  const config = farmOf(sows, rolling);
  const t = Date.now();
  const engine = new Engine(config);
  for (let day = 30; day <= 18 * 30; day += 30) {
    engine.advanceTo(day);
    // Keep the worker responsive while this deliberately large benchmark runs.
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  const l = engine.lifetime;
  return {
    ms: Date.now() - t,
    lorries: l.lorries,
    emergency: l.emergencyOrders,
    premium: Math.round(l.emergencyPremium),
    shortfallKg: Math.round(l.feedShortfallKg),
    sold: l.sold,
    haulage: Math.round(l.haulageCost),
    feedKg: Math.round(l.feedDeliveredKg),
    storeValue: Math.round(engine.valuation().storeValue),
  };
}

describe("smoke", () => {
  it("compares policies on a real herd", async () => {
    for (const sows of [60, 500]) {
      console.log(sows, "reorder", await run(sows, false));
      console.log(sows, "rolling", await run(sows, true));
    }
  }, 420000);

  it("benchmarks the forecaster on 500 sows", () => {
    const config = farmOf(500, true);
    const engine = new Engine(config).advanceTo(200);
    const farm = observeFarm(200, engine.world);
    console.log("groups", farm.growing.length, "sowGroups", farm.sows.length, "pigs", engine.world.pigs.length);
    const t = Date.now();
    for (let i = 0; i < 10; i += 1) forecastDemand(farm, config, 200 + 94);
    console.log("forecast ms each", (Date.now() - t) / 10);
    expect(1).toBe(1);
  }, 300000);
});
