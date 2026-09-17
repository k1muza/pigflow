"use client";

import { Methodology } from "@/components/planner-sections";
import { usePlanner } from "@/components/planner-shell";

export default function MethodPage() {
  const { config, metrics } = usePlanner();
  return <Methodology config={config} metrics={metrics} />;
}
