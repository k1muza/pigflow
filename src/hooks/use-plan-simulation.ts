"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { PlannerConfig } from "@/lib/config";
import { simulatePlan } from "@/lib/simulation";
import { planResultOf } from "@/lib/simulation-result";
import {
  IDLE_SIMULATION,
  PlanSimulationRunner,
  type PlanSimulationState,
} from "@/lib/simulation-worker";
import { spawnSimulationWorker } from "@/workers/simulation-client";

/**
 * How long the inputs have to stop changing before a farm is run.
 *
 * A farm cannot be asked to stop once it starts, so a run that is superseded
 * costs its worker (see `lib/simulation-worker`). Typing "300" over three
 * keystrokes should therefore be one run and not three — and `useDeferredValue`
 * will not do it: it coalesces updates only while React is busy, and somebody
 * typing at a human pace gives it time to settle between every digit.
 *
 * Short enough not to feel like waiting, long enough to cover typing.
 */
const SETTLE_MS = 350;

/**
 * One farm, running beside the page rather than in front of it.
 *
 * The worker belongs to whoever holds the plan — the shell — and not to a chart,
 * so that moving between the cashflow and the simulator does not stop and
 * restart a run that is already going. Everything about messages, ids and stale
 * replies lives in `lib/simulation-worker`; this is only the part that has to be
 * a hook.
 */
export function usePlanSimulation(
  config: PlannerConfig | null,
  /**
   * What the result belongs to — the open plan's id. A result is kept while the
   * same plan is being edited and dropped when another plan is opened, because
   * this hook lives in the planner's layout and React keeps a layout's state
   * across a move from one plan to another. Without it, plan B would show plan
   * A's cashflow until its own arrived.
   */
  scope: string,
): PlanSimulationState {
  const [state, setState] = useState<PlanSimulationState>(IDLE_SIMULATION);
  const runner = useRef<PlanSimulationRunner | null>(null);

  /**
   * The runner, built the first time a plan is actually run rather than on
   * every render. It outlives every config change, and with it the worker: the
   * only thing that builds a second worker is abandoning a run.
   */
  const acquire = useCallback(() => {
    if (runner.current === null) {
      runner.current = new PlanSimulationRunner({
        spawn: spawnSimulationWorker,
        onState: setState,
        // A browser that will not give us a worker still gets its plan; it just
        // pays for it on the thread it is drawing with.
        fallback: (input) => planResultOf(simulatePlan(input)),
      });
    }
    return runner.current;
  }, []);

  // Another plan is another farm: what is on screen belongs to the one that has
  // been closed. Runs before the effect below, so the new plan starts at once.
  useEffect(() => {
    runner.current?.forget();
  }, [scope]);

  useEffect(() => {
    if (config === null) return;
    const current = acquire();
    // Nothing is on screen, so there is nothing to wait for: the first plan of
    // a session, and the first of a plan just opened, run immediately.
    if (current.showing === null) {
      current.run(config);
      return;
    }
    const timer = setTimeout(() => current.run(config), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [acquire, config]);

  // Let the worker go when the planner does, and not before. Written as its own
  // effect so that a config change never touches it.
  useEffect(
    () => () => {
      runner.current?.close();
      runner.current = null;
    },
    [],
  );

  return state;
}

