"use client";

import { Simulator } from "@/components/planner-sections";
import { usePlanner } from "@/components/planner-shell";

export default function SimulatorPage() {
  const { checked } = usePlanner();
  // The day-by-day farm will not run on inputs that do not parse.
  if (!checked) return null;
  return <Simulator config={checked} />;
}
