import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PIC_EXAMPLE_FORMULATIONS } from "@/lib/feed-formulations";
import { analyzeFeedFormulation } from "@/lib/formulation-analysis";
import type { AnalyzedNutrient } from "@/lib/diet-formula";
import { feedFormulationStrategyHref } from "@/lib/routes";

export default function FeedFormulationsPage() {
  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Formulations</h1>
          <Badge variant="secondary">{PIC_EXAMPLE_FORMULATIONS.length} PIC example diets</Badge>
        </div>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-muted">
          PIC example ingredient ratios with resulting nutrient profiles calculated by PigFlow
          from the ingredient nutrient library.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {PIC_EXAMPLE_FORMULATIONS.map((formulation) => {
          const profile = analyzeFeedFormulation(formulation).analysis;
          return (
            <Link
              key={formulation.id}
              href={feedFormulationStrategyHref(formulation.id)}
              className="group rounded-xl border border-hairline bg-surface p-5 transition hover:border-ink-faint/40 hover:bg-raised/40"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <Badge variant="secondary" className="mb-3">{formulation.sourceTable}</Badge>
                  <h2 className="font-semibold text-ink">{formulation.name}</h2>
                  <p className="mt-2 text-sm leading-6 text-ink-muted">{formulation.description}</p>
                </div>
                <ArrowRight size={16} className="mt-1 shrink-0 text-ink-faint group-hover:text-brand" />
              </div>

              <div className="mt-5 grid grid-cols-3 gap-3">
                <Metric
                  label="ME"
                  value={metricValue(profile.energy.metabolizableKcalKg, "kcal/kg")}
                />
                <Metric
                  label="NE"
                  value={metricValue(profile.energy.netKcalKg, "kcal/kg")}
                />
                <Metric
                  label="SID Lys"
                  value={metricValue(profile.sidAminoAcidsPct.lysine, "%")}
                />
              </div>

              <div className="mt-4 text-xs text-ink-faint">
                {formulation.ingredients.length} ingredients · calculated profile
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-hairline bg-raised/30 p-3">
      <div className="text-[11px] uppercase tracking-wide text-ink-faint">{label}</div>
      <div className="mt-1 text-sm font-medium text-ink">{value}</div>
    </div>
  );
}


function metricValue(nutrient: AnalyzedNutrient, unit: string): string {
  const value = Number(nutrient.value.toFixed(3));
  return nutrient.complete ? `${value} ${unit}` : `known ≥ ${value} ${unit}`;
}
