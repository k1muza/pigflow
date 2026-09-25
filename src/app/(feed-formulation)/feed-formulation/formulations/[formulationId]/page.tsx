import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { INGREDIENT_LIBRARY } from "@/lib/ingredient-nutrients";
import {
  PIC_EXAMPLE_FORMULATIONS,
  feedFormulationById,
} from "@/lib/feed-formulations";
import {
  feedFormulationHref,
  feedIngredientHref,
} from "@/lib/routes";

export default async function FeedFormulationPage({
  params,
}: {
  params: Promise<{ formulationId: string }>;
}) {
  const { formulationId } = await params;
  const formulation = feedFormulationById(formulationId);
  if (!formulation) notFound();

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
          <h1 className="text-2xl font-semibold tracking-tight text-ink">{formulation.name}</h1>
          <Badge variant="secondary">{formulation.sourceTable}</Badge>
        </div>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-muted">
          {formulation.description}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Ingredient ratios</CardTitle>
          <CardDescription>
            As-fed inclusion percentages exactly as reported by PIC. PIC reports the ration total
            as {formulation.reportedTotalPct}%; individual printed rows may sum a few hundredths
            above 100% because of source rounding.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-lg border border-hairline">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ingredient</TableHead>
                  <TableHead className="text-right">Inclusion</TableHead>
                  <TableHead className="text-right">kg / tonne</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {formulation.ingredients.map((row) => {
                  const inLibrary = INGREDIENT_LIBRARY.ingredients.some(
                    (ingredient) => ingredient.id === row.ingredientId,
                  );
                  return (
                    <TableRow key={row.ingredientId}>
                      <TableCell>
                        {inLibrary ? (
                          <Link
                            href={feedIngredientHref(row.ingredientId)}
                            className="font-medium text-brand hover:underline"
                          >
                            {row.sourceName}
                          </Link>
                        ) : (
                          <div>
                            <div className="font-medium text-ink">{row.sourceName}</div>
                            <div className="mt-0.5 text-[11px] text-ink-faint">
                              Nutrient profile not loaded into the ingredient library yet
                            </div>
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono">{row.inclusionPct.toFixed(2)}%</TableCell>
                      <TableCell className="text-right font-mono">
                        {(row.inclusionPct * 10).toFixed(1)} kg
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Resulting nutritional profile</CardTitle>
          <CardDescription>
            Values reported by PIC for this exact ration. These are source results, not recomputed
            from PigFlow&apos;s partial ingredient library.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {formulation.nutrientProfiles.map((profile) => (
            <div key={profile.basis} className="rounded-lg border border-hairline p-4">
              <div className="mb-3 text-sm font-medium text-ink">{profile.basis}</div>
              <div className="grid gap-3 sm:grid-cols-3">
                <ProfileMetric
                  label="Metabolizable energy"
                  value={`${profile.metabolizableEnergyKcalKg.toLocaleString()} kcal/kg`}
                />
                <ProfileMetric
                  label="Net energy"
                  value={`${profile.netEnergyKcalKg.toLocaleString()} kcal/kg`}
                />
                <ProfileMetric label="SID lysine" value={`${profile.sidLysinePct}%`} />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Source</CardTitle>
        </CardHeader>
        <CardContent className="text-sm leading-6 text-ink-muted">
          PIC Nutrition and Feeding Guidelines · {formulation.sourceTable} · printed page{" "}
          {formulation.sourcePage}. The source uses {formulation.ingredientDatabase} ingredient
          values for the primary profile.
          <div className="mt-3">
            <a
              href={formulation.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-brand underline underline-offset-4"
            >
              Open PIC source
            </a>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ProfileMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-raised/40 p-3">
      <div className="text-[11px] uppercase tracking-wide text-ink-faint">{label}</div>
      <div className="mt-1 font-mono text-sm font-medium text-ink">{value}</div>
    </div>
  );
}

export function generateStaticParams() {
  return PIC_EXAMPLE_FORMULATIONS.map((formulation) => ({
    formulationId: formulation.id,
  }));
}
