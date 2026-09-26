import Link from "next/link";
import { notFound } from "next/navigation";

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
import { analyzeFeedFormulation } from "@/lib/formulation-analysis";
import { FEED_FORMULATIONS, feedFormulationById } from "@/lib/feed-formulations";
import {
  FEED_PROGRAMMES,
  feedProgrammePhaseById,
} from "@/lib/feed-programmes";
import { compareFormulationToPhase } from "@/lib/formulation-requirement-comparison";
import {
  feedFormulationHref,
  feedProgrammePhaseHref,
} from "@/lib/routes";

function requirementKey(programmeId: string, phaseId: string): string {
  return `${programmeId}:${phaseId}`;
}

function parseRequirementKey(value: string | undefined): {
  programmeId: string;
  phaseId: string;
} | undefined {
  if (!value) return undefined;
  const separator = value.indexOf(":");
  if (separator <= 0 || separator === value.length - 1) return undefined;
  return {
    programmeId: value.slice(0, separator),
    phaseId: value.slice(separator + 1),
  };
}

export default async function FeedFormulationPage({
  params,
  searchParams,
}: {
  params: Promise<{ formulationId: string }>;
  searchParams: Promise<{ requirement?: string }>;
}) {
  const { formulationId } = await params;
  const query = await searchParams;
  const formulation = feedFormulationById(formulationId);
  if (!formulation) notFound();

  const calculated = analyzeFeedFormulation(formulation);
  const requestedTarget =
    parseRequirementKey(query.requirement) ??
    (formulation.requirementTarget
      ? {
          programmeId: formulation.requirementTarget.programmeId,
          phaseId: formulation.requirementTarget.phaseId,
        }
      : undefined);

  const selectedProgramme = requestedTarget
    ? FEED_PROGRAMMES.find((programme) => programme.id === requestedTarget.programmeId)
    : undefined;
  const selectedPhase =
    requestedTarget && selectedProgramme
      ? feedProgrammePhaseById(requestedTarget.programmeId, requestedTarget.phaseId)
      : undefined;
  const comparison = selectedPhase
    ? compareFormulationToPhase(formulation, selectedPhase)
    : undefined;
  const selectedKey =
    selectedProgramme && selectedPhase
      ? requirementKey(selectedProgramme.id, selectedPhase.id)
      : "";

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={feedFormulationHref("formulations")}
          className="text-sm font-medium text-brand hover:underline"
        >
          ← Formulations
        </Link>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">{formulation.name}</h1>
          {formulation.sourceTable ? <Badge variant="secondary">{formulation.sourceTable}</Badge> : null}
        </div>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-muted">
          {formulation.description}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Requirement fit</CardTitle>
          <CardDescription>
            Compare PigFlow&apos;s calculated nutrient profile against a Brazilian Tables 2024
            growing-pig requirement phase.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form className="flex flex-col gap-2 md:flex-row md:items-end">
            <label className="flex-1 text-xs font-medium text-ink-muted">
              Requirement phase
              <select
                name="requirement"
                defaultValue={selectedKey}
                className="mt-1 h-10 w-full rounded-md border border-hairline bg-surface px-3 text-sm text-ink"
              >
                <option value="">Select a Brazilian requirement phase</option>
                {FEED_PROGRAMMES.filter((programme) => programme.phases.length > 0).flatMap(
                  (programme) =>
                    programme.phases.map((phase) => (
                      <option
                        key={requirementKey(programme.id, phase.id)}
                        value={requirementKey(programme.id, phase.id)}
                      >
                        {programme.name} — {phase.label}
                      </option>
                    )),
                )}
              </select>
            </label>
            <button
              type="submit"
              className="h-10 rounded-md border border-hairline px-4 text-sm font-medium text-brand hover:bg-raised"
            >
              Compare
            </button>
          </form>

          {comparison && selectedProgramme && selectedPhase ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-ink">
                  {selectedProgramme.name} · {selectedPhase.label}
                </span>
                <Link
                  href={feedProgrammePhaseHref(selectedProgramme.id, selectedPhase.id)}
                  className="text-xs font-medium text-brand hover:underline"
                >
                  Open requirement
                </Link>
              </div>
              <div className="overflow-x-auto rounded-lg border border-hairline">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Requirement</TableHead>
                      <TableHead className="text-right">Formulation</TableHead>
                      <TableHead className="text-right">Brazilian requirement</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {comparison.rows.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell>
                          <div className="font-medium text-ink">{row.label}</div>
                          {row.note ? <div className="text-xs text-ink-faint">{row.note}</div> : null}
                        </TableCell>
                        <TableCell className="text-right font-mono">{row.actual ?? "—"}</TableCell>
                        <TableCell className="text-right font-mono">{row.requirement ?? "—"}</TableCell>
                        <TableCell className="capitalize">{row.status}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-hairline px-4 py-6 text-sm text-ink-muted">
              Select a requirement phase to compare the calculated formulation profile.
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Ingredients</CardTitle>
          <CardDescription>As-fed inclusion percentages stored by PigFlow.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ingredient</TableHead>
                <TableHead className="text-right">Inclusion</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {formulation.ingredients.map((row) => (
                <TableRow key={row.ingredientId}>
                  <TableCell>
                    <div className="font-medium text-ink">{row.sourceName}</div>
                    <div className="text-xs text-ink-faint">{row.ingredientId}</div>
                  </TableCell>
                  <TableCell className="text-right font-mono">{row.inclusionPct}%</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Calculated nutrient profile</CardTitle>
          <CardDescription>
            Calculated from ingredient inclusions and PigFlow&apos;s ingredient nutrient records.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <Metric
            label="ME"
            value={calculated.analysis.energy.metabolizableKcalKg.value}
            unit="kcal/kg"
            complete={calculated.analysis.energy.metabolizableKcalKg.complete}
          />
          <Metric
            label="NE"
            value={calculated.analysis.energy.netKcalKg.value}
            unit="kcal/kg"
            complete={calculated.analysis.energy.netKcalKg.complete}
          />
          <Metric
            label="SID lysine"
            value={calculated.analysis.sidAminoAcidsPct.lysine.value}
            unit="%"
            complete={calculated.analysis.sidAminoAcidsPct.lysine.complete}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({
  label,
  value,
  unit,
  complete,
}: {
  label: string;
  value: number;
  unit: string;
  complete: boolean;
}) {
  const formatted = Number(value.toFixed(4));
  return (
    <div className="rounded-lg border border-hairline bg-raised/30 p-4">
      <div className="text-xs uppercase tracking-wide text-ink-faint">{label}</div>
      <div className="mt-1 font-mono text-sm text-ink">
        {complete ? formatted : `known ≥ ${formatted}`} {unit}
      </div>
    </div>
  );
}

export function generateStaticParams() {
  return FEED_FORMULATIONS.map((formulation) => ({
    formulationId: formulation.id,
  }));
}
