"use client";

import { readCachedArtifact, writeCachedArtifact } from "@/lib/simulation-cache";
import {
  answerSimulationRequest,
  askSimulationWorker,
  type SimulationJob,
  type SimulationPort,
  type SimulationResponse,
} from "@/lib/simulation-worker";

/**
 * The browser's side of the worker: how one is started, and how a one-off job
 * is asked for.
 *
 * It exists as its own module because of the one line in it that cannot be
 * written anywhere else. `new URL(..., import.meta.url)` is what tells the
 * bundler that the file named is a module to build for a worker rather than a
 * string to leave alone, so the path has to be spelled out at the site of the
 * `new Worker` and cannot be passed in. One place, then, and everything that
 * wants a farm off-thread comes through here.
 */
export function spawnSimulationWorker(): SimulationPort {
  return new Worker(new URL("./simulation.worker.ts", import.meta.url), {
    type: "module",
  }) as unknown as SimulationPort;
}

/**
 * Runs one job on a worker of its own and waits for it.
 *
 * For the farm runs that happen because somebody pressed a button — an event
 * log to download, a month of cash injections to plan. Each gets its own worker
 * rather than sharing the one the pages are reading: it does not wait behind
 * that plan, and it does not get terminated when the next edit supersedes it.
 *
 * Rejects with something worth showing a person: a plan that would not run, a
 * worker that stopped, or a browser that would not start one and had nothing to
 * fall back on.
 */
export async function runSimulationJob(job: SimulationJob): Promise<SimulationResponse> {
  const kind = "job-" + job.type;
  const qualifier = job.type === "pig-datasheet" ? job.tag : "";

  const cached = await readCachedArtifact<SimulationResponse>(
    kind,
    job.config,
    qualifier,
  );
  if (cached !== null && cached.type !== "error") {
    // Callers only use the discriminator and payload. Zero run time makes the
    // cache hit explicit to diagnostics without changing the response shape.
    return { ...cached, id: 1, runMs: 0 } as SimulationResponse;
  }

  const response = await askSimulationWorker(job, {
    spawn: spawnSimulationWorker,
    // A browser with no workers still gets its export; it just pays for it on
    // the thread it is drawing with, as everything here used to.
    fallback: answerSimulationRequest,
  });

  if (response.type !== "error") {
    await writeCachedArtifact(kind, job.config, response, qualifier);
  }
  return response;
}
