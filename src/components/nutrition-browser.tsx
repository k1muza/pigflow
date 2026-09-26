"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import {
  BRAZILIAN_2024_HIGH_GROWTH_NUTRITION,
  BRAZILIAN_2024_STANDARD_GROWTH_NUTRITION,
  type NutritionPerformance,
  type NutritionPhase,
} from "@/lib/nutrition";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { usePlanner } from "@/components/planner-shell";
import { INGREDIENT_LIBRARY } from "@/lib/ingredient-nutrients";
import type { PlannerConfig } from "@/lib/config";
import { feedFormulationHref } from "@/lib/routes";

type NutrientRow = {
  nutrient: string;
  value: string;
  group: "Energy & protein" | "SID amino acids" | "Minerals";
};

function pct(value: number | undefined): string {
  return value === undefined ? "—" : `${value}%`;
}

function numberOrDash(value: number | undefined, unit: string): string {
  return value === undefined ? "—" : `${value} ${unit}`;
}

function rowsFor(phase: NutritionPhase): NutrientRow[] {
  const r = phase.requirements;
  const sid = r.sidAminoAcidsPct;

  return [
    { group: "Energy & protein", nutrient: "Metabolizable energy", value: numberOrDash(r.metabolizableEnergyKcalKg, "kcal/kg") },
    { group: "Energy & protein", nutrient: "Net energy", value: numberOrDash(r.netEnergyKcalKg, "kcal/kg") },
    { group: "Energy & protein", nutrient: "Crude protein", value: pct(r.crudeProteinPct) },
    { group: "Energy & protein", nutrient: "Digestible protein", value: pct(r.digestibleProteinPct) },
    { group: "SID amino acids", nutrient: "Lysine", value: pct(sid.lysine) },
    { group: "SID amino acids", nutrient: "Methionine + cysteine", value: pct(sid.methionineCysteine) },
    { group: "SID amino acids", nutrient: "Threonine", value: pct(sid.threonine) },
    { group: "SID amino acids", nutrient: "Tryptophan", value: pct(sid.tryptophan) },
    { group: "SID amino acids", nutrient: "Valine", value: pct(sid.valine) },
    { group: "SID amino acids", nutrient: "Isoleucine", value: pct(sid.isoleucine) },
    { group: "SID amino acids", nutrient: "Leucine", value: pct(sid.leucine) },
    { group: "SID amino acids", nutrient: "Histidine", value: pct(sid.histidine) },
    { group: "SID amino acids", nutrient: "Phenylalanine + tyrosine", value: pct(sid.phenylalanineTyrosine) },
    { group: "Minerals", nutrient: "Calcium", value: pct(r.minerals.calciumPct) },
    { group: "Minerals", nutrient: "Standardized digestible phosphorus", value: pct(r.minerals.sttdPhosphorusPct) },
    { group: "Minerals", nutrient: "Available phosphorus", value: pct(r.minerals.availablePhosphorusPct) },
    { group: "Minerals", nutrient: "Potassium", value: pct(r.potassiumPct) },
    { group: "Minerals", nutrient: "Sodium", value: pct(r.minerals.sodiumPct) },
    { group: "Minerals", nutrient: "Chlorine", value: pct(r.minerals.chloridePct) },
    { group: "Minerals", nutrient: "Linoleic acid", value: pct(r.linoleicAcidPct) },
  ];
}

const groups: NutrientRow["group"][] = [
  "Energy & protein",
  "SID amino acids",
  "Minerals",
];

