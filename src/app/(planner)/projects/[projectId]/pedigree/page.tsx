"use client";

import { PedigreeGraph } from "@/components/pedigree-graph";
import { usePlanner } from "@/components/planner-shell";

export default function PedigreePage() {
  const { simulation } = usePlanner();
  if (!simulation) return null;

  return (
    <div className="mx-auto max-w-[1800px] space-y-4 p-4 sm:p-6">
      <div>
        <h2 className="text-lg font-semibold text-ink">Pedigree & ancestry</h2>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-ink-muted">
          Every genetic individual seen anywhere in this simulation, including animals sold or lost
          before the horizon. Non-breeding littermates are collapsed by default so a whole-farm
          pedigree stays navigable; click a litter or search a tag to open the individual pigs.
        </p>
      </div>
      <PedigreeGraph records={simulation.pedigree} />
    </div>
  );
}
