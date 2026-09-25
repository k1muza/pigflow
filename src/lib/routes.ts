/**
 * Where a plan lives.
 *
 * A plan is what the whole app is about, so it is what the address names:
 * `/projects/<id>`, with every page of that plan beneath it. Keeping it in the
 * URL rather than in a variable is what makes the back button work, what lets
 * two plans sit open in two tabs, and what makes "look at the cashflow on the
 * second shed" a link somebody can be sent.
 */

/** The pages of a plan, in the order the sidebar lists them. */
export const PLAN_TABS = [
  "overview",
  "simulator",
  "pedigree",
  "nutrition",
  "money",
  "method",
  "cashflow",
  "reports",
] as const;

export type Tab = (typeof PLAN_TABS)[number];

/**
 * The address of one page of one plan. The overview has no segment of its own:
 * it is what the plan opens on, so it is the plan's own address rather than a
 * second way of writing it.
 */
export function planHref(projectId: string, tab: Tab = "overview"): string {
  const plan = "/projects/" + encodeURIComponent(projectId);
  return tab === "overview" ? plan : plan + "/" + tab;
}

/** Browse ingredients, or open one ingredient, inside a plan's nutrition workspace. */
export function ingredientHref(projectId: string, ingredientId?: string): string {
  const base = planHref(projectId, "nutrition") + "/ingredients";
  return ingredientId ? base + "/" + encodeURIComponent(ingredientId) : base;
}

/**
 * Which page an address is on. Anything that is not a page of a plan reads as
 * the overview, because that is what a plan opens on — the sidebar has to mark
 * something, and marking the plan's own page is never wrong.
 */
export function tabFromPath(pathname: string): Tab {
  const segments = pathname.split("/").filter(Boolean);
  if (segments[0] !== "projects") return "overview";
  const tab = segments[2];
  return PLAN_TABS.some((known) => known === tab) ? (tab as Tab) : "overview";
}


/** App-level feed formulation workspace, deliberately outside any farm plan. */
export function feedFormulationHref(section?: "ingredients" | "requirements"): string {
  return section ? `/feed-formulation/${section}` : "/feed-formulation";
}

/** One NRC ingredient in the app-level formulation workspace. */
export function feedIngredientHref(ingredientId: string): string {
  return feedFormulationHref("ingredients") + "/" + encodeURIComponent(ingredientId);
}
