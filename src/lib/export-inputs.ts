import type { PlannerConfig } from "./config";

/**
 * The plan exactly as PigFlow uses it, without an export-only wrapper, so the
 * downloaded JSON can be passed straight to the planner schema elsewhere.
 */
export function buildInputsJson(config: PlannerConfig): string {
  return JSON.stringify(config, null, 2) + "\n";
}

/** A filesystem-friendly name that still identifies the source plan. */
export function inputsJsonFilename(config: PlannerConfig): string {
  const slug = config.project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${slug || "plan"}-farm-inputs.json`;
}
