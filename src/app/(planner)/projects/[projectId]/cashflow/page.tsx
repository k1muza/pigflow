"use client";

import { CashflowPreview } from "@/components/planner-sections";
import { usePlanner } from "@/components/planner-shell";

export default function CashflowPage() {
  const { simulation, exporting, exportExcel } = usePlanner();
  if (!simulation) return null;
  // Both halves off one run: a cashflow read against inputs it was not worked
  // out from is a cashflow that does not foot.
  return (
    <CashflowPreview
      config={simulation.config}
      projection={simulation.projection}
      exporting={exporting}
      onExport={exportExcel}
    />
  );
}
