import { describe, expect, it } from "vitest";

import { cloneDefaultConfig, type PlannerConfig } from "../config";
import { Farm, horizonDay } from "../sim";
import { compareEngines, migrationReport } from "./parity";
import { LEGACY_POLICIES } from "./world";
import { runEngine } from "./engine";

/**
 * The 2.0 engine has one obligation before it is allowed to be interesting: with
 * every new subsystem switched off it must be the 1.x farm. Until that holds,
 * nothing it says about housing or feed or heats can be trusted, because there
 * is no way to tell new modelling apart from a porting mistake.
 */

function plan(tweak: (input: PlannerConfig) => void = () => {}): PlannerConfig {
  const input = cloneDefaultConfig();
  input.project.months = 24;
  tweak(input);
  return input;
}

describe("The 2.0 engine reproduces the 1.x farm when nothing new is switched on", () => {
  it("agrees with the baseline on the default plan", () => {
    const report = compareEngines(plan(), { policies: LEGACY_POLICIES });
    expect(report.divergences).toEqual([]);
    expect(report.identical).toBe(true);
  });

  it("agrees on a settled plan, where there is no luck to blame a difference on", () => {
    const report = compareEngines(plan((c) => (c.project.variation = "settled")), {
      policies: LEGACY_POLICIES,
    });
    expect(report.divergences).toEqual([]);
  });

  it("agrees on a bigger, staggered herd running AI", () => {
    const report = compareEngines(
      plan((c) => {
        c.stock.sows = 20;
        c.herd.startMode = "staggered";
        c.herd.maxSows = 40;
        c.service.useAi = true;
        c.service.aiSharePct = 40;
        c.project.months = 36;
      }),
      { policies: LEGACY_POLICIES },
    );
    expect(report.divergences).toEqual([]);
  });

  it("agrees across several seeds", () => {
    for (const seed of [1, 2, 3, 7]) {
      const report = compareEngines(plan((c) => (c.project.seed = seed)), {
        policies: LEGACY_POLICIES,
      });
      expect(report.divergences, "seed " + seed).toEqual([]);
    }
  }, 60_000);

  it("agrees when gilts are bought in rather than reared", () => {
    const report = compareEngines(
      plan((c) => {
        c.herd.retainHomeBredGilts = false;
        c.herd.buyGiltsWhenShort = true;
      }),
      { policies: LEGACY_POLICIES },
    );
    expect(report.divergences).toEqual([]);
  });

  it("matches every daily stage count, including weaners", () => {
    const input = plan((c) => {
      c.project.variation = "settled";
      c.stock.sows = 12;
      c.herd.startMode = "staggered";
      c.project.months = 36;
    });
    const through = horizonDay(input);
    const baseline = new Farm(input).advanceTo(through);
    const candidate = runEngine(input, through, { policies: LEGACY_POLICIES });

    expect(candidate.history).toHaveLength(baseline.history.length);
    for (const [index, day] of baseline.history.entries()) {
      const counts = candidate.history[index].counts;
      expect(counts.weaners, "weaners on day " + day.day).toBe(day.counts.weaners);
      expect(counts.growers, "growers on day " + day.day).toBe(day.counts.growers);
      expect(counts.finishers, "finishers on day " + day.day).toBe(day.counts.finishers);
    }
  }, 60_000);
});

describe("Housing capacity is observation-only in production", () => {
  it("ignores the former stored switch and never blocks a movement", () => {
    const input = plan((c) => {
      c.project.variation = "settled";
      c.stock.sows = 12;
      c.herd.startMode = "staggered";
      c.housing.enforceCapacity = true;
      c.housing.weanerPlaces = 5;
      c.housing.growerPlaces = 5;
      c.housing.finisherPlaces = 5;
    });
    const run = runEngine(input, horizonDay(input));

    expect(run.policies.enforceHousing).toBe(false);
    expect(run.lifetime.movementsBlocked).toBe(0);
    expect(run.lifetime.heldAtSaleWeightDays).toBe(0);
  }, 60_000);
});

describe("Each 2.0 subsystem is migrated on its own", () => {
  it("reports what every subsystem changes against one baseline", () => {
    const rows = migrationReport(
      plan((c) => {
        c.stock.sows = 10;
        c.herd.startMode = "staggered";
        c.project.variation = "settled";
      }),
    );
    const byName = new Map(rows.map((row) => [row.subsystem, row.report]));

    // The port on its own moves nothing.
    expect(byName.get("none (port only)")!.identical).toBe(true);

    // And every switch is a switch: it moves something, and it is the only thing
    // that can have moved it.
    for (const subsystem of [
      "housing capacity",
      "estrus windows",
      "operational procurement",
      "accrual accounting",
    ]) {
      expect(byName.get(subsystem)!.identical, subsystem).toBe(false);
    }
  }, 120_000);
});

