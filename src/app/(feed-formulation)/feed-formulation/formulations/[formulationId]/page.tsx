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
import type { AnalyzedNutrient } from "@/lib/diet-formula";
import { analyzeFeedFormulation } from "@/lib/formulation-analysis";
import {
  PIC_EXAMPLE_FORMULATIONS,
  feedFormulationById,
} from "@/lib/feed-formulations";
import {
  FEED_PROGRAMMES,
  feedProgrammePhaseById,
} from "@/lib/feed-programmes";
import { compareFormulationToPhase } from "@/lib/formulation-requirement-comparison";
import {
  feedFormulationHref,
  feedIngredientHref,
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
  const analysis = calculated.analysis;

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
          <CardTitle>Requirement fit</CardTitle>
          <CardDescription>
            Compare PigFlow&apos;s calculated nutrient profile and the exact published ingredient
            inclusions against a loaded PIC requirement phase.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="rounded-lg border border-hairline bg-raised/30 p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-ink-faint">
              Requirement used to formulate
            </div>
            {formulation.requirementTarget ? (
              <div className="mt-2 text-sm text-ink">
                {FEED_PROGRAMMES.find(
                  (programme) => programme.id === formulation.requirementTarget?.programmeId,
                )?.name ?? formulation.requirementTarget.programmeId}
                {" · "}
                {feedProgrammePhaseById(
                  formulation.requirementTarget.programmeId,
                  formulation.requirementTarget.phaseId,
                )?.label ?? formulation.requirementTarget.phaseId}
              </div>
            ) : (
              <div className="mt-2 text-sm text-ink-muted">
                PIC Tables B1/B2 do not state a production phase that these demonstration diets
                were formulated to satisfy. Select a phase below for an explicit comparison.
              </div>
            )}
          </div>

          <form method="get" className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="min-w-0 flex-1 text-sm">
              <span className="mb-1.5 block text-xs font-medium text-ink-muted">
                Compare against
              </span>
              <select
                name="requirement"
                defaultValue={selectedKey}
                className="h-10 w-full rounded-md border border-hairline bg-surface px-3 text-sm text-ink"
              >
                <option value="">Select a PIC requirement phase</option>
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
              className="h-10 rounded-md border border-hairline px-4 text-sm font-medium text-ink transition hover:bg-raised"
            >
              Compare
            </button>
          </form>

          {comparison && selectedProgramme && selectedPhase ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">
                  {comparison.status === "pass"
                    ? "Pass"
                    : comparison.status === "fail"
                      ? "Does not meet"
                      : "Partially verifiable"}
                </Badge>
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

              <div className="grid gap-3 sm:grid-cols-3">
                <ProfileMetric
                  label="Quantified checks"
                  value={comparison.quantifiedCount.toString()}
                />
                <ProfileMetric
                  label="Incomplete checks"
                  value={comparison.incompleteCount.toString()}
                />
                <ProfileMetric label="Profile basis" value={comparison.profileBasis} />
              </div>

              <div className="overflow-x-auto rounded-lg border border-hairline">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Requirement</TableHead>
                      <TableHead className="text-right">Formulation</TableHead>
                      <TableHead className="text-right">PIC requirement</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {comparison.rows.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell>
                          <div className="font-medium text-ink">{row.label}</div>
                          {row.note ? (
                            <div className="mt-1 max-w-xl text-xs leading-5 text-ink-faint">
                              {row.note}
                            </div>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {row.actual ?? "—"}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {row.requirement ?? "—"}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">
                            {row.status === "pass"
                              ? "Pass"
                              : row.status === "fail"
                                ? "Fail"
                                : "Incomplete"}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {comparison.status === "incomplete" ? (
                <div className="rounded-lg border border-hairline bg-raised/30 px-4 py-3 text-xs leading-5 text-ink-muted">
                  “Partially verifiable” means some ingredient nutrient records are missing values
                  needed for one or more checks. PigFlow shows the known subtotal and the missing
                  ingredient IDs instead of substituting PIC&apos;s reported formulation outputs.
                </div>
              ) : null}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-hairline px-4 py-6 text-sm text-ink-muted">
              Select a requirement phase to see how this formulation measures against it.
            </div>
          )}
        </CardContent>
      </Card>

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
                  <TableHead className="text-right">Normalized kg / tonne</TableHead>
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
                        {(row.inclusionPct * calculated.normalizationFactor * 10).toFixed(1)} kg
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
          <CardTitle>Calculated nutritional profile</CardTitle>
          <CardDescription>
            Calculated from the formulation&apos;s ingredient ratios and PigFlow&apos;s ingredient
            nutrient records. PIC&apos;s reported ME, NE and SID lysine outputs are not used in
            this calculation.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="rounded-lg border border-hairline bg-raised/30 px-4 py-3 text-xs leading-5 text-ink-muted">
            PIC&apos;s printed rows sum to {calculated.sourceInclusionTotalPct.toFixed(2)}%.
            PigFlow preserves those displayed ratios, then normalizes them by{" "}
            {calculated.normalizationFactor.toFixed(6)} for nutrient calculation so the analyzed
            ration is exactly 100%.
          </div>

          <CalculatedNutrientSection
            title="Energy & protein"
            rows={[
              ["Digestible energy", analysis.energy.digestibleKcalKg, "kcal/kg"],
              ["Metabolizable energy", analysis.energy.metabolizableKcalKg, "kcal/kg"],
              ["Net energy", analysis.energy.netKcalKg, "kcal/kg"],
              ["Crude protein", analysis.crudeProteinPct, "%"],
            ]}
          />

          <CalculatedNutrientSection
            title="SID amino acids"
            rows={[
              ["SID lysine", analysis.sidAminoAcidsPct.lysine, "%"],
              ["SID methionine + cysteine", analysis.sidAminoAcidsPct.methionineCysteine, "%"],
              ["SID threonine", analysis.sidAminoAcidsPct.threonine, "%"],
              ["SID tryptophan", analysis.sidAminoAcidsPct.tryptophan, "%"],
              ["SID valine", analysis.sidAminoAcidsPct.valine, "%"],
              ["SID isoleucine", analysis.sidAminoAcidsPct.isoleucine, "%"],
              ["SID leucine", analysis.sidAminoAcidsPct.leucine, "%"],
              ["SID histidine", analysis.sidAminoAcidsPct.histidine, "%"],
              [
                "SID phenylalanine + tyrosine",
                analysis.sidAminoAcidsPct.phenylalanineTyrosine,
                "%",
              ],
            ]}
          />

          <CalculatedNutrientSection
            title="Macro minerals"
            rows={[
              ["Calcium", analysis.minerals.calciumPct, "%"],
              ["Total phosphorus", analysis.minerals.totalPhosphorusPct, "%"],
              ["Available phosphorus", analysis.minerals.availablePhosphorusPct, "%"],
              ["STTD phosphorus", analysis.minerals.sttdPhosphorusPct, "%"],
              ["Sodium", analysis.minerals.sodiumPct, "%"],
              ["Chloride", analysis.minerals.chloridePct, "%"],
            ]}
          />

          <CalculatedNutrientSection
            title="Trace minerals"
            rows={[
              ["Zinc", analysis.traceMineralsPpm.zinc, "ppm"],
              ["Iron", analysis.traceMineralsPpm.iron, "ppm"],
              ["Manganese", analysis.traceMineralsPpm.manganese, "ppm"],
              ["Copper", analysis.traceMineralsPpm.copper, "ppm"],
              ["Iodine", analysis.traceMineralsPpm.iodine, "ppm"],
              ["Selenium", analysis.traceMineralsPpm.selenium, "ppm"],
            ]}
          />

          <CalculatedNutrientSection
            title="Vitamins"
            rows={[
              ["Vitamin A", analysis.vitamins.vitaminAIuKg, "IU/kg"],
              ["Vitamin D", analysis.vitamins.vitaminDIuKg, "IU/kg"],
              ["Vitamin E", analysis.vitamins.vitaminEIuKg, "IU/kg"],
              ["Vitamin K", analysis.vitamins.vitaminKMgKg, "mg/kg"],
              ["Niacin", analysis.vitamins.niacinMgKg, "mg/kg"],
              ["Riboflavin", analysis.vitamins.riboflavinMgKg, "mg/kg"],
              ["Pantothenic acid", analysis.vitamins.pantothenicAcidMgKg, "mg/kg"],
              ["Vitamin B12", analysis.vitamins.vitaminB12McgKg, "mcg/kg"],
              ["Total choline", analysis.vitamins.totalCholineMgKg, "mg/kg"],
            ]}
          />

          <div className="rounded-lg border border-hairline px-4 py-3 text-xs leading-5 text-ink-muted">
            <span className="font-medium text-ink">Ingredient nutrient sources:</span>{" "}
            {calculated.nutrientDataSources.join(" · ")}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Source</CardTitle>
        </CardHeader>
        <CardContent className="text-sm leading-6 text-ink-muted">
          PIC Nutrition and Feeding Guidelines · {formulation.sourceTable} · printed page{" "}
          {formulation.sourcePage}. PigFlow copies the published ingredient inclusion ratios from
          this source; resulting nutrient values are calculated from the ingredient library.
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

function CalculatedNutrientSection({
  title,
  rows,
}: {
  title: string;
  rows: readonly [string, AnalyzedNutrient, string][];
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-hairline">
      <div className="border-b border-hairline bg-raised/30 px-4 py-3 text-sm font-medium text-ink">
        {title}
      </div>
      <Table>
        <TableBody>
          {rows.map(([label, nutrient, unit]) => (
            <TableRow key={label}>
              <TableCell className="font-medium text-ink">{label}</TableCell>
              <TableCell className="text-right font-mono">
                {nutrient.complete
                  ? `${Number(nutrient.value.toFixed(4))} ${unit}`
                  : `known ≥ ${Number(nutrient.value.toFixed(4))} ${unit}`}
              </TableCell>
              <TableCell className="w-32 text-right">
                <Badge variant="secondary">
                  {nutrient.complete ? "Calculated" : "Incomplete"}
                </Badge>
              </TableCell>
              <TableCell className="max-w-sm text-xs text-ink-faint">
                {nutrient.complete
                  ? "All ingredient contributions known"
                  : `Missing: ${nutrient.missingIngredientIds.join(", ")}`}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
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
