import { afterEach, describe, expect, it, vi } from "vitest";
import { FIRST_PLAN_ID } from "./cloud-plans";

import { cloneDefaultConfig } from "./config";
import {
  activeProject,
  addProject,
  createWorkspace,
  duplicateProject,
  LEGACY_PLAN_KEY,
  loadWorkspace,
  newProjectId,
  openProject,
  parseWorkspace,
  projectName,
  removeProject,
  renameProject,
  saveWorkspace,
  setActiveConfig,
  WORKSPACE_KEY,
} from "./workspace";

/** A stand-in for the browser store, so the saved-data paths can be exercised. */
function fakeWindow(seed: Record<string, string> = {}) {
  const store = new Map(Object.entries(seed));
  return {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Plans are kept side by side, each with its own inputs", () => {
  it("starts with one plan, open", () => {
    const workspace = createWorkspace();
    expect(workspace.projects).toHaveLength(1);
    expect(activeProject(workspace).id).toBe(workspace.activeId);
  });

  it("opens a new plan and never gives it a name already in use", () => {
    const first = createWorkspace();
    const named = renameProject(first, first.activeId, "Hillside");
    const second = addProject(named, "Hillside");

    expect(second.projects).toHaveLength(2);
    expect(activeProject(second).id).not.toBe(named.activeId);
    expect(projectName(activeProject(second))).toBe("Hillside 2");
  });

  it("keeps a duplicate independent of the plan it was copied from", () => {
    const start = createWorkspace();
    const copied = duplicateProject(start, start.activeId);
    const copy = activeProject(copied);

    // The copy opens, and sits next to its source rather than at the end.
    expect(copied.projects.map((project) => project.id)).toEqual([start.activeId, copy.id]);
    expect(copy.config.herd.maxSows).toBe(start.projects[0].config.herd.maxSows);

    const edited = setActiveConfig(copied, {
      ...copy.config,
      herd: { ...copy.config.herd, maxSows: 60 },
    });
    expect(activeProject(edited).config.herd.maxSows).toBe(60);
    expect(edited.projects[0].config.herd.maxSows).toBe(
      start.projects[0].config.herd.maxSows,
    );
  });

  it("writes inputs only to the plan that is open", () => {
    const start = addProject(createWorkspace(), "Second");
    const firstId = start.projects[0].id;
    const changed = setActiveConfig(start, {
      ...activeProject(start).config,
      project: { ...activeProject(start).config.project, months: 72 },
    });

    expect(activeProject(changed).config.project.months).toBe(72);
    expect(changed.projects.find((project) => project.id === firstId)!.config.project.months).toBe(
      cloneDefaultConfig().project.months,
    );
  });

  it("leaves every other plan exactly as it was when one plan is edited", () => {
    const three = addProject(addProject(createWorkspace(), "Second"), "Third");
    const [first, second, third] = three.projects;
    const untouched = [JSON.stringify(first.config), JSON.stringify(third.config)];

    // Every kind of input at once: a number, a nested number, and both of the
    // arrays a plan carries.
    const edited = setActiveConfig(openProject(three, second.id), {
      ...second.config,
      project: { ...second.config.project, months: 120 },
      herd: { ...second.config.herd, maxSows: 99 },
      growth: { ...second.config.growth, saleWeightKg: 115 },
      health: { ...second.config.health, vaccinations: [] },
      finance: {
        ...second.config.finance,
        cashMovements: [
          { id: "grant", monthIndex: 0, kind: "in", amount: 5000, note: "Grant", auto: false },
        ],
      },
    });

    expect(JSON.stringify(edited.projects[0].config)).toBe(untouched[0]);
    expect(JSON.stringify(edited.projects[2].config)).toBe(untouched[1]);
    expect(edited.projects[1].config.herd.maxSows).toBe(99);
    expect(edited.projects[1].config.finance.cashMovements).toHaveLength(1);
    expect(edited.projects[0].config.finance.cashMovements).toHaveLength(0);
  });

  it("gives every plan its own objects, so none can be shared by reference", () => {
    // Duplicating is where aliasing would creep in, so the copy is checked
    // against its source section by section. A shared object would let an
    // in-place edit anywhere in the app reach a plan nobody was editing.
    const start = createWorkspace();
    const pair = duplicateProject(start, start.activeId);
    const source = pair.projects[0].config;
    const copy = pair.projects[1].config;

    for (const section of Object.keys(source) as (keyof typeof source)[]) {
      expect(copy[section]).not.toBe(source[section]);
    }
    expect(copy.health.vaccinations).not.toBe(source.health.vaccinations);
    expect(copy.finance.cashMovements).not.toBe(source.finance.cashMovements);

    // A plan started from the defaults must not alias them either, or editing it
    // would change what the next new plan starts from.
    const fresh = addProject(pair, "Third").projects[2].config;
    expect(fresh.health.vaccinations).not.toBe(source.health.vaccinations);
    expect(fresh.herd).not.toBe(source.herd);
  });

  it("lands on a neighbour when the open plan is deleted", () => {
    const start = addProject(addProject(createWorkspace(), "Second"), "Third");
    const middleId = start.projects[1].id;
    const onMiddle = openProject(start, middleId);
    const after = removeProject(onMiddle, middleId);

    expect(after.projects).toHaveLength(2);
    expect(after.projects.some((project) => project.id === middleId)).toBe(false);
    expect(after.activeId).toBe(start.projects[2].id);
  });

  it("refuses to delete the last plan, because an empty workspace shows nothing", () => {
    const only = createWorkspace();
    expect(removeProject(only, only.activeId)).toBe(only);
  });
});

