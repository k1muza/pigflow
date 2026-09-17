"use client";

import { Inputs } from "@/components/planner-sections";
import { usePlanner } from "@/components/planner-shell";

export default function InputsPage() {
  const { config, update, metrics } = usePlanner();
  return <Inputs config={config} update={update} metrics={metrics} />;
}
