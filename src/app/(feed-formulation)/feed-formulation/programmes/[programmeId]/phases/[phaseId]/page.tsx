import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableRow,
} from "@/components/ui/table";
import { feedProgrammeById, feedProgrammePhaseById } from "@/lib/feed-programmes";
import { feedProgrammeHref } from "@/lib/routes";

function value(value: number | undefined, suffix = ""): string {
  return value === undefined ? "—" : `${value}${suffix}`;
}

function range(value: { min: number; max: number } | undefined, suffix = "%"): string {
  return value ? `${value.min}–${value.max}${suffix}` : "—";
}

export default async function FeedProgrammePhasePage({
  params,
}: {
  params: Promise<{ programmeId: string; phaseId: string }>;
}) {
  const { programmeId, phaseId } = await params;
  const programme = feedProgrammeById(programmeId);
  const phase = feedProgrammePhaseById(programmeId, phaseId);
  if (!programme || !phase) notFound();

  const r = phase.requirements;

  const groups = [
    {
      title: "Energy & protein",
      rows: [
        ["Net energy", value(r.netEnergyKcalKg, " kcal/kg")],
        ["Metabolizable energy", value(r.metabolizableEnergyKcalKg, " kcal/kg")],
        ["SID lysine", value(r.sidLysinePct, "%")],
        ["SID lysine / NE", value(r.sidLysineGPerMcalNE, " g/Mcal")],
        ["SID lysine / ME", value(r.sidLysineGPerMcalME, " g/Mcal")],
        ["Minimum crude protein", value(r.practical.crudeProteinMinPct, "%")],
      ],
    },
    {
      title: "Amino acids",
      rows: [
        ["SID Met + Cys : Lys", value(r.aminoAcids.methionineCysteineToLysPct, "%")],
        ["SID Thr : Lys", value(r.aminoAcids.threonineToLysPct, "%")],
        ["SID Trp : Lys", value(r.aminoAcids.tryptophanToLysPct, "%")],
        ["SID Val : Lys", value(r.aminoAcids.valineToLysPct, "%")],
        ["SID Ile : Lys", value(r.aminoAcids.isoleucineToLysPct, "%")],
        ["SID Leu : Lys", value(r.aminoAcids.leucineToLysPct, "%")],
        ["SID His : Lys", value(r.aminoAcids.histidineToLysPct, "%")],
        ["SID Phe + Tyr : Lys", value(r.aminoAcids.phenylalanineTyrosineToLysPct, "%")],
      ],
    },
    {
      title: "Minerals",
      rows: [
        ["Calcium", value(r.minerals.calciumPct, "%")],
        ["STTD phosphorus", value(r.minerals.sttdPhosphorusPct, "%")],
        ["Available phosphorus", value(r.minerals.availablePhosphorusPct, "%")],
        ["STTD phosphorus / NE", value(r.minerals.sttdPhosphorusGPerMcalNE, " g/Mcal")],
        ["STTD phosphorus / ME", value(r.minerals.sttdPhosphorusGPerMcalME, " g/Mcal")],
        ["Available phosphorus / NE", value(r.minerals.availablePhosphorusGPerMcalNE, " g/Mcal")],
        ["Available phosphorus / ME", value(r.minerals.availablePhosphorusGPerMcalME, " g/Mcal")],
        ["Analyzed Ca:P", range(r.minerals.analyzedCalciumToPhosphorus, "")],
        ["Sodium", value(r.minerals.sodiumPct, "%")],
        ["Chloride", value(r.minerals.chloridePct, "%")],
        ["Chloride range", range(r.minerals.chloridePctRange)],
      ],
    },
    {
      title: "Trace minerals",
      rows: [
        ["Zinc", value(r.traceMinerals.zincPpm, " ppm")],
        ["Iron", value(r.traceMinerals.ironPpm, " ppm")],
        ["Manganese", value(r.traceMinerals.manganesePpm, " ppm")],
        ["Copper", value(r.traceMinerals.copperPpm, " ppm")],
        ["Iodine", value(r.traceMinerals.iodinePpm, " ppm")],
        ["Selenium", value(r.traceMinerals.seleniumPpm, " ppm")],
      ],
    },
    {
      title: "Vitamins",
      rows: [
        ["Vitamin A", value(r.vitamins.vitaminAIuKg, " IU/kg")],
        ["Vitamin D", value(r.vitamins.vitaminDIuKg, " IU/kg")],
        ["Vitamin E", value(r.vitamins.vitaminEIuKg, " IU/kg")],
        ["Vitamin K", value(r.vitamins.vitaminKMgKg, " mg/kg")],
        ["Niacin", value(r.vitamins.niacinMgKg, " mg/kg")],
        ["Riboflavin", value(r.vitamins.riboflavinMgKg, " mg/kg")],
        ["Pantothenic acid", value(r.vitamins.pantothenicAcidMgKg, " mg/kg")],
        ["Vitamin B12", value(r.vitamins.vitaminB12McgKg, " mcg/kg")],
        ["Total choline", value(r.vitamins.totalCholineMgKg, " mg/kg")],
      ],
    },
    {
      title: "Practical limits",
      rows: [
        ["Maximum soybean meal", value(r.practical.soybeanMealMaxPct, "%")],
        ["Maximum SID lysine : crude protein", value(r.practical.sidLysineToCrudeProteinMaxPct, "%")],
        ["Highly digestible protein", range(r.practical.highlyDigestibleProteinPct)],
        ["Highly digestible carbohydrate", value(r.practical.highlyDigestibleCarbohydratePct, "%")],
        ["Maximum L-lysine HCl", value(r.practical.lLysineHclMaxPct, "%")],
      ],
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={feedProgrammeHref(programme.id)}
          className="mb-4 inline-flex items-center gap-2 text-sm font-medium text-brand hover:underline"
        >
          <ArrowLeft size={14} />
          {programme.name}
        </Link>

        <div className="text-sm font-medium text-brand">{programme.name}</div>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">{phase.label}</h1>
          <Badge variant="secondary">{phase.sourceWeightRange}</Badge>
        </div>
        <p className="mt-2 text-sm text-ink-muted">
          {programme.sourceProgramme?.source} · {programme.sourceProgramme?.sourceVersion}
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {groups.map((group) => {
          const rows = group.rows.filter(([, rowValue]) => rowValue !== "—");
          if (rows.length === 0) return null;
          return (
            <Card key={group.title}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{group.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableBody>
                    {rows.map(([label, rowValue]) => (
                      <TableRow key={label}>
                        <TableCell className="text-sm text-ink-muted">{label}</TableCell>
                        <TableCell className="text-right font-mono text-sm text-ink">
                          {rowValue}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