describe("Saved plans survive being read back", () => {
  it("round-trips a workspace through the browser store", () => {
    vi.stubGlobal("window", fakeWindow());
    const start = renameProject(addProject(createWorkspace(), "Second"), "x", "ignored");
    saveWorkspace(start);

    const loaded = loadWorkspace();
    expect(loaded).not.toBeNull();
    expect(loaded!.projects.map(projectName)).toEqual(start.projects.map(projectName));
    expect(loaded!.activeId).toBe(start.activeId);
  });

  it("carries a single plan saved by an older version into the workspace", () => {
    const legacy = cloneDefaultConfig();
    legacy.project.name = "Before the switcher";
    legacy.herd.maxSows = 33;
    vi.stubGlobal("window", fakeWindow({ [LEGACY_PLAN_KEY]: JSON.stringify(legacy) }));

    const loaded = loadWorkspace();
    expect(loaded!.projects).toHaveLength(1);
    expect(projectName(loaded!.projects[0])).toBe("Before the switcher");
    expect(loaded!.projects[0].config.herd.maxSows).toBe(33);
  });

  it("prefers the workspace over the older single plan once one exists", () => {
    const workspace = renameProject(createWorkspace(), "", "");
    const saved = createWorkspace();
    vi.stubGlobal(
      "window",
      fakeWindow({
        [WORKSPACE_KEY]: JSON.stringify(saved),
        [LEGACY_PLAN_KEY]: JSON.stringify(cloneDefaultConfig()),
      }),
    );
    expect(workspace.projects).toHaveLength(1);
    expect(loadWorkspace()!.activeId).toBe(saved.activeId);
  });

  it("drops a plan that no longer parses instead of losing the ones that do", () => {
    const good = createWorkspace();
    const workspace = parseWorkspace({
      activeId: good.activeId,
      projects: [
        // A sale weight no schema would accept, and a row that is not a plan at all.
        { id: "out-of-range", config: { growth: { saleWeightKg: 5000 } } },
        "not a plan",
        good.projects[0],
      ],
    });

    expect(workspace!.projects).toHaveLength(1);
    expect(workspace!.projects[0].id).toBe(good.projects[0].id);
  });

  it("falls back to the first plan when the stored open one has gone", () => {
    const start = addProject(createWorkspace(), "Second");
    const workspace = parseWorkspace({ activeId: "deleted-long-ago", projects: start.projects });
    expect(workspace!.activeId).toBe(start.projects[0].id);
  });

  it("returns nothing at all rather than an empty workspace", () => {
    expect(parseWorkspace({ projects: [] })).toBeNull();
    expect(parseWorkspace(null)).toBeNull();
    expect(parseWorkspace({ activeId: "x" })).toBeNull();
  });
});

describe("the first plan of all", () => {
  it("can be put on a known document so two people do not each start one", () => {
    // The farm and a colleague opening an empty planner at the same moment would
    // otherwise seed a plan each, and both would find a stranger's copy waiting.
    expect(createWorkspace(undefined, FIRST_PLAN_ID).projects[0].id).toBe(FIRST_PLAN_ID);
    expect(createWorkspace(undefined, FIRST_PLAN_ID).activeId).toBe(FIRST_PLAN_ID);
  });

  it("still gives every plan made afterwards an id of its own", () => {
    const start = createWorkspace(undefined, FIRST_PLAN_ID);
    const second = addProject(start, "Second").projects[1].id;
    const copy = duplicateProject(start, FIRST_PLAN_ID).projects[1].id;
    expect(new Set([FIRST_PLAN_ID, second, copy]).size).toBe(3);
  });
});

describe("the id a plan is known by", () => {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  it("is a UUID, because it is also the plan's address and its document name", () => {
    expect(newProjectId()).toMatch(UUID);
    expect(addProject(createWorkspace(), "Second").projects[1].id).toMatch(UUID);
  });

  it("is still a UUID where randomUUID is not allowed", () => {
    // A phone opening the planner over plain http has no secure context, so
    // `crypto.randomUUID` is simply absent there. Falling back to something that
    // is not a UUID would make that phone's plans the odd ones out for good.
    const real = globalThis.crypto;
    try {
      Object.defineProperty(globalThis, "crypto", {
        value: { getRandomValues: real.getRandomValues.bind(real) },
        configurable: true,
      });
      expect(newProjectId()).toMatch(UUID);
    } finally {
      Object.defineProperty(globalThis, "crypto", { value: real, configurable: true });
    }
  });

  it("does not repeat itself", () => {
    const ids = new Set(Array.from({ length: 500 }, () => newProjectId()));
    expect(ids.size).toBe(500);
  });
});