export function NutritionBrowser() {
  const { config, update } = usePlanner();
  const [performance, setPerformance] = useState<NutritionPerformance>("standard");
  const programme =
    performance === "high"
      ? BRAZILIAN_2024_HIGH_GROWTH_NUTRITION
      : BRAZILIAN_2024_STANDARD_GROWTH_NUTRITION;
  const [phaseId, setPhaseId] = useState(programme.phases[0].id);
  const phase =
    programme.phases.find((item) => item.id === phaseId) ?? programme.phases[0];
  const rows = useMemo(() => rowsFor(phase), [phase]);

  function changePerformance(value: NutritionPerformance) {
    const nextProgramme =
      value === "high"
        ? BRAZILIAN_2024_HIGH_GROWTH_NUTRITION
        : BRAZILIAN_2024_STANDARD_GROWTH_NUTRITION;
    setPerformance(value);
    setPhaseId(nextProgramme.phases[0].id);
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Nutrition</h1>
          <Badge variant="secondary">Brazilian Tables 2024</Badge>
        </div>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-muted">
          Browse PigFlow&apos;s source-level animal nutrient requirements. The values below are
          formulation constraints from Chapter 5, not a feed recipe or an individual pig&apos;s
          daily feed allowance.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Formulation objective</CardTitle>
          <CardDescription>
            The animal requirements stay fixed. This controls how PigFlow can rank biologically
            valid diets once a formulation solver and a supported performance-response model are connected.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <label htmlFor="formulation-objective" className="text-xs font-medium text-ink-muted">
              Optimize for
            </label>
            <Select
              value={config.nutrition.formulationObjective}
              onValueChange={(value) =>
                update(
                  "nutrition",
                  "formulationObjective",
                  value as PlannerConfig["nutrition"]["formulationObjective"],
                )
              }
            >
              <SelectTrigger id="formulation-objective" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="max_profit">Maximum profit</SelectItem>
                <SelectItem value="min_feed_cost_per_kg_gain">Minimum feed cost / kg gain</SelectItem>
                <SelectItem value="max_performance">Maximum performance</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {config.nutrition.formulationObjective === "max_performance" ? (
            <div className="space-y-2">
              <label htmlFor="performance-metric" className="text-xs font-medium text-ink-muted">
                Performance measure
              </label>
              <Select
                value={config.nutrition.performanceMetric}
                onValueChange={(value) =>
                  update(
                    "nutrition",
                    "performanceMetric",
                    value as PlannerConfig["nutrition"]["performanceMetric"],
                  )
                }
              >
                <SelectTrigger id="performance-metric" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="adg">Average daily gain</SelectItem>
                  <SelectItem value="feed_efficiency">Feed efficiency</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="space-y-2">
              <label htmlFor="facility-cost" className="text-xs font-medium text-ink-muted">
                Facility cost / pig / day ({config.project.currency})
              </label>
              <Input
                id="facility-cost"
                type="number"
                min={0}
                step="0.01"
                value={config.nutrition.facilityCostPerPigDay}
                onChange={(event) =>
                  update(
                    "nutrition",
                    "facilityCostPerPigDay",
                    Math.max(0, Number(event.target.value) || 0),
                  )
                }
              />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Feed formulation workspace</CardTitle>
          <CardDescription>
            Ingredient composition and formulation tooling live outside individual farm plans.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link
            href={feedFormulationHref()}
            className="inline-flex rounded-lg border border-hairline px-3 py-2 text-sm font-medium text-brand transition hover:bg-raised"
          >
            Open feed formulation
          </Link>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Ingredient prices</CardTitle>
          <CardDescription>
            Farm prices are separate from the imported ingredient nutrient composition.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ingredient</TableHead>
                <TableHead className="w-44 text-right">{config.project.currency} / kg</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {INGREDIENT_LIBRARY.ingredients.map((ingredient) => {
                const current = config.nutrition.ingredientPrices.find(
                  (price) => price.ingredientId === ingredient.id,
                );
                return (
                  <TableRow key={ingredient.id}>
                    <TableCell>
                      <div className="font-medium text-ink">{ingredient.name}</div>
                      <div className="text-xs text-ink-faint">{ingredient.category.replaceAll("_", " ")}</div>
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        className="text-right"
                        value={current?.pricePerKg ?? ""}
                        placeholder="—"
                        onChange={(event) => {
                          const raw = event.target.value;
                          const without = config.nutrition.ingredientPrices.filter(
                            (price) => price.ingredientId !== ingredient.id,
                          );
                          const ingredientPrices =
                            raw === ""
                              ? without
                              : [
                                  ...without,
                                  {
                                    ingredientId: ingredient.id,
                                    pricePerKg: Math.max(0, Number(raw) || 0),
                                  },
                                ];
                          update("nutrition", "ingredientPrices", ingredientPrices);
                        }}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{programme.name}</CardTitle>
          <CardDescription>
            {programme.source} · {programme.sourceVersion}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              <label htmlFor="nutrition-performance" className="text-xs font-medium text-ink-muted">
                Performance programme
              </label>
              <Select
                value={performance}
                onValueChange={(value) => changePerformance(value as NutritionPerformance)}
              >
                <SelectTrigger id="nutrition-performance" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="standard">Standard-performance mixed sex</SelectItem>
                  <SelectItem value="high">High-performance mixed sex</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label htmlFor="nutrition-phase" className="text-xs font-medium text-ink-muted">
                Source phase
              </label>
              <Select value={phase.id} onValueChange={setPhaseId}>
                <SelectTrigger id="nutrition-phase" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {programme.phases.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 rounded-lg border border-hairline bg-raised/40 p-4 md:grid-cols-4">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-ink-faint">Published range</p>
              <p className="mt-1 text-sm font-medium text-ink">{phase.sourceWeightRange}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-ink-faint">Stage</p>
              <p className="mt-1 text-sm font-medium capitalize text-ink">{phase.phaseClass}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-ink-faint">Source table</p>
              <p className="mt-1 text-sm font-medium text-ink">Table {phase.sourceTable}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-ink-faint">Printed page</p>
              <p className="mt-1 text-sm font-medium text-ink">{phase.sourcePage}</p>
            </div>
          </div>

          {phase.sourceMinWeightKg !== phase.lookupMinWeightKg ||
          phase.sourceMaxWeightKg !== phase.lookupMaxWeightKg ? (
            <div className="rounded-lg border border-warning/30 bg-warning/5 px-4 py-3 text-xs leading-5 text-ink-muted">
              The Brazilian source ranges overlap or leave a small transition gap when interpreted
              only by liveweight. PigFlow preserves the published range above and uses an operational
              lookup boundary of {phase.lookupMinWeightKg}–{phase.lookupMaxWeightKg} kg.
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        {groups.map((group) => {
          const groupRows = rows.filter((row) => row.group === group);
          return (
            <Card key={group}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{group}</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nutrient</TableHead>
                      <TableHead className="text-right">Requirement</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {groupRows.map((row) => (
                      <TableRow key={row.nutrient}>
                        <TableCell className="text-sm text-ink-muted">{row.nutrient}</TableCell>
                        <TableCell className="text-right font-mono text-sm text-ink">{row.value}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Source & interpretation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm leading-6 text-ink-muted">
          <p>{programme.source}, {programme.sourceVersion}. {programme.sourceSections.join(" · ")}.</p>
          <p>
            Chapter 5 provides direct dietary concentrations. PigFlow therefore stores and evaluates
            those concentrations directly; it does not convert them through an unrelated genetic-company
            requirement model.
          </p>
          <p>
            Vitamin and trace-mineral supplementation will be loaded separately from Chapter 7 because
            the source describes those values as supplementation suggestions rather than nutritional requirements.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
