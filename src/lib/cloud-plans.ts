import { withConfigDefaults, type PlannerConfig } from "./config";
import type { Workspace } from "./workspace";

/** The collection every plan lives in. There is one shared set, not one per person. */
export const PLANS_COLLECTION = "plans";

/**
 * The document the very first plan is written to.
 *
 * Seeding an empty planner is the one moment two people can collide: if the farm
 * and a colleague both open it before either has saved, each would otherwise
 * start a plan of its own and the other would find two identical plans waiting.
 * Writing the first one to a known document instead means they land on top of
 * each other and only one plan appears. Every plan made afterwards gets an id of
 * its own, because by then the plans are genuinely different.
 *
 * It is spelled as a UUID like every other plan id, because it is also the
 * address that plan is read at and a well-known id should not be the one plan
 * whose link looks different from the rest.
 */
export const FIRST_PLAN_ID = "00000000-0000-4000-8000-000000000001";

/**
 * A plan as Firestore holds it. `order` is the plan's place in the switcher,
 * kept as a field because a collection has no order of its own and two people
 * should see the same list in the same sequence.
 */
export type PlanRow = {
  id: string;
  config: PlannerConfig;
  order: number;
};

/**
 * Compares by value rather than by reference, with object keys in a fixed order
 * so that a config read back from Firestore — which returns map keys sorted —
 * is recognised as the same plan we sent, instead of looking like an edit and
 * starting a write loop between everyone who has the planner open.
 */
export function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return "[" + value.map(stableJson).join(",") + "]";
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return "{" + entries.map(([key, item]) => JSON.stringify(key) + ":" + stableJson(item)).join(",") + "}";
}

/**
 * Reads one stored document. A plan saved by an older version of the app goes
 * through the same defaulting a local plan always did, and a document that is
 * not a plan at all is dropped rather than taking the whole list down with it.
 */
export function readPlanRow(id: string, data: unknown): PlanRow | null {
  if (!data || typeof data !== "object") return null;
  const stored = data as { config?: unknown; order?: unknown };
  const config = withConfigDefaults(stored.config);
  if (!config) return null;
  return { id, config, order: typeof stored.order === "number" ? stored.order : Number.MAX_SAFE_INTEGER };
}

/**
 * Turns the stored plans into the workspace the app renders. Which plan is open
 * stays a property of this device — two people sharing a set of plans are not
 * usually reading the same one — so a stale or missing id simply opens the first.
 */
export function workspaceFromRows(rows: PlanRow[], activeId: string | null): Workspace | null {
  if (rows.length === 0) return null;
  const projects = [...rows]
    .sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((row) => ({ id: row.id, config: row.config }));
  const active = projects.some((project) => project.id === activeId) ? activeId! : projects[0].id;
  return { activeId: active, projects };
}

/**
 * Works out the smallest set of documents that would make the cloud match what
 * is on screen. Only the plans that actually moved or changed are written, so
 * editing one plan does not touch anyone else's work in the other plans.
 */
export function planChanges(
  workspace: Workspace,
  remote: PlanRow[],
): { writes: PlanRow[]; deletes: string[] } {
  const stored = new Map(remote.map((row) => [row.id, row]));
  const writes: PlanRow[] = [];

  workspace.projects.forEach((project, order) => {
    const before = stored.get(project.id);
    const unchanged =
      before && before.order === order && stableJson(before.config) === stableJson(project.config);
    if (!unchanged) writes.push({ id: project.id, config: project.config, order });
  });

  const open = new Set(workspace.projects.map((project) => project.id));
  const deletes = remote.filter((row) => !open.has(row.id)).map((row) => row.id);

  return { writes, deletes };
}

/**
 * Folds a fresh reading of the shared plans into what is on screen, without
 * throwing away an edit that has not been written yet.
 *
 * The cloud decides which plans exist and what order they sit in, because that
 * is what everyone else is looking at. This device keeps only what it has
 * changed since `remote` was read: a plan it is part-way through editing keeps
 * its own inputs, a plan it has just deleted does not reappear, and a plan it
 * has just created stays visible until the write lands. Nothing is dropped —
 * two people editing the same plan at once settle on the last write, but two
 * people editing different plans both keep their work.
 */
export function mergeRemote(current: Workspace, rows: PlanRow[], remote: PlanRow[]): Workspace {
  const pending = planChanges(current, remote);
  const editedHere = new Map(pending.writes.map((row) => [row.id, row.config]));
  const deletedHere = new Set(pending.deletes);

  const merged = [...rows]
    .sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .filter((row) => !deletedHere.has(row.id))
    .map((row) => ({ id: row.id, config: editedHere.get(row.id) ?? row.config }));

  // A plan started on this device is not in the cloud yet. Put it back where its
  // owner left it rather than at the end, so a duplicated plan does not jump out
  // from beside its source and then back again once the write lands.
  //
  // A plan the cloud used to hold and no longer does is a different story: that
  // is somebody else deleting it, and it must not come back. The previous
  // reading is what tells the two apart.
  const present = new Set(merged.map((project) => project.id));
  const wasInCloud = new Set(remote.map((row) => row.id));
  current.projects.forEach((project, index) => {
    if (present.has(project.id) || wasInCloud.has(project.id)) return;
    merged.splice(Math.min(index, merged.length), 0, project);
  });

  if (merged.length === 0) return current;
  const activeId = merged.some((project) => project.id === current.activeId)
    ? current.activeId
    : merged[0].id;
  return { activeId, projects: merged };
}

/** Whether a workspace arriving from the cloud would actually change the screen. */
export function sameWorkspace(a: Workspace, b: Workspace): boolean {
  return a.activeId === b.activeId && stableJson(a.projects) === stableJson(b.projects);
}
