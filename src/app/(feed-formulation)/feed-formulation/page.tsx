import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  CircleCheck,
  CircleDashed,
  FlaskConical,
  Layers3,
  Wheat,
} from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { INGREDIENT_LIBRARY } from "@/lib/ingredient-nutrients";
import { PIC_GROWTH_NUTRITION_2021 } from "@/lib/nutrition";
import { FEED_PROGRAMMES } from "@/lib/feed-programmes";
import { PIC_EXAMPLE_FORMULATIONS } from "@/lib/feed-formulations";
import { analyzeFeedFormulation } from "@/lib/formulation-analysis";
import type { AnalyzedNutrient } from "@/lib/diet-formula";
import { PIC_SID_LYSINE_RESPONSE_2021 } from "@/lib/nutrition-response";
import { feedFormulationHref, feedFormulationStrategyHref } from "@/lib/routes";

export default function FeedFormulationDashboard() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-ink">Feed formulation</h1>
            <Badge variant="secondary">App workspace</Badge>
          </div>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-muted">
            Build feed decisions from source-backed ingredient composition and pig nutrient
            requirements independently of any one farm plan.
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          label="NRC ingredient library"
          value={INGREDIENT_LIBRARY.ingredients.length.toString()}
          detail="checked-in ingredients"
        />
        <SummaryCard
          label="PIC programmes"
          value={FEED_PROGRAMMES.length.toString()}
          detail={`${FEED_PROGRAMMES.filter((programme) => programme.status === "loaded").length} loaded · ${PIC_GROWTH_NUTRITION_2021.phases.length} phases`}
        />
        <SummaryCard
          label="PIC formulations"
          value={PIC_EXAMPLE_FORMULATIONS.length.toString()}
          detail="source-backed example rations"
        />
        <SummaryCard
          label="Response evidence"
          value={PIC_SID_LYSINE_RESPONSE_2021.population.pigs.toLocaleString()}
          detail={`pigs across ${PIC_SID_LYSINE_RESPONSE_2021.population.trials} trials`}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <WorkspaceLink
          href={feedFormulationHref("programmes")}
          icon={BookOpen}
          title="Programmes"
          description="See the PIC feeding programmes in the source material and which ones PigFlow has loaded."
          action="Browse programmes"
        />
        <WorkspaceLink
          href={feedFormulationHref("formulations")}
          icon={Layers3}
          title="Formulations"
          description="Browse PIC example ingredient ratios with nutrient profiles calculated from the ingredient library."
          action="Browse formulations"
        />
        <WorkspaceLink
          href={feedFormulationHref("ingredients")}
          icon={Wheat}
          title="Ingredients"
          description="Browse NRC energy, protein, SID amino acids, minerals and source provenance ingredient by ingredient."
          action="Browse ingredients"
        />
        <WorkspaceLink
          href={feedFormulationHref("nutrients")}
          icon={FlaskConical}
          title="Nutrients"
          description="Browse the nutrient concepts used across programmes, ingredients and diet validation."
          action="Browse nutrients"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Featured PIC formulations</CardTitle>
          <CardDescription>
            PIC Tables B1/B2 provide the ingredient ratios; PigFlow calculates the resulting
            nutrient profile from the ingredient library.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {PIC_EXAMPLE_FORMULATIONS.filter((formulation) => formulation.featured).map((formulation) => {
            const profile = analyzeFeedFormulation(formulation).analysis;
            return (
              <Link
                key={formulation.id}
                href={feedFormulationStrategyHref(formulation.id)}
                className="rounded-lg border border-hairline bg-raised/30 p-4 transition hover:border-ink-faint/40 hover:bg-raised"
              >
                <div className="text-sm font-medium text-ink">{formulation.name}</div>
                <div className="mt-1 text-xs leading-5 text-ink-muted">
                  {formulation.ingredients.length} ingredients · {formulation.sourceTable}
                </div>
                <div className="mt-3 text-lg font-semibold text-ink">
                  {dashboardMetric(profile.energy.metabolizableKcalKg)} ME
                </div>
                <div className="mt-1 text-xs text-ink-faint">
                  {dashboardMetric(profile.energy.netKcalKg)} NE ·{" "}
                  {dashboardMetric(profile.sidAminoAcidsPct.lysine)}% SID Lys
                </div>
              </Link>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Formulation engine status</CardTitle>
          <CardDescription>
            What the standalone workspace can support without overstating the science.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <StatusRow
            ready
            label="Ingredient-weighted nutrient analysis"
            detail="Formulation profiles are calculated from ingredient records; missing ingredient values remain explicitly incomplete."
          />
          <StatusRow
            ready
            label="PIC diet validation"
            detail="Diet checks distinguish valid, invalid and incomplete nutrient coverage."
          />
          <StatusRow
            label="Least-cost formulation solver"
            detail="The constraint/data layer is ready; the LP solver has not yet been connected."
          />
          <StatusRow
            label="Maximum-profit formulation"
            detail="Awaiting a sourced marginal ADG/FCR response model; PigFlow will not invent those coefficients."
          />
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="text-xs font-medium uppercase tracking-wide text-ink-faint">{label}</div>
        <div className="mt-2 text-3xl font-semibold tracking-tight text-ink">{value}</div>
        <div className="mt-1 text-sm text-ink-muted">{detail}</div>
      </CardContent>
    </Card>
  );
}

function WorkspaceLink({
  href,
  icon: Icon,
  title,
  description,
  action,
}: {
  href: string;
  icon: typeof Wheat;
  title: string;
  description: string;
  action: string;
}) {
  return (
    <Card className="transition hover:border-ink-faint/40">
      <CardHeader>
        <div className="mb-2 flex size-9 items-center justify-center rounded-lg bg-raised">
          <Icon size={18} strokeWidth={1.75} />
        </div>
        <CardTitle>{title}</CardTitle>
        <CardDescription className="leading-6">{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <Link href={href} className="inline-flex items-center gap-2 text-sm font-medium text-brand hover:underline">
          {action}
          <ArrowRight size={14} />
        </Link>
      </CardContent>
    </Card>
  );
}

function StatusRow({
  ready = false,
  label,
  detail,
}: {
  ready?: boolean;
  label: string;
  detail: string;
}) {
  const Icon = ready ? CircleCheck : CircleDashed;
  return (
    <div className="flex gap-3 rounded-lg border border-hairline bg-raised/30 p-4">
      <Icon
        className={ready ? "mt-0.5 size-4 shrink-0 text-brand" : "mt-0.5 size-4 shrink-0 text-ink-faint"}
        strokeWidth={1.75}
      />
      <div>
        <div className="text-sm font-medium text-ink">{label}</div>
        <div className="mt-1 text-xs leading-5 text-ink-muted">{detail}</div>
      </div>
    </div>
  );
}


function dashboardMetric(nutrient: AnalyzedNutrient): string {
  const value = Number(nutrient.value.toFixed(3));
  return nutrient.complete ? value.toLocaleString() : `≥${value.toLocaleString()}`;
}
