import { describe, expect, it, vi } from "vitest";

import { cloneDefaultConfig, type PlannerConfig } from "./config";
import { simulatePlan } from "./simulation";
import { daySnapshotAt, planResultOf, type PlanSimulationResult } from "./simulation-result";
import {
  answerSimulationRequest,
  PlanSimulationRunner,
  type PlanSimulationState,
  type SimulationPort,
  type SimulationRequest,
  type SimulationResponse,
} from "./simulation-worker";

/**
 * The wire, tested without a browser on either end of it.
 *
 * Two things can go wrong here that cannot go wrong in a synchronous call, and
 * both are quiet. A reply can arrive for a plan the person has already edited
 * past — three sows landing on top of three hundred — and nothing on screen
 * would look broken, it would just be wrong. And a worker can die mid-run, at
 * which point the page has to keep the last plan it had rather than go blank.
 * Neither is something to reason about and hope; they are tested here against a
 * worker that does exactly what it is told and no more.
 */

function plan(engine: "1.x" | "2.0"): PlannerConfig {
  const input = cloneDefaultConfig();
  input.project.engine = engine;
  input.project.months = 12;
  input.project.variation = "settled";
  input.stock.sows = 12;
  input.herd.startMode = "staggered";
  input.herd.maxSows = 12;
  return input;
}

/**
 * A worker that answers when a test says so.
 *
 * Nothing about it is asynchronous, because the thing being tested is the order
 * replies are taken in and not the scheduler that delivers them.
 */
class FakePort implements SimulationPort {
  onmessage: ((event: { data: SimulationResponse }) => void) | null = null;
  onerror: ((event: { message?: string }) => void) | null = null;
  onmessageerror: ((event: unknown) => void) | null = null;
  readonly sent: SimulationRequest[] = [];
  terminated = false;

  postMessage(request: SimulationRequest): void {
    this.sent.push(request);
  }

  terminate(): void {
    this.terminated = true;
  }

  /** Answers a request that was sent, as the worker would. */
  reply(id: number, result: PlanSimulationResult): void {
    this.onmessage?.({ data: { type: "result", id, result, runMs: 1 } });
  }

  fail(id: number, message: string): void {
    this.onmessage?.({ data: { type: "error", id, message } });
  }
}

/** The runner, its states in order, and the workers it was given. */
function runnerOn(options: { fallback?: boolean } = {}) {
  const ports: FakePort[] = [];
  const states: PlanSimulationState[] = [];
  const runner = new PlanSimulationRunner({
    spawn: () => {
      const port = new FakePort();
      ports.push(port);
      return port;
    },
    onState: (state) => states.push(state),
    fallback: options.fallback
      ? (config) => planResultOf(simulatePlan(config))
      : undefined,
  });
  const latest = () => states[states.length - 1];
  return { runner, ports, states, latest };
}

/** A result standing in for a plan, since the runner never looks inside one. */
function fakeResult(name: string): PlanSimulationResult {
  return { config: { project: { name } } } as unknown as PlanSimulationResult;
}

describe("The worker answers with the plan the main thread would have got", () => {
  for (const engine of ["1.x", "2.0"] as const) {
    it(`matches a direct ${engine} run, figure for figure`, () => {
      const config = plan(engine);
      const answer = answerSimulationRequest({ type: "simulate", id: 1, config });
      expect(answer.type).toBe("result");
      if (answer.type !== "result") return;

      const direct = planResultOf(simulatePlan(config));
      expect(answer.id).toBe(1);
      expect(answer.result.projection).toEqual(direct.projection);
      expect(answer.result.timeline).toEqual(direct.timeline);
      expect(answer.result.horizonDay).toBe(direct.horizonDay);
      expect([...answer.result.days.values]).toEqual([...direct.days.values]);
    }, 120_000);
  }

  it("repeats itself for one seed and moves for another", () => {
    const config = plan("1.x");
    config.project.variation = "chance";
    const ask = (input: PlannerConfig) => {
      const answer = answerSimulationRequest({ type: "simulate", id: 1, config: input });
      if (answer.type !== "result") throw new Error(answer.message);
      return answer.result;
    };

    const first = ask(config);
    expect(ask(config).projection).toEqual(first.projection);
    expect(
      ask({ ...config, project: { ...config.project, seed: config.project.seed + 1 } }).projection
        .summary.totalPigsSold,
    ).not.toBe(first.projection.summary.totalPigsSold);
  }, 180_000);

  it("reports a plan it cannot run rather than throwing", () => {
    const broken = { ...plan("1.x"), project: { ...plan("1.x").project, months: 0 } };
    const answer = answerSimulationRequest({ type: "simulate", id: 7, config: broken });

    expect(answer.type).toBe("error");
    expect(answer.id).toBe(7);
    if (answer.type === "error") expect(answer.message.length).toBeGreaterThan(0);
  });
});

