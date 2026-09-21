"use client";

import { Reports } from "@/components/report-centre";
import { usePlanner } from "@/components/planner-shell";

/**
 * Every document this plan can produce, from the one run behind every page.
 *
 * The whole result goes down rather than the projection alone: the balance
 * sheet reads the valuation the farm closed each month on, which lives on the
 * simulated days rather than on the monthly roll-up.
 */
export default function ReportsPage() {
  const { simulation, simulationCurrent, simulationUpdating } = usePlanner();
  if (!simulation) return null;
  return (
    <Reports
      simulation={simulation}
      current={simulationCurrent}
      updating={simulationUpdating}
    />
  );
}