describe("What each subsystem does once it is on", () => {
  const cramped = plan((c) => {
    c.stock.sows = 12;
    c.herd.startMode = "staggered";
    c.herd.maxSows = 12;
    c.project.variation = "settled";
    c.housing.farrowingPlaces = 4;
    c.housing.weanerPlaces = 20;
    c.housing.growerPlaces = 16;
    c.housing.finisherPlaces = 20;
  });

  it("makes pen capacity change production instead of describing it", () => {
    const roomy = structuredClone(cramped);
    roomy.housing.weanerPlaces = 2_000;
    roomy.housing.growerPlaces = 2_000;
    roomy.housing.finisherPlaces = 2_000;
    roomy.housing.farrowingPlaces = 200;

    const tight = runEngine(cramped, horizonDay(cramped), {
      policies: { ...LEGACY_POLICIES, enforceHousing: true },
    });
    const loose = runEngine(roomy, horizonDay(roomy), {
      policies: { ...LEGACY_POLICIES, enforceHousing: true },
    });

    // The whole point: places are now a constraint, and a farm short of them
    // sells fewer pigs. Under 1.x these two runs were identical.
    expect(tight.lifetime.movementsBlocked).toBeGreaterThan(0);
    expect(tight.lifetime.animalDaysOverCapacity).toBeGreaterThan(0);
    expect(loose.lifetime.movementsBlocked).toBe(0);
    expect(tight.lifetime.sold).toBeLessThan(loose.lifetime.sold);
  }, 60_000);

  it("reports occupancy, blocked movements and the day a room first bound", () => {
    const tight = runEngine(cramped, horizonDay(cramped), {
      policies: { ...LEGACY_POLICIES, enforceHousing: true },
    });
    const rooms = tight.housingReport();
    expect(rooms.map((room) => room.id)).toEqual([
      "farrowing",
      "weaner",
      "grower",
      "finisher",
    ]);
    const limiting = rooms.filter((room) => room.firstLimitingDay !== null);
    expect(limiting.length).toBeGreaterThan(0);
    for (const room of rooms) {
      expect(room.peakOccupants).toBeGreaterThanOrEqual(0);
      expect(room.utilisation).toBeGreaterThanOrEqual(0);
    }
  }, 60_000);

  it("makes a missed heat cost a cycle rather than a day", () => {
    const short = plan((c) => {
      c.stock.sows = 20;
      c.herd.startMode = "synchronised";
      c.herd.maxSows = 20;
      c.project.variation = "settled";
      // One boar cannot serve twenty sows in one window, so the window has to
      // close on some of them — which under 1.x simply happened tomorrow.
      c.stock.boars = 1;
    });
    const windowed = runEngine(short, horizonDay(short), {
      policies: { ...LEGACY_POLICIES, enforceEstrusWindows: true },
    });
    const queued = runEngine(short, horizonDay(short), { policies: LEGACY_POLICIES });

    expect(windowed.lifetime.heatsMissed).toBeGreaterThan(0);
    expect(queued.lifetime.heatsMissed).toBe(0);
    // Losing whole cycles costs litters, and litters are the farm's output.
    expect(windowed.lifetime.litters).toBeLessThan(queued.lifetime.litters);
  }, 60_000);

  it("buys feed from what is in the bin rather than from the whole horizon", () => {
    const operational = runEngine(plan(), horizonDay(plan()), {
      policies: { ...LEGACY_POLICIES, operationalProcurement: true },
    });
    const stores = operational.storeLevels();
    // A real bin has a size, where the foresight planner's does not.
    expect(stores.find((store) => store.id === "feed-sow")!.capacity).not.toBeNull();
    // Feed is ordered and delivered without ever having seen the future, so the
    // farm ends the plan holding stock rather than finishing on exactly nothing.
    expect(operational.world.supplies.storeValue).toBeGreaterThan(0);
    expect(operational.lifetime.lorries).toBeGreaterThan(0);
  }, 60_000);

  it("separates what the feed cost from when the bank paid for it", () => {
    const input = plan((c) => {
      c.feed.supplierPaymentDays = 30;
      c.project.variation = "settled";
    });
    const accrual = runEngine(input, horizonDay(input), {
      policies: { ...LEGACY_POLICIES, accrualAccounting: true },
    });
    const world = accrual.world;

    // The profit and loss and the cash book are no longer the same statement.
    const accrued = world.ledger.totals["feed-sow"];
    const paid = world.ledger.cashTotals["feed-sow"];
    expect(accrued).toBeGreaterThan(0);
    expect(paid).toBeGreaterThan(0);
    expect(paid).not.toBeCloseTo(accrued, 2);

    // And what is owed is real money, taken off the farm's worth.
    const valuation = accrual.valuation();
    expect(valuation.payables).toBeGreaterThan(0);
    expect(valuation.netWorth).toBeCloseTo(
      world.ledger.cash + valuation.herdValue - valuation.payables,
      6,
    );
  }, 60_000);
});
