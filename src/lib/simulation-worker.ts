import type { PlannerConfig } from "./config";
import type { ProjectionResult } from "./model";
import { planEventLog } from "./plan";
import { simulatePlan } from "./simulation";
import { planResultOf, type PlanSimulationResult } from "./simulation-result";
import type { FarmEvent } from "./sim";

/**
 * The wire between the page and the farm.
 *
 * Simulating a plan is hundreds of milliseconds of arithmetic that cannot be
 * interrupted once it starts, and on the main thread that is hundreds of
 * milliseconds in which nothing types, scrolls or scrolls smoothly.
 * `useDeferredValue` decides *when* to start it; it cannot make it yield once it
 * has. So the farm runs in a worker, and this is the protocol and the small
 * state machine on this side of it.
 *
 * Nothing here knows about React, and nothing here knows how a farm works. It
 * is a request with a number on it, a reply with the same number, and a rule
 * about which replies are worth listening to.
 */

/**
 * A piece of work the farm can be asked for.
 *
 * Three, because three things in the product need a farm run and want different
 * parts of one. The plan behind the pages is `simulate`. Planning cash
 * injections needs the monthly cashflow of a config that is not the open plan —
 * the same plan without its own generated funding rows — and nothing else.
 * The event log wants every line the farm wrote, which is the one thing the
 * ordinary result deliberately leaves out: a long plan writes hundreds of
 * thousands of them, and carrying that in every result to serve a button
 * nobody has pressed is the wrong trade.
 */
export type SimulationJob =
  | { type: "simulate"; config: PlannerConfig }
  | { type: "project"; config: PlannerConfig }
  | { type: "event-log"; config: PlannerConfig };

/** A job with the number that ties a reply to it. */
export type SimulationRequest = SimulationJob & {
  /** Goes up by one per request. The reply carries it back. */
  id: number;
};

export type SimulationResponse =
  | {
      type: "result";
      id: number;
      result: PlanSimulationResult;
      /** What the farm itself took, in the worker, in milliseconds. */
      runMs: number;
    }
  | { type: "projection"; id: number; projection: ProjectionResult; runMs: number }
  | { type: "event-log"; id: number; events: FarmEvent[]; runMs: number }
  | {
      type: "error";
      id: number;
      message: string;
    };

/**
 * One request, answered.
 *
 * The whole of what the worker does, kept out of the worker file so that it can
 * be run — and tested — without a browser to run a worker in. A plan simulated
 * here and a plan simulated on the main thread are the same call to the same
 * function; there is no second model behind the message boundary.
 */
export function answerSimulationRequest(request: SimulationRequest): SimulationResponse {
  const startedAt = now();
  const { id } = request;
  try {
    switch (request.type) {
      case "simulate":
        return {
          type: "result",
          id,
          result: planResultOf(simulatePlan(request.config)),
          runMs: now() - startedAt,
        };
      case "project":
        return {
          type: "projection",
          id,
          // No day readings: a cashflow has no use for the state of a Tuesday.
          projection: simulatePlan(request.config, { snapshots: false }).projection,
          runMs: now() - startedAt,
        };
      case "event-log":
        return {
          type: "event-log",
          id,
          events: planEventLog(request.config),
          runMs: now() - startedAt,
        };
    }
  } catch (error) {
    return { type: "error", id, message: messageOf(error) };
  }
}

/**
 * One job, on a worker of its own, awaited.
 *
 * For the work that happens because somebody pressed a button: an event log to
 * download, a month of cash injections to plan. It gets its own worker so that
 * it neither waits behind the plan the pages are showing nor gets terminated
 * when the next edit supersedes that plan, and the worker goes as soon as the
 * answer is out. There is one job on it, so the id is a formality.
 */
