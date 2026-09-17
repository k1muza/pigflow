"use client";

import { Overview } from "@/components/planner-sections";
import { usePlanner } from "@/components/planner-shell";

/** A plan opens on what it comes to: `/projects/<id>`. */
export default function OverviewPage() {
  const { config, projection, href } = usePlanner();
  if (!projection) return null;
  return <Overview config={config} projection={projection} inputsHref={href("inputs")} />;
}
