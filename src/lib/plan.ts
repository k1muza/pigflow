import type { PlannerConfig } from "./config";
import { engineHorizonDay } from "./engine/engine";
import { simulatePlan } from "./simulation";
import { Farm, horizonDay, type FarmEvent, type FarmState, type FarmTimeline } from "./sim";

/**
 * Reading a plan, whichever engine runs it.
 *
 * The projection has chosen its engine off `project.engine` for a while. Nothing
 * else did: the simulator, the timeline and the event-log export each built a
 * 1.x farm and read that, so a plan set to 2.0 showed 2.0 money on the cashflow
 * page and 1.x everything on every other page — two simulations of the same farm
 * disagreeing about what happened in it, with nothing on screen to say why.
 *
 * So the read models go through here. One decision, made once, in the one place
 * a page has to come through to see a farm at all.
 *
 * Each function below stands a farm up, reads one thing off it and lets it go,
 * which is what a caller that wants one thing wants. A caller that wants several
 * — the planner shell, which shows a projection, a calendar and a day panel of
 * the same plan — should hold a {@link simulatePlan} instead and read all of
 * them off the one run.
 */

/** The horizon in the terms the chosen engine counts days in. */
export function planHorizonDay(config: PlannerConfig): number {
  return config.project.engine === "2.0" ? engineHorizonDay(config) : horizonDay(config);
}

/**
 * Runs the plan up to a wall-clock moment and reports what is standing on it.
 * Events resolve to whole days, so a timestamp reads the state of its own day.
 */
export function planStateAt(config: PlannerConfig, timestamp: string): FarmState {
  return simulatePlan(config, { snapshots: false }).stateAt(timestamp);
}

/** The whole plan day by day, and the same days grouped into months. */
export function planTimeline(config: PlannerConfig): FarmTimeline {
  return simulatePlan(config, { snapshots: false }).timeline;
}

/**
 * Every line the plan wrote as it ran, start to finish. The running log is
 * capped so that a long plan does not carry the whole of it for the sake of the
 * last dozen lines; this asks for all of it, which is the point of a log you are
 * going to read.
 */
export function planEventLog(config: PlannerConfig): FarmEvent[] {
  return simulatePlan(config, { snapshots: false, keepEveryEvent: true }).events;
}

/**
 * The 1.x farm itself, for the tests and tools that mean that farm specifically
 * rather than whichever one a plan is set to. Nothing a page reads should use it.
 */
export function legacyFarm(config: PlannerConfig, throughDay = horizonDay(config)): Farm {
  return new Farm(config).advanceTo(throughDay);
}
