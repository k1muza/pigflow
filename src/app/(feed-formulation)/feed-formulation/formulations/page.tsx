import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PIC_FORMULATION_STRATEGIES } from "@/lib/feed-formulations";
import { feedFormulationStrategyHref } from "@/lib/routes";

const GROUP_LABELS = {
  maximum_performance: "Maximum performance",
  minimum_cost: "Minimum cost",
  maximum_profit: "Maximum profitability",
  seasonal: "Seasonal formulation",
} as const;

export default function FeedFormulationsPage() {
  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Formulations</h1>
          <Badge variant="secondary">{PIC_FORMULATION_STRATEGIES.length} PIC strategies</Badge>
        </div>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-muted">
          Source-backed PIC diet formulation strategies. These describe what a diet is optimized
          for; they are not fixed ingredient recipes.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>PIC formulation strategy library</CardTitle>
          <CardDescription>
            PIC&apos;s Figure A2 demonstrates that different objectives can produce different
            optimal nutrient concentrations for the same pig.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {PIC_FORMULATION_STRATEGIES.map((strategy) => (
            <Link
              key={strategy.id}
              href={feedFormulationStrategyHref(strategy.id)}
              className="group rounded-lg border border-hairline bg-raised/30 p-4 transition hover:border-ink-faint/40 hover:bg-raised"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <Badge variant="secondary" className="mb-3">
                    {GROUP_LABELS[strategy.group]}
                  </Badge>
                  <div className="font-medium text-ink">{strategy.name}</div>
                  <p className="mt-1 text-xs leading-5 text-ink-muted">{strategy.objective}</p>
                </div>
                <ArrowRight
                  size={15}
                  className="mt-1 shrink-0 text-ink-faint transition group-hover:text-brand"
                />
              </div>

              {strategy.exampleSidLysinePct !== undefined ? (
                <div className="mt-4 rounded-md border border-hairline bg-surface/60 px-3 py-2">
                  <div className="text-[11px] uppercase tracking-wide text-ink-faint">
                    PIC example SID Lys
                  </div>
                  <div className="mt-1 text-xl font-semibold tracking-tight text-ink">
                    {strategy.exampleSidLysinePct}%
                  </div>
                  <div className="mt-1 text-[11px] text-ink-faint">
                    11.5–22.5 kg example only
                  </div>
                </div>
              ) : (
                <div className="mt-4 rounded-md border border-hairline bg-surface/60 px-3 py-2 text-xs text-ink-muted">
                  Dynamic formulation based on season, performance and market conditions.
                </div>
              )}
            </Link>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
