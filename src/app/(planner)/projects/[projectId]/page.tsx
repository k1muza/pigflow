"use client";

import { Overview } from "@/components/planner-sections";
import { usePlanner } from "@/components/planner-shell";

/** A plan opens on what it comes to: `/projects/<id>`. */
export default function OverviewPage() {
  const { simulation, openInputs } = usePlanner();
  if (!simulation) return null;
  // The config and the projection off one run, together: what is on screen is
  // the farm that was simulated and not the inputs as they now stand.
  return (
    <Overview
      config={simulation.config}
      projection={simulation.projection}
      onOpenInputs={openInputs}
    />
  );
}
