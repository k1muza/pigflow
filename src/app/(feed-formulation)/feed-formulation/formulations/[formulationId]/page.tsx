import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CircleCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  PIC_FORMULATION_STRATEGIES,
  PIC_GROW_FINISH_FORMULATION_STEPS,
  feedFormulationStrategyById,
} from "@/lib/feed-formulations";
import { feedFormulationHref } from "@/lib/routes";

const GROUP_LABELS = {
  maximum_performance: "Maximum performance",
  minimum_cost: "Minimum cost",
  maximum_profit: "Maximum profitability",
  seasonal: "Seasonal formulation",
} as const;

export default async function FeedFormulationStrategyPage({
  params,
}: {
  params: Promise<{ formulationId: string }>;
}) {
  const { formulationId } = await params;
  const strategy = feedFormulationStrategyById(formulationId);
  if (!strategy) notFound();

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={feedFormulationHref("formulations")}
          className="mb-4 inline-flex items-center gap-2 text-sm font-medium text-brand hover:underline"
        >
          <ArrowLeft size={14} />
          Formulations
        </Link>

        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">{strategy.name}</h1>
          <Badge variant="secondary">{GROUP_LABELS[strategy.group]}</Badge>
        </div>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-muted">{strategy.objective}</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>How PIC frames it</CardTitle>
            <CardDescription>{strategy.sourceSection}</CardDescription>
          </CardHeader>
          <CardContent className="text-sm leading-6 text-ink-muted">
            {strategy.description}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>PIC example</CardTitle>
            <CardDescription>
              Source illustration, not a universal nutrient specification
            </CardDescription>
          </CardHeader>
          <CardContent>
            {strategy.exampleSidLysinePct !== undefined ? (
              <>
                <div className="text-3xl font-semibold tracking-tight text-ink">
                  {strategy.exampleSidLysinePct}%
                </div>
                <div className="mt-1 text-sm font-medium text-ink-muted">SID lysine</div>
                <p className="mt-3 text-xs leading-5 text-ink-faint">
                  {strategy.exampleContext}
                </p>
              </>
            ) : (
              <p className="text-sm leading-6 text-ink-muted">
                PIC does not give one fixed nutrient concentration for seasonal formulation.
                The strategy responds to seasonal performance and market conditions.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>PIC grow-finish formulation workflow</CardTitle>
          <CardDescription>
            The formulation objective changes the optimization target; the underlying formulation
            process still follows PIC&apos;s nutrient-setting sequence.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {PIC_GROW_FINISH_FORMULATION_STEPS.map((step, index) => (
            <div key={step} className="flex gap-3 rounded-lg border border-hairline bg-raised/30 p-4">
              <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-semibold text-brand">
                {index + 1}
              </div>
              <div className="pt-1 text-sm text-ink">{step}</div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What PigFlow can do with this</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Capability ready label="Validate a candidate diet against PIC nutrient requirements." />
          <Capability ready label="Calculate ingredient-based diet cost when local prices are supplied." />
          <Capability
            label="Generate the least-cost valid ingredient recipe automatically once the LP solver is connected."
          />
          <Capability
            label="Reproduce PIC maximum-profit nutrient optimisation only when a sourced marginal ADG/FCR response model is available."
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6 text-sm leading-6 text-ink-muted">
          <strong className="text-ink">Source boundary:</strong> PIC publishes the formulation
          objective and nutrient-optimization examples shown here, but not a universal maize/soybean
          ingredient recipe. Actual ingredient proportions depend on nutrient composition, local
          prices, constraints and the selected objective.
          <div className="mt-3">
            <a
              href={strategy.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-brand underline underline-offset-4"
            >
              Open PIC Nutrition and Feeding Guidelines
            </a>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Capability({ ready = false, label }: { ready?: boolean; label: string }) {
  return (
    <div className="flex gap-3 text-sm text-ink-muted">
      <CircleCheck
        size={15}
        className={ready ? "mt-0.5 shrink-0 text-brand" : "mt-0.5 shrink-0 text-ink-faint"}
      />
      <span>{label}</span>
    </div>
  );
}

export function generateStaticParams() {
  return PIC_FORMULATION_STRATEGIES.map((strategy) => ({
    formulationId: strategy.id,
  }));
}
