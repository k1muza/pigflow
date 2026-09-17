import type { ReactNode } from "react";
import PlannerShell from "@/components/planner-shell";

/**
 * One plan, and every page of it beneath.
 *
 * The shell is the layout rather than part of each page so that the plans, the
 * sign-in and the simulated herd all survive a move from the overview to the
 * cashflow. Only the panel changes.
 */
export default function ProjectLayout({ children }: { children: ReactNode }) {
  return <PlannerShell>{children}</PlannerShell>;
}
