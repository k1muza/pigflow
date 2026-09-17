import { cloneDefaultConfig, withConfigDefaults, type PlannerConfig } from "./config";

/**
 * One saved plan. Everything the app shows — the herd, the cashflow, the
 * workbook — is derived from a plan's inputs, so a plan is its config and
 * nothing else needs to be kept beside it. The name lives inside the config
 * because it is an ordinary input the owner can edit on the inputs page.
 */
export type Project = {
  id: string;
  config: PlannerConfig;
};

/** Every plan on this device, and which one is open. */
export type Workspace = {
  activeId: string;
  projects: Project[];
};

export const WORKSPACE_KEY = "pigflow-workspace-v1";
/** Where a single plan was kept before the app could hold more than one. */
export const LEGACY_PLAN_KEY = "pigflow-plan-v4";

/**
 * Enough plans to compare scenarios properly, few enough that the switcher stays
 * a list you can read rather than one you have to search.
 */
export const MAX_PROJECTS = 24;

function newId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid;
  return "plan-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

/** The plan that is open, falling back to the first if the active id has gone. */
export function activeProject(workspace: Workspace): Project {
  return workspace.projects.find((project) => project.id === workspace.activeId) ?? workspace.projects[0];
}

export function projectName(project: Project): string {
  return project.config.project.name.trim() || "Untitled plan";
}

/**
 * Makes a name that is not already taken, so two plans are never told apart only
 * by the order they happen to sit in. "My piggery plan" becomes "My piggery plan
 * 2", then 3 — the way a person would number them.
 */
export function availableName(workspace: Workspace, wanted: string): string {
  const taken = new Set(workspace.projects.map((project) => projectName(project).toLowerCase()));
  const base = wanted.trim() || "Untitled plan";
  if (!taken.has(base.toLowerCase())) return base;
  for (let suffix = 2; suffix < 100; suffix += 1) {
    const candidate = base + " " + suffix;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return base + " " + newId().slice(0, 4);
}

function withName(config: PlannerConfig, name: string): PlannerConfig {
  return { ...config, project: { ...config.project, name } };
}

export function createWorkspace(
  config: PlannerConfig = cloneDefaultConfig(),
  id: string = newId(),
): Workspace {
  const project = { id, config };
  return { activeId: project.id, projects: [project] };
}

/** Starts a plan from the evidence-based defaults and opens it. */
export function addProject(workspace: Workspace, name: string): Workspace {
  if (workspace.projects.length >= MAX_PROJECTS) return workspace;
  const project = {
    id: newId(),
    config: withName(cloneDefaultConfig(), availableName(workspace, name)),
  };
  return { activeId: project.id, projects: [...workspace.projects, project] };
}

/**
 * Copies a plan and opens the copy, which is how a scenario is really made: take
 * the plan you believe in, change one thing, and keep both to compare.
 */
export function duplicateProject(workspace: Workspace, id: string): Workspace {
  if (workspace.projects.length >= MAX_PROJECTS) return workspace;
  const source = workspace.projects.find((project) => project.id === id);
  if (!source) return workspace;
  const copy = {
    id: newId(),
    config: withName(
      structuredClone(source.config),
      availableName(workspace, projectName(source) + " copy"),
    ),
  };
  const at = workspace.projects.indexOf(source) + 1;
  const projects = [...workspace.projects];
  projects.splice(at, 0, copy);
  return { activeId: copy.id, projects };
}

/**
 * Deletes a plan, unless it is the only one — a workspace with nothing in it has
 * no state the app could render, and an empty screen is not a useful answer to a
 * mis-click.
 */
export function removeProject(workspace: Workspace, id: string): Workspace {
  if (workspace.projects.length < 2) return workspace;
  const at = workspace.projects.findIndex((project) => project.id === id);
  if (at < 0) return workspace;
  const projects = workspace.projects.filter((project) => project.id !== id);
  // Deleting the open plan lands you on its neighbour rather than back at the top.
  const activeId =
    workspace.activeId === id ? projects[Math.min(at, projects.length - 1)].id : workspace.activeId;
  return { activeId, projects };
}

export function renameProject(workspace: Workspace, id: string, name: string): Workspace {
  const trimmed = name.trim();
  if (!trimmed) return workspace;
  return {
    ...workspace,
    projects: workspace.projects.map((project) =>
      project.id === id ? { ...project, config: withName(project.config, trimmed) } : project,
    ),
  };
}

export function openProject(workspace: Workspace, id: string): Workspace {
  if (!workspace.projects.some((project) => project.id === id)) return workspace;
  return { ...workspace, activeId: id };
}

/** Writes new inputs back to whichever plan is open, leaving the others alone. */
export function setActiveConfig(workspace: Workspace, config: PlannerConfig): Workspace {
  const open = activeProject(workspace);
  return {
    ...workspace,
    projects: workspace.projects.map((project) =>
      project.id === open.id ? { ...project, config } : project,
    ),
  };
}

/**
 * Reads a stored workspace back, plan by plan. A plan that no longer parses is
 * dropped rather than taking the rest of the workspace down with it, and every
 * one that survives goes through the same defaulting a single plan always did,
 * so plans saved before a field existed still open.
 */
export function parseWorkspace(value: unknown): Workspace | null {
  if (!value || typeof value !== "object") return null;
  const stored = value as { activeId?: unknown; projects?: unknown };
  if (!Array.isArray(stored.projects)) return null;

  const projects: Project[] = [];
  for (const entry of stored.projects) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as { id?: unknown; config?: unknown };
    const config = withConfigDefaults(row.config);
    if (!config) continue;
    projects.push({ id: typeof row.id === "string" && row.id ? row.id : newId(), config });
  }
  if (projects.length === 0) return null;

  const activeId =
    typeof stored.activeId === "string" &&
      projects.some((project) => project.id === stored.activeId)
      ? stored.activeId
      : projects[0].id;
  return { activeId, projects };
}

/**
 * Loads the workspace, carrying a single plan saved by an older version into it
 * as the first project. Someone who has been planning on this device keeps their
 * work and simply finds it named in the switcher.
 */
export function loadWorkspace(): Workspace | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(WORKSPACE_KEY);
    if (stored) {
      const workspace = parseWorkspace(JSON.parse(stored));
      if (workspace) return workspace;
    }
    const legacy = window.localStorage.getItem(LEGACY_PLAN_KEY);
    if (legacy) {
      const config = withConfigDefaults(JSON.parse(legacy));
      if (config) return createWorkspace(config);
    }
  } catch {
    // Keep safe defaults when saved browser data cannot be read or parsed.
  }
  return null;
}

export function saveWorkspace(workspace: Workspace): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(WORKSPACE_KEY, JSON.stringify(workspace));
  } catch {
    // A full or blocked store must not take the session down with it.
  }
}
