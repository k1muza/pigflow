"use client";

import { CashflowPreview } from "@/components/planner-sections";
import { usePlanner } from "@/components/planner-shell";

export default function CashflowPage() {
  const { config, projection, exporting, exportExcel } = usePlanner();
  if (!projection) return null;
  return (
    <CashflowPreview
      config={config}
      projection={projection}
      exporting={exporting}
      onExport={exportExcel}
    />
  );
}