export function askSimulationWorker(
  job: SimulationJob,
  options: {
    spawn: () => SimulationPort;
    /** Runs the job here instead, for a browser that would not give us a worker. */
    fallback?: (request: SimulationRequest) => SimulationResponse;
  },
): Promise<SimulationResponse> {
  const request: SimulationRequest = { ...job, id: 1 };

  let port: SimulationPort;
  try {
    port = options.spawn();
  } catch (error) {
    const fallback = options.fallback;
    if (!fallback) return Promise.reject(new Error(messageOf(error)));
    // Synchronous and on this thread, which is what there is. Deferred by a
    // turn so a caller can put its button into its waiting state first.
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        const answer = fallback(request);
        if (answer.type === "error") reject(new Error(answer.message));
        else resolve(answer);
      }, 0);
    });
  }

  return new Promise<SimulationResponse>((resolve, reject) => {
    const done = (settle: () => void) => {
      port.onmessage = null;
      port.onerror = null;
      port.onmessageerror = null;
      try {
        port.terminate();
      } catch {
        // A worker that will not be terminated is already gone.
      }
      settle();
    };
    port.onmessage = (event) => {
      const answer = event.data;
      if (answer.id !== request.id) return;
      done(() =>
        answer.type === "error" ? reject(new Error(answer.message)) : resolve(answer),
      );
    };
    port.onerror = (event) =>
      done(() => reject(new Error(event?.message ?? "The simulation worker stopped.")));
    port.onmessageerror = () =>
      done(() => reject(new Error("The simulation worker sent something unreadable.")));
    try {
      port.postMessage(request);
    } catch (error) {
      done(() => reject(new Error(messageOf(error))));
    }
  });
}

/**
 * The part of a `Worker` the runner uses.
 *
 * Narrow on purpose: a test can stand in for a worker without a browser, which
 * is what lets the awkward parts — a stale reply, a worker that dies mid-run —
 * be tested at all rather than reasoned about.
 */
export type SimulationPort = {
  postMessage(request: SimulationRequest): void;
  terminate(): void;
  onmessage: ((event: { data: SimulationResponse }) => void) | null;
  onerror: ((event: { message?: string }) => void) | null;
  onmessageerror: ((event: unknown) => void) | null;
};

export type SimulationStatus =
  /** Nothing has been asked for yet. */
  | "idle"
  /** A farm is running. Whatever is on screen is the plan before this edit. */
  | "running"
  /** The result on screen is the plan as it is now. */
  | "ready"
  /** The last run failed. Whatever is on screen is the last one that did not. */
  | "error";

export type PlanSimulationState = {
  status: SimulationStatus;
  /**
   * The last plan that finished. Kept while a new one runs, so that editing an
   * input does not blank every chart on the page until the farm comes back.
   */
  result: PlanSimulationResult | null;
  error: string | null;
  /** A newer plan is running behind the one on screen. */
  isUpdating: boolean;
  /** What the last finished run cost, for the performance tests to read. */
  timings: { runMs: number; roundTripMs: number } | null;
};

export const IDLE_SIMULATION: PlanSimulationState = {
  status: "idle",
  result: null,
  error: null,
  isUpdating: false,
  timings: null,
};

export type PlanSimulationRunnerOptions = {
  /** Builds a worker. Called again after one is terminated or dies. */
  spawn: () => SimulationPort;
  /** Called every time the state changes, with the whole of it. */
  onState: (state: PlanSimulationState) => void;
  /**
   * Runs a plan here rather than in a worker, for a browser that would not give
   * us one. Without it a page with no worker shows an error and no plan; with
   * it the page works and the main thread pays for it, which is the older of
   * the two bad options but not the worse one.
   */
  fallback?: (config: PlannerConfig) => PlanSimulationResult;
};

/**
 * Keeps one worker, one plan in flight, and the last good result.
 *
 * Two rules do most of the work here. A reply is read only if it answers the
 * request that is current — a plan of thirty sows must never land on top of the
 * three hundred the person has since typed, however much quicker it was. And a
 * request that arrives while a farm is still running terminates that worker
 * rather than queueing behind it: the run cannot be asked to stop, and a 2.0
 * plan of a couple of hundred sows takes minutes, so waiting for work nobody
 * wants any more would make every later edit wait for it too.
 */
export class PlanSimulationRunner {
  private readonly options: PlanSimulationRunnerOptions;
  private port: SimulationPort | null = null;
  private state: PlanSimulationState = IDLE_SIMULATION;
  /** The request whose reply is worth having. Anything older is thrown away. */
  private latest = 0;
  /** Whether a farm is running in the worker right now. */
  private running = false;
  private sentAt = 0;
  private closed = false;
  /** Workers built over this runner's life, which a test counts. */
  private spawned = 0;

  constructor(options: PlanSimulationRunnerOptions) {
    this.options = options;
  }

  /** How many workers this runner has had to build. */
  get workersSpawned(): number {
    return this.spawned;
  }

  /** The plan on screen, if there is one. */
  get showing(): PlanSimulationResult | null {
    return this.state.result;
  }