describe("An older plan never lands on top of a newer one", () => {
  it("ignores the reply to a request that has been superseded", () => {
    const { runner, ports, latest } = runnerOn();
    const three = fakeResult("3 sows");
    const thirty = fakeResult("30 sows");

    runner.run(plan("1.x"));
    runner.run(plan("1.x"));
    runner.run(plan("1.x"));

    // Each new plan abandoned the worker running the last one, so the answers
    // come from three different workers — and only the last one is still wanted.
    const [first, second, third] = ports;
    first.reply(1, three);
    expect(latest().result).toBeNull();

    second.reply(2, thirty);
    expect(latest().result).toBeNull();

    third.reply(3, fakeResult("300 sows"));
    expect(latest().result?.config.project.name).toBe("300 sows");
    expect(latest().status).toBe("ready");
  });

  it("ignores a second answer to a request already answered", () => {
    const { runner, ports, latest } = runnerOn();

    // A plan that finishes leaves its worker standing, so the next one goes to
    // the same worker rather than a new one.
    runner.run(plan("1.x"));
    ports[0].reply(1, fakeResult("first"));
    expect(latest().result?.config.project.name).toBe("first");

    runner.run(plan("1.x"));
    // A repeat of the answer to the plan before this one. It is a whole plan
    // and it is perfectly correct; it is also the farm as it was an edit ago.
    ports[0].reply(1, fakeResult("first, again"));
    expect(latest().status).toBe("running");
    expect(latest().result?.config.project.name).toBe("first");

    ports[0].reply(2, fakeResult("second"));
    expect(latest().result?.config.project.name).toBe("second");
    expect(latest().status).toBe("ready");
    expect(runner.workersSpawned).toBe(1);
  });
});

describe("An obsolete run is abandoned rather than waited for", () => {
  it("terminates the worker a new plan arrives on top of", () => {
    const { runner, ports } = runnerOn();

    runner.run(plan("1.x"));
    expect(ports).toHaveLength(1);
    expect(ports[0].terminated).toBe(false);

    runner.run(plan("1.x"));
    // The farm cannot be asked to stop, so the worker it is running in goes.
    expect(ports[0].terminated).toBe(true);
    expect(ports).toHaveLength(2);
    expect(ports[1].sent).toHaveLength(1);
  });

  it("keeps one worker for as many plans as finish on it", () => {
    const { runner, ports } = runnerOn();

    for (let run = 1; run <= 4; run += 1) {
      runner.run(plan("1.x"));
      ports[0].reply(run, fakeResult("plan " + run));
    }

    expect(runner.workersSpawned).toBe(1);
    expect(ports).toHaveLength(1);
    expect(ports[0].sent.map((request) => request.id)).toEqual([1, 2, 3, 4]);
  });

  it("lets the worker go when the planner does", () => {
    const { runner, ports, states } = runnerOn();
    runner.run(plan("1.x"));
    runner.close();

    expect(ports[0].terminated).toBe(true);
    const after = states.length;
    // Nothing that arrives afterwards is anybody's business.
    ports[0].reply(1, fakeResult("too late"));
    runner.run(plan("1.x"));
    expect(states).toHaveLength(after);
    expect(ports).toHaveLength(1);
  });
});

