import { describe, expect, it } from "vitest";

import { cloneDefaultConfig, type PlannerConfig } from "./config";
import { calculateProjection } from "./model";
import { planEventLog, planStateAt, planTimeline } from "./plan";
import { farmEventLog, farmStateAt, farmTimeline } from "./sim";

/**
 * One farm per plan.
 *
 * The projection has picked its engine off `project.engine` for a while. Nothing
 * else did: the simulator, the timeline and the exported log each built a 1.x
 * farm and read that. A plan set to 2.0 therefore showed 2.0 money on the
 * cashflow page and 1.x everything everywhere else — two simulations of the same
 * farm disagreeing about how many pigs it sold, with nothing on screen to say
 * which you were looking at.
 */

function tightPlan(engine: "1.x" | "2.0"): PlannerConfig {
  const input = cloneDefaultConfig();
  input.project.engine = engine;
  input.project.months = 24;
  input.project.variation = "settled";
  input.stock.sows = 20;
  input.herd.startMode = "staggered";
  input.herd.maxSows = 20;
  // Short of finishing places, which is a thing only the 2.0 engine can feel.
  input.housing.finisherPlaces = 30;
  return input;
}

describe("Every page reads the engine the plan is set to", () => {
  it("agrees with the projection about a 2.0 plan, month for month", () => {
    const config = tightPlan("2.0");
    const projection = calculateProjection(config);
    const timeline = planTimeline(config);

    expect(timeline.months.length).toBe(projection.months.length);
    for (const [index, month] of projection.months.entries()) {
      expect(timeline.months[index].sold, month.month).toBe(month.pigsSold);
      expect(timeline.months[index].bornAlive, month.month).toBe(month.bornAlive);
      expect(timeline.months[index].closingCash, month.month).toBeCloseTo(month.closingCash, 6);
    }
  }, 60_000);

  it("shows the 2.0 farm rather than the 1.x one behind it", () => {
    // The two engines genuinely disagree on this plan, which is the point: the
    // 2.0 one holds pigs it has nowhere to finish. Before, the timeline showed
    // the 1.x answer whatever the plan said, so the disagreement was invisible
    // and the cashflow page was the only thing telling the truth.
    const config = tightPlan("2.0");
    const sold = (timeline: ReturnType<typeof planTimeline>) =>
      timeline.months.reduce((total, month) => total + month.sold, 0);

    expect(sold(planTimeline(config))).not.toBe(sold(farmTimeline(config)));
    expect(sold(planTimeline(config))).toBe(
      calculateProjection(config).summary.totalPigsSold,
    );
  }, 60_000);

  it("leaves a 1.x plan exactly as it was", () => {
    const config = tightPlan("1.x");
    expect(planTimeline(config)).toEqual(farmTimeline(config));
    expect(planEventLog(config)).toEqual(farmEventLog(config));
    expect(planStateAt(config, "2027-06-15T23:00")).toEqual(
      farmStateAt(config, "2027-06-15T23:00"),
    );
  }, 60_000);

  it("reads a 2.0 farm at a moment, debts and all", () => {
    const state = planStateAt(tightPlan("2.0"), "2027-06-15T23:00");

    expect(state.date).toBe("2027-06-15");
    expect(state.withinHorizon).toBe(true);
    expect(state.herd.sows).toBeGreaterThan(0);
    expect(state.stock.length).toBeGreaterThan(0);
    expect(state.sows.length).toBe(state.herd.sows);
    // Rosters are built by one shared function, so the panel shows the same rows
    // in the same order whichever engine filled them.
    expect(state.stock[0].kind).toBe("sow");
    expect(state.lifetime.sold).toBeGreaterThan(0);
    // What the farm is worth, less what it owes for feed it has already taken
    // in. The 1.x farm cannot owe anybody anything, so its net worth is the two
    // added; this one carries a real creditor and says so.
    const owed = state.finance.cash + state.finance.herdValue - state.finance.netWorth;
    expect(owed).toBeGreaterThan(0);
  }, 60_000);

  it("writes the 2.0 log with the reason the farm did it", () => {
    const events = planEventLog(tightPlan("2.0"));
    expect(events.length).toBeGreaterThan(0);

    // Housing lines exist at all, which they cannot in a 1.x log of this plan.
    const capacity = events.filter((event) => event.type === "capacity");
    expect(capacity.length).toBeGreaterThan(0);
    // And a 2.0 event carries its cause into the sentence, which is the half the
    // 1.x log never had: what happened, and why the plan did it.
    expect(capacity.some((event) => event.message.includes(" — "))).toBe(true);

    const kinds = new Set(events.map((event) => event.type));
    expect(kinds.has("farrowing")).toBe(true);
    expect(kinds.has("sale")).toBe(true);
  }, 60_000);
});
