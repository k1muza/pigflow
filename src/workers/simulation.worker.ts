import { planResultTransfers } from "@/lib/simulation-result";
import { answerSimulationRequest, type SimulationRequest } from "@/lib/simulation-worker";

/**
 * Where the farm actually runs.
 *
 * This file is the whole of the worker, and it is meant to stay this short: a
 * message in, {@link answerSimulationRequest} in the middle, a message out. No
 * modelling decision is made here and none should be — a farm that behaved
 * differently in a worker than on the main thread would be a second model
 * nobody was maintaining, and the only way to notice would be for the two to
 * disagree in front of somebody.
 */

const worker = self as unknown as Worker;

const JOBS = new Set(["simulate", "project", "event-log", "generate-housing", "pig-datasheet"]);

worker.onmessage = (event: MessageEvent<SimulationRequest>) => {
  const request = event.data;
  if (!JOBS.has(request?.type)) return;

  const response = answerSimulationRequest(request);
  if (response.type === "result") {
    // The day columns are handed over rather than copied, which is most of the
    // reason they are columns. See `lib/simulation-result`.
    worker.postMessage(response, planResultTransfers(response.result));
    return;
  }
  worker.postMessage(response);
};
