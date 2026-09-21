"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { PlannerConfig } from "@/lib/config";
import { simulatePlan } from "@/lib/simulation";
import { planResultOf } from "@/lib/simulation-result";
import {
  IDLE_SIMULATION,
  PlanSimulationRunner,
  type PlanSimulationState,
  type SimulationPort,
} from "@/lib/simulation-worker";

/**
 * One farm, running beside the page rather than in front of it.
 *
 * The worker belongs to whoever holds the plan — the shell — and not to a chart,
 * so that moving between the cashflow and the simulator does not stop and
 * restart a run that is already going. Everything about messages, ids and stale
 * replies lives in `lib/simulation-worker`; this is only the part that has to be
 * a hook.
 */
export function usePlanSimulation(config: PlannerConfig | null): PlanSimulationState {
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

  useEffect(() => {
    if (config === null) return;
    acquire().run(config);
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

/**
 * The worker itself.
 *
 * `new URL(..., import.meta.url)` is what tells the bundler this is a module to
 * build for a worker rather than a string to leave alone, so the path is
 * written out here and cannot be built up.
 */
function spawnSimulationWorker(): SimulationPort {
  return new Worker(new URL("../workers/simulation.worker.ts", import.meta.url), {
    type: "module",
  }) as unknown as SimulationPort;
}
