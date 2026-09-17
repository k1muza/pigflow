import { describe, expect, it } from "vitest";
import { cloneDefaultConfig, type PlannerConfig } from "./config";
import {
  mergeRemote,
  planChanges,
  readPlanRow,
  sameWorkspace,
  stableJson,
  workspaceFromRows,
  type PlanRow,
} from "./cloud-plans";
import type { Workspace } from "./workspace";

function config(name: string, saleWeightKg = 95): PlannerConfig {
  const base = cloneDefaultConfig();
  return {
    ...base,
    project: { ...base.project, name },
    growth: { ...base.growth, saleWeightKg },
  };
}

function row(id: string, order: number, name = id): PlanRow {
  return { id, order, config: config(name) };
}

function workspace(rows: PlanRow[], activeId = rows[0]?.id): Workspace {
  return { activeId, projects: rows.map((r) => ({ id: r.id, config: r.config })) };
}

/** Stands in for the way Firestore hands a stored map back with its keys resorted. */
function reorderKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reorderKeys);
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).reverse();
    return Object.fromEntries(entries.map(([key, item]) => [key, reorderKeys(item)]));
  }
  return value;
}

describe("stableJson", () => {
  it("reads two objects with the same values as the same, whatever order the keys came in", () => {
    // Firestore hands map keys back sorted, so a config that made the round trip
    // has its keys in a different order than the one the app sent.
    expect(stableJson({ b: 1, a: { d: 2, c: 3 } })).toBe(stableJson({ a: { c: 3, d: 2 }, b: 1 }));
  });

  it("keeps arrays in the order they were given", () => {
    expect(stableJson([3, 1, 2])).not.toBe(stableJson([1, 2, 3]));
  });

  it("ignores keys that were never set", () => {
    expect(stableJson({ a: 1, b: undefined })).toBe(stableJson({ a: 1 }));
  });
});

describe("readPlanRow", () => {
  it("reads a stored plan back", () => {
    const stored = { config: config("Hillside"), order: 2 };
    expect(readPlanRow("plan-a", stored)).toEqual({
      id: "plan-a",
      order: 2,
      config: expect.objectContaining({ project: expect.objectContaining({ name: "Hillside" }) }),
    });
  });

  it("drops a document that is not a plan rather than failing the whole read", () => {
    expect(readPlanRow("junk", { config: { growth: { saleWeightKg: 5000 } } })).toBeNull();
    expect(readPlanRow("junk", { nothing: true })).toBeNull();
    expect(readPlanRow("junk", null)).toBeNull();
  });

  it("puts a plan with no order last instead of first", () => {
    const withoutOrder = readPlanRow("plan-a", { config: config("Hillside") });
    expect(withoutOrder?.order).toBeGreaterThan(1000);
  });
});

describe("workspaceFromRows", () => {
  it("puts the plans in the order everyone else sees them in", () => {
    const opened = workspaceFromRows([row("c", 2), row("a", 0), row("b", 1)], null);
    expect(opened?.projects.map((p) => p.id)).toEqual(["a", "b", "c"]);
  });

  it("keeps the plan this device had open", () => {
    expect(workspaceFromRows([row("a", 0), row("b", 1)], "b")?.activeId).toBe("b");
  });

  it("opens the first plan when the one this device had open is gone", () => {
    expect(workspaceFromRows([row("a", 0), row("b", 1)], "deleted")?.activeId).toBe("a");
  });

  it("has nothing to open when there are no plans", () => {
    expect(workspaceFromRows([], null)).toBeNull();
  });
});

