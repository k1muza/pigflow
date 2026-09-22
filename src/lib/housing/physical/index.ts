/**
 * Physical housing: the farm as buildings, rooms and pens with animals in them.
 *
 * The rest of `lib/housing` sizes a unit. This one runs it. The two meet at
 * exactly one place — the housing demand builder, which says which house every
 * animal belongs in every morning — so the farm that is designed and the farm
 * that is filled can never disagree about where a sow ought to be standing.
 *
 * ```text
 * PlanConfig → housing planning run → HousingNeedsResult
 *            → physicalFarmPlanOf   → PhysicalFarmPlan  (saved into the plan)
 *
 * PlanConfig + PhysicalFarmPlan → ordinary run
 *            → PhysicalHousingAllocator → movements, conflicts, occupancy
 * ```
 *
 * The first line happens when somebody presses Generate Housing, and never on
 * its own. The second happens on every run of a plan that has housing, and adds
 * no second pass over the farm: the allocator watches the run that was happening
 * anyway.
 */

export * from "./model";
export * from "./state";
export * from "./history";
export * from "./result";
export * from "./events";
export * from "./allocator";
export * from "./generate";
