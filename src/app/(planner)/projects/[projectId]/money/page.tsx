"use client";

import { Money } from "@/components/planner-sections";
import { usePlanner } from "@/components/planner-shell";

export default function MoneyPage() {
  const { config, projection, update } = usePlanner();
  if (!projection) return null;
  return <Money config={config} projection={projection} update={update} />;
}
