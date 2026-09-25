"use client";

import { useMemo, useState } from "react";

import {
  PIC_GROWTH_NUTRITION_2021,
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

const programme = PIC_GROWTH_NUTRITION_2021;

type NutrientRow = {
  nutrient: string;
  value: string;
  group: "Energy & protein" | "Amino acids" | "Minerals" | "Trace minerals" | "Vitamins" | "Practical limits";
};

function pct(value: number | undefined): string {
  return value === undefined ? "—" : `${value}%`;
}

function numberOrDash(value: number | undefined, unit: string): string {
  return value === undefined ? "—" : `${value} ${unit}`;
}

function range(value: { min: number; max: number } | undefined, unit = "%"): string {
  return value ? `${value.min}–${value.max}${unit}` : "—";
}

function rowsFor(phase: NutritionPhase): NutrientRow[] {
  const r = phase.requirements;
  const rows: NutrientRow[] = [];

  const add = (group: NutrientRow["group"], nutrient: string, value: string) => {
    if (value !== "—") rows.push({ group, nutrient, value });
  };

  add("Energy & protein", "Net energy", numberOrDash(r.netEnergyKcalKg, "kcal/kg"));
  add("Energy & protein", "Metabolizable energy", numberOrDash(r.metabolizableEnergyKcalKg, "kcal/kg"));
  add("Energy & protein", "SID lysine", pct(r.sidLysinePct));
  add("Energy & protein", "SID lysine / NE", numberOrDash(r.sidLysineGPerMcalNE, "g/Mcal"));
  add("Energy & protein", "SID lysine / ME", numberOrDash(r.sidLysineGPerMcalME, "g/Mcal"));
  add("Energy & protein", "Minimum crude protein", pct(r.practical.crudeProteinMinPct));

  add("Amino acids", "SID Met + Cys : Lys", `${r.aminoAcids.methionineCysteineToLysPct}%`);
  add("Amino acids", "SID Thr : Lys", `${r.aminoAcids.threonineToLysPct}%`);
  add("Amino acids", "SID Trp : Lys", `${r.aminoAcids.tryptophanToLysPct}%`);
  add("Amino acids", "SID Val : Lys", `${r.aminoAcids.valineToLysPct}%`);
  add("Amino acids", "SID Ile : Lys", `${r.aminoAcids.isoleucineToLysPct}%`);
  add("Amino acids", "SID Leu : Lys", `${r.aminoAcids.leucineToLysPct}%`);
  add("Amino acids", "SID His : Lys", `${r.aminoAcids.histidineToLysPct}%`);
  add("Amino acids", "SID Phe + Tyr : Lys", `${r.aminoAcids.phenylalanineTyrosineToLysPct}%`);

  add("Minerals", "Calcium", pct(r.minerals.calciumPct));
  add("Minerals", "STTD phosphorus", pct(r.minerals.sttdPhosphorusPct));
  add("Minerals", "Available phosphorus", pct(r.minerals.availablePhosphorusPct));
  add("Minerals", "STTD phosphorus / NE", numberOrDash(r.minerals.sttdPhosphorusGPerMcalNE, "g/Mcal"));
  add("Minerals", "STTD phosphorus / ME", numberOrDash(r.minerals.sttdPhosphorusGPerMcalME, "g/Mcal"));
  add("Minerals", "Available phosphorus / NE", numberOrDash(r.minerals.availablePhosphorusGPerMcalNE, "g/Mcal"));
  add("Minerals", "Available phosphorus / ME", numberOrDash(r.minerals.availablePhosphorusGPerMcalME, "g/Mcal"));
  add("Minerals", "Analyzed Ca:P", range(r.minerals.analyzedCalciumToPhosphorus, ""));
  add("Minerals", "Sodium", pct(r.minerals.sodiumPct));
  add("Minerals", "Chloride", pct(r.minerals.chloridePct));
  add("Minerals", "Chloride range", range(r.minerals.chloridePctRange));

  add("Trace minerals", "Zinc", numberOrDash(r.traceMinerals.zincPpm, "ppm"));
  add("Trace minerals", "Iron", numberOrDash(r.traceMinerals.ironPpm, "ppm"));
  add("Trace minerals", "Manganese", numberOrDash(r.traceMinerals.manganesePpm, "ppm"));
  add("Trace minerals", "Copper", numberOrDash(r.traceMinerals.copperPpm, "ppm"));
  add("Trace minerals", "Iodine", numberOrDash(r.traceMinerals.iodinePpm, "ppm"));
  add("Trace minerals", "Selenium", numberOrDash(r.traceMinerals.seleniumPpm, "ppm"));

  add("Vitamins", "Vitamin A", numberOrDash(r.vitamins.vitaminAIuKg, "IU/kg"));
  add("Vitamins", "Vitamin D", numberOrDash(r.vitamins.vitaminDIuKg, "IU/kg"));
  add("Vitamins", "Vitamin E", numberOrDash(r.vitamins.vitaminEIuKg, "IU/kg"));
  add("Vitamins", "Vitamin K", numberOrDash(r.vitamins.vitaminKMgKg, "mg/kg"));
  add("Vitamins", "Niacin", numberOrDash(r.vitamins.niacinMgKg, "mg/kg"));
  add("Vitamins", "Riboflavin", numberOrDash(r.vitamins.riboflavinMgKg, "mg/kg"));
  add("Vitamins", "Pantothenic acid", numberOrDash(r.vitamins.pantothenicAcidMgKg, "mg/kg"));
  add("Vitamins", "Vitamin B12", numberOrDash(r.vitamins.vitaminB12McgKg, "mcg/kg"));
  add("Vitamins", "Total choline", numberOrDash(r.vitamins.totalCholineMgKg, "mg/kg"));

  add("Practical limits", "Maximum soybean meal", pct(r.practical.soybeanMealMaxPct));
  add("Practical limits", "Maximum SID lysine : crude protein", pct(r.practical.sidLysineToCrudeProteinMaxPct));
  add("Practical limits", "Highly digestible protein", range(r.practical.highlyDigestibleProteinPct));
  add("Practical limits", "Highly digestible carbohydrate", pct(r.practical.highlyDigestibleCarbohydratePct));
  add("Practical limits", "Maximum L-lysine HCl", pct(r.practical.lLysineHclMaxPct));

  return rows;
}

const groups: NutrientRow["group"][] = [
  "Energy & protein",
  "Amino acids",
  "Minerals",
  "Trace minerals",
  "Vitamins",
  "Practical limits",
];

export function NutritionBrowser() {
  const [phaseId, setPhaseId] = useState(programme.phases[0].id);
  const phase = programme.phases.find((item) => item.id === phaseId) ?? programme.phases[0];
  const rows = useMemo(() => rowsFor(phase), [phase]);

  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Nutrition</h1>
          <Badge variant="secondary">Reference data</Badge>
        </div>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-muted">
          Browse PigFlow&apos;s source-level nutrient requirements. These are formulation
          constraints, not a feed recipe and not the amount an individual pig will eat.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{programme.name}</CardTitle>
          <CardDescription>
            {programme.source} · {programme.sourceVersion}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-[minmax(280px,420px)_1fr]">
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

            <div className="grid grid-cols-2 gap-3 rounded-lg border border-hairline bg-raised/40 p-4 md:grid-cols-3">
              <div>
                <p className="text-[11px] uppercase tracking-wide text-ink-faint">Published range</p>
                <p className="mt-1 text-sm font-medium text-ink">{phase.sourceWeightRange}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-ink-faint">Variant</p>
                <p className="mt-1 text-sm font-medium text-ink">{phase.variant.replaceAll("_", " ")}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-ink-faint">Source section</p>
                <p className="mt-1 text-sm font-medium text-ink">
                  {phase.sourceMaxWeightKg !== null && phase.sourceMaxWeightKg <= 11.5 ? "Q · Prestart pigs" : "R · Late nursery & grow-finish"}
                </p>
              </div>
            </div>
          </div>

          {phase.sourceMinWeightKg !== phase.lookupMinWeightKg ||
          phase.sourceMaxWeightKg !== phase.lookupMaxWeightKg ? (
            <div className="rounded-lg border border-warning/30 bg-warning/5 px-4 py-3 text-xs leading-5 text-ink-muted">
              PIC&apos;s source tables overlap at the nursery transition. This record is published as{" "}
              <strong className="text-ink">{phase.sourceWeightRange}</strong>; PigFlow&apos;s automatic
              lookup starts it at <strong className="text-ink">{phase.lookupMinWeightKg} kg</strong> so
              one liveweight does not select two standard diets.
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        {groups.map((group) => {
          const groupRows = rows.filter((row) => row.group === group);
          if (groupRows.length === 0) return null;
          return (
            <Card key={group}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{group}</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nutrient / constraint</TableHead>
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
          <p>
            {programme.source}, {programme.sourceVersion}. Sections {programme.sourceSections.join(" and ")}.
          </p>
          <p>
            PIC expresses some late-nursery and grow-finish requirements relative to dietary
            energy rather than as a fixed percentage. PigFlow preserves that representation so
            a future formulation engine can evaluate diets at their actual energy density.
          </p>
          <a
            href={programme.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex font-medium text-brand underline underline-offset-4"
          >
            Open the source guideline
          </a>
        </CardContent>
      </Card>
    </div>
  );
}