  /** Runs a plan, and abandons whichever one was running. */
  run(config: PlannerConfig): void {
    if (this.closed) return;
    this.latest += 1;
    const id = this.latest;

    // Nothing can interrupt a farm mid-run, so an obsolete one is shown the
    // door rather than allowed to finish into a result nobody will read.
    if (this.running) this.dropWorker();

    const port = this.open();
    if (port === null) {
      this.runHere(id, config);
      return;
    }

    this.running = true;
    this.sentAt = now();
    this.publish({
      status: "running",
      isUpdating: this.state.result !== null,
      // A run that is on its way is not an error any more, whatever the last
      // one did; the message would otherwise outlive the thing it described.
      error: null,
    });
    try {
      port.postMessage({ type: "simulate", id, config });
    } catch (error) {
      this.running = false;
      this.fail(id, messageOf(error));
    }
  }

  /**
   * Drops the plan on screen and abandons whatever was being run for it.
   *
   * For when the thing being read changes rather than the inputs to it: another
   * plan opened. Keeping the last result is what stops an edit blanking every
   * chart on the page, and that only makes sense while it is the same plan being
   * edited — plan A's cashflow under plan B's name is not a stale number, it is
   * the wrong farm. The worker is kept; there is nothing wrong with it.
   */
  forget(): void {
    if (this.closed) return;
    // Bumped so that a reply still on its way answers to nobody.
    this.latest += 1;
    if (this.running) this.dropWorker();
    this.state = IDLE_SIMULATION;
    this.options.onState(this.state);
  }

  /** Lets the worker go. The runner is finished with after this. */
  close(): void {
    this.closed = true;
    this.dropWorker();
  }

  // ------------------------------------------------------------------ the port

  private open(): SimulationPort | null {
    if (this.port !== null) return this.port;
    try {
      const port = this.options.spawn();
      this.spawned += 1;
      port.onmessage = (event) => this.receive(event.data);
      port.onerror = (event) => this.died(event?.message);
      port.onmessageerror = () => this.died("The worker sent something unreadable.");
      this.port = port;
      return port;
    } catch {
      return null;
    }
  }

  /** Terminates the worker, so the next run starts on a clean one. */
  private dropWorker(): void {
    const port = this.port;
    this.port = null;
    this.running = false;
    if (port === null) return;
    port.onmessage = null;
    port.onerror = null;
    port.onmessageerror = null;
    try {
      port.terminate();
    } catch {
      // A worker that will not be terminated is already gone.
    }
  }

  private receive(response: SimulationResponse): void {
    // A reply to a plan that has been superseded. The person has moved on, and
    // so has the screen; putting this on it would be putting back the config
    // they just changed.
    if (response.id !== this.latest || this.closed) return;
    this.running = false;

    if (response.type === "error") {
      this.fail(response.id, response.message);
      return;
    }
    if (response.type !== "result") {
      // The runner only ever asks for a plan, so anything else answering to its
      // id is a worker talking about something this is not.
      this.fail(response.id, "The simulation worker answered the wrong question.");
      return;
    }
    this.publish({
      status: "ready",
      result: response.result,
      error: null,
      isUpdating: false,
      timings: { runMs: response.runMs, roundTripMs: now() - this.sentAt },
    });
  }

  /** The worker itself failed, rather than the plan inside it. */
  private died(message: string | undefined): void {
    const id = this.latest;
    const wasRunning = this.running;
    this.dropWorker();
    if (wasRunning) this.fail(id, message ?? "The simulation worker stopped.");
  }

  private fail(id: number, message: string): void {
    if (id !== this.latest || this.closed) return;
    // The last good plan stays on screen. A farm that would not run is a reason
    // to say so, not a reason to throw away the one that did.
    this.publish({ status: "error", error: message, isUpdating: false });
  }

  /** Runs the plan on this thread, because no worker could be had. */
  private runHere(id: number, config: PlannerConfig): void {
    const fallback = this.options.fallback;
    if (!fallback) {
      this.fail(id, "This browser would not start the simulation worker.");
      return;
    }
    this.publish({ status: "running", isUpdating: this.state.result !== null, error: null });
    // Off the current task, so React paints the "updating" state before the
    // main thread is taken for the length of the run.
    setTimeout(() => {
      if (id !== this.latest || this.closed) return;
      const startedAt = now();
      try {
        const result = fallback(config);
        this.publish({
          status: "ready",
          result,
          error: null,
          isUpdating: false,
          timings: { runMs: now() - startedAt, roundTripMs: now() - startedAt },
        });
      } catch (error) {
        this.fail(id, messageOf(error));
      }
    }, 0);
  }

  private publish(change: Partial<PlanSimulationState>): void {
    this.state = { ...this.state, ...change };
    this.options.onState(this.state);
  }
}

function now(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "The simulation failed.";
}
