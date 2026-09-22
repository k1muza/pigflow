/**
 * The housing needs planner.
 *
 * Four phases over a finished simulation, in this order and no other:
 *
 * ```text
 * PlanConfig → farm simulation → daily herd state
 *            → demand      (which house every animal wants, every morning)
 *            → allocator   (how many pens must exist at once)
 *            → geometry    (what one of those pens is, as a rectangle)
 *            → structures  (rooms, and the buildings they come to)
 * ```
 *
 * It reads the farm and never writes to it. Turning it on cannot move a figure
 * on the cashflow, the profit statement, the balance sheet or the herd plan —
 * that is the property the suite in `housing.test.ts` exists to hold.
 */

export * from "./rules";
export * from "./demand";
export * from "./allocator";
export * from "./geometry";
export * from "./structures";
export * from "./result";