describe("planChanges", () => {
  const remote = [row("a", 0), row("b", 1)];

  it("writes nothing when the screen already matches the cloud", () => {
    expect(planChanges(workspace(remote), remote)).toEqual({ writes: [], deletes: [] });
  });

  it("writes only the plan that was edited, leaving the others untouched", () => {
    const edited = workspace([{ ...remote[0] }, { ...remote[1], config: config("b", 101) }]);
    const changes = planChanges(edited, remote);
    expect(changes.writes.map((w) => w.id)).toEqual(["b"]);
    expect(changes.deletes).toEqual([]);
  });

  it("writes a plan whose place in the list moved", () => {
    const reordered = workspace([remote[1], remote[0]]);
    expect(planChanges(reordered, remote).writes.map((w) => [w.id, w.order])).toEqual([
      ["b", 0],
      ["a", 1],
    ]);
  });

  it("writes a plan that was started on this device", () => {
    const added = workspace([...remote, row("c", 0)]);
    expect(planChanges(added, remote).writes).toEqual([
      expect.objectContaining({ id: "c", order: 2 }),
    ]);
  });

  it("deletes a plan that is no longer on the list", () => {
    expect(planChanges(workspace([remote[0]]), remote).deletes).toEqual(["b"]);
  });

  it("does not write when a config comes back with its keys in a different order", () => {
    // What Firestore returns is the same plan, so it must not look like an edit —
    // otherwise every reader would rewrite every plan on load, forever.
    const shuffled = remote.map((r) => ({ ...r, config: reorderKeys(r.config) as PlannerConfig }));
    expect(planChanges(workspace(remote), shuffled)).toEqual({ writes: [], deletes: [] });
  });
});

describe("mergeRemote", () => {
  const remote = [row("a", 0), row("b", 1)];

  it("takes the cloud's version when this device has changed nothing", () => {
    const theirs = [row("a", 0), { ...row("b", 1), config: config("b renamed") }];
    const merged = mergeRemote(workspace(remote), theirs, remote);
    expect(merged.projects[1].config.project.name).toBe("b renamed");
  });

  it("shows a plan somebody else has just added", () => {
    const theirs = [...remote, row("c", 2)];
    expect(mergeRemote(workspace(remote), theirs, remote).projects.map((p) => p.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("keeps an edit that has not been written yet, even while the cloud says otherwise", () => {
    const mine = workspace([remote[0], { ...remote[1], config: config("mine") }]);
    const theirs = [row("a", 0), { ...row("b", 1), config: config("theirs") }];
    const merged = mergeRemote(mine, theirs, remote);
    expect(merged.projects[1].config.project.name).toBe("mine");
  });

  it("lets somebody else's edit through while this device is busy with another plan", () => {
    // The point of merging rather than ignoring the reading: two people editing
    // two different plans must both keep their work.
    const mine = workspace([{ ...remote[0], config: config("mine") }, remote[1]]);
    const theirs = [row("a", 0), { ...row("b", 1), config: config("theirs") }];
    const merged = mergeRemote(mine, theirs, remote);
    expect(merged.projects[0].config.project.name).toBe("mine");
    expect(merged.projects[1].config.project.name).toBe("theirs");
  });

  it("does not bring back a plan this device has just deleted", () => {
    const merged = mergeRemote(workspace([remote[0]]), remote, remote);
    expect(merged.projects.map((p) => p.id)).toEqual(["a"]);
  });

  it("keeps a plan started here where it was put, not at the end of the list", () => {
    // A duplicated plan sits next to its source. It must not jump to the bottom
    // and back again in the moment before its write lands.
    const mine = workspace([remote[0], row("copy", 0), remote[1]]);
    expect(mergeRemote(mine, remote, remote).projects.map((p) => p.id)).toEqual([
      "a",
      "copy",
      "b",
    ]);
  });

  it("holds on to what is on screen when the cloud has been emptied", () => {
    const mine = workspace(remote);
    expect(mergeRemote(mine, [], remote).projects.map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("opens another plan when the one on screen was deleted by somebody else", () => {
    const mine = workspace(remote, "b");
    expect(mergeRemote(mine, [row("a", 0)], remote).activeId).toBe("a");
  });
});

describe("sameWorkspace", () => {
  const remote = [row("a", 0), row("b", 1)];

  it("sees no change when nothing has changed", () => {
    expect(sameWorkspace(workspace(remote), workspace(remote))).toBe(true);
  });

  it("sees a change of plan", () => {
    expect(sameWorkspace(workspace(remote, "a"), workspace(remote, "b"))).toBe(false);
  });

  it("sees a change of inputs", () => {
    const edited = workspace([remote[0], { ...remote[1], config: config("b", 101) }]);
    expect(sameWorkspace(workspace(remote), edited)).toBe(false);
  });
});
