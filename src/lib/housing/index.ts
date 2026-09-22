/**
 * The housing needs planner.
 *
 * Five phases over a finished simulation, in this order and no other:
 *
 * ```text
 * PlanConfig → farm simulation → daily herd state
 *            → demand      (which house every animal wants, every morning)
 *            → allocator   (how many pens must exist at once, and on which days)
 *            → geometry    (what one of those pens is, as a rectangle)
 *            → structures  (every arrangement of rooms and buildings, costed)
 *            → capacity    (the reserve, the phasing and how hard it is worked)
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
export * from "./capacity";
export * from "./result";
export * from "./physical";
