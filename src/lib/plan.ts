import { parseISO } from "date-fns";

import type { PlannerConfig } from "./config";
import { Engine, engineHorizonDay } from "./engine/engine";
import { engineEventLog, engineState } from "./engine/read";
import {
  Farm,
  farmEventLog,
  farmStateAt,
  farmTimeline,
  horizonDay,
  timelineOf,
  type FarmEvent,
  type FarmState,
  type FarmTimeline,
} from "./sim";

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
  if (config.project.engine !== "2.0") return farmStateAt(config, timestamp);

  const engine = new Engine(config);
  const moment = parseISO(timestamp);
  const requested = Number.isNaN(moment.getTime()) ? 0 : engine.world.dayOf(moment);
  const day = Math.min(Math.max(requested, -1), engineHorizonDay(config));
  engine.advanceTo(day);
  return engineState(engine, timestamp);
}

/** The whole plan day by day, and the same days grouped into months. */
export function planTimeline(config: PlannerConfig): FarmTimeline {
  if (config.project.engine !== "2.0") return farmTimeline(config);

  const engine = new Engine(config).advanceTo(engineHorizonDay(config));
  const world = engine.world;
  return timelineOf(config, world.history, (date) => world.dayOf(date));
}

/**
 * Every line the plan wrote as it ran, start to finish. The running log is
 * capped so that a long plan does not carry the whole of it for the sake of the
 * last dozen lines; this asks for all of it, which is the point of a log you are
 * going to read.
 */
export function planEventLog(config: PlannerConfig): FarmEvent[] {
  if (config.project.engine !== "2.0") return farmEventLog(config);

  const engine = new Engine(config, { keepEveryEvent: true });
  engine.advanceTo(engineHorizonDay(config));
  return engineEventLog(engine.world.log.events);
}

/**
 * The 1.x farm itself, for the tests and tools that mean that farm specifically
 * rather than whichever one a plan is set to. Nothing a page reads should use it.
 */
export function legacyFarm(config: PlannerConfig, throughDay = horizonDay(config)): Farm {
  return new Farm(config).advanceTo(throughDay);
}
