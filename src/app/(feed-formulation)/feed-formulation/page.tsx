import Link from "next/link";
import { ArrowRight, BookOpen, CircleCheck, CircleDashed, FlaskConical, Wheat } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { INGREDIENT_LIBRARY } from "@/lib/ingredient-nutrients";
import { PIC_GROWTH_NUTRITION_2021 } from "@/lib/nutrition";
import { PIC_SID_LYSINE_RESPONSE_2021 } from "@/lib/nutrition-response";
import { feedFormulationHref } from "@/lib/routes";

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

      <div className="grid gap-4 md:grid-cols-3">
        <SummaryCard
          label="NRC ingredient library"
          value={INGREDIENT_LIBRARY.ingredients.length.toString()}
          detail="checked-in ingredients"
        />
        <SummaryCard
          label="PIC growth programme"
          value={PIC_GROWTH_NUTRITION_2021.phases.length.toString()}
          detail="nutrition phases and variants"
        />
        <SummaryCard
          label="Response evidence"
          value={PIC_SID_LYSINE_RESPONSE_2021.population.pigs.toLocaleString()}
          detail={`pigs across ${PIC_SID_LYSINE_RESPONSE_2021.population.trials} trials`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <WorkspaceLink
          href={feedFormulationHref("programmes")}
          icon={BookOpen}
          title="Programmes"
          description="See the PIC feeding programmes in the source material and which ones PigFlow has loaded."
          action="Browse programmes"
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
          description="Inspect the nutrient targets and constraints currently loaded from PIC."
          action="Browse nutrients"
        />
      </div>

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
            label="NRC ingredient nutrient analysis"
            detail="Energy, SID amino acids, STTD phosphorus and minerals are available for checked-in ingredients."
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
