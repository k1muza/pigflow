"use client";

import { Simulator } from "@/components/planner-sections";
import { usePlanner } from "@/components/planner-shell";

export default function SimulatorPage() {
  const { simulation } = usePlanner();
  // The day-by-day farm will not run on inputs that do not parse.
  if (!simulation) return null;
  return <Simulator simulation={simulation} />;
}
