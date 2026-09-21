"use client";

import { Money } from "@/components/planner-sections";
import { usePlanner } from "@/components/planner-shell";

export default function MoneyPage() {
  const { config, simulation, update } = usePlanner();
  if (!simulation) return null;
  // The table and the charts read the run; the funding controls read and write
  // the inputs, which is why the live config goes down as well.
  return (
    <Money
      config={simulation.config}
      projection={simulation.projection}
      editing={config}
      update={update}
    />
  );
}