describe("A simulation that fails leaves the page standing", () => {
  it("keeps the last good plan and says what went wrong", () => {
    const { runner, ports, latest } = runnerOn();

    runner.run(plan("1.x"));
    ports[0].reply(1, fakeResult("good"));

    runner.run(plan("1.x"));
    ports[0].fail(2, "Sows must be a whole number.");

    expect(latest().status).toBe("error");
    expect(latest().error).toBe("Sows must be a whole number.");
    // Still the plan that did run. Blanking the charts would lose more than the
    // failed edit did.
    expect(latest().result?.config.project.name).toBe("good");
    expect(latest().isUpdating).toBe(false);
  });

  it("recovers on the next plan, error message and all", () => {
    const { runner, ports, latest } = runnerOn();

    runner.run(plan("1.x"));
    ports[0].fail(1, "nope");
    expect(latest().status).toBe("error");

    runner.run(plan("1.x"));
    expect(latest().status).toBe("running");
    expect(latest().error).toBeNull();
    ports[0].reply(2, fakeResult("fine"));
    expect(latest().status).toBe("ready");
  });

  it("treats a worker that dies mid-run as a failed plan, and builds another", () => {
    const { runner, ports, latest } = runnerOn();

    runner.run(plan("1.x"));
    ports[0].onerror?.({ message: "Worker terminated unexpectedly." });

    expect(latest().status).toBe("error");
    expect(latest().error).toBe("Worker terminated unexpectedly.");

    runner.run(plan("1.x"));
    expect(ports).toHaveLength(2);
    expect(latest().status).toBe("running");
  });

  it("survives a reply it cannot read", () => {
    const { runner, ports, latest } = runnerOn();
    runner.run(plan("1.x"));
    ports[0].onmessageerror?.({});

    expect(latest().status).toBe("error");
    expect(ports[0].terminated).toBe(true);
  });

  it("falls back to this thread when no worker can be had", async () => {
    const states: PlanSimulationState[] = [];
    const runner = new PlanSimulationRunner({
      spawn: () => {
        throw new Error("Workers are blocked.");
      },
      onState: (state) => states.push(state),
      fallback: (config) => planResultOf(simulatePlan(config)),
    });

    runner.run(plan("1.x"));
    expect(states[states.length - 1].status).toBe("running");
    await vi.waitFor(() => expect(states[states.length - 1].status).toBe("ready"), {
      timeout: 60_000,
    });

    const result = states[states.length - 1].result;
    expect(result).not.toBeNull();
    expect(result?.projection.months.length).toBe(12);
  }, 120_000);

  it("says so when there is no worker and no fallback either", () => {
    const states: PlanSimulationState[] = [];
    const runner = new PlanSimulationRunner({
      spawn: () => {
        throw new Error("Workers are blocked.");
      },
      onState: (state) => states.push(state),
    });

    runner.run(plan("1.x"));
    expect(states[states.length - 1].status).toBe("error");
    expect(states[states.length - 1].result).toBeNull();
  });
});

describe("What a page does with the answer", () => {
  it("reads a second date without asking the worker anything", () => {
    const { runner, ports, latest } = runnerOn();
    const result = planResultOf(simulatePlan(plan("1.x")));

    runner.run(plan("1.x"));
    ports[0].reply(1, result);
    const sentAfterFirstRun = ports[0].sent.length;

    const held = latest().result as PlanSimulationResult;
    const first = daySnapshotAt(held, held.days.dates[30] + "T23:00");
    const second = daySnapshotAt(held, held.days.dates[31] + "T23:00");

    expect(first.date).toBe(held.days.dates[30]);
    expect(second.date).toBe(held.days.dates[31]);
    expect(first.finance.cash).not.toBe(second.finance.cash);
    // Picking a date is a read of what came back, so the wire stays quiet.
    expect(ports[0].sent).toHaveLength(sentAfterFirstRun);
    expect(runner.workersSpawned).toBe(1);
  }, 120_000);
});
