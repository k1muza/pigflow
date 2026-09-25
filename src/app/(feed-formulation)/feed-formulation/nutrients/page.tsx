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
import { PIC_GROWTH_NUTRITION_2021 } from "@/lib/nutrition";

const programme = PIC_GROWTH_NUTRITION_2021;

function value(value: number | undefined, suffix = ""): string {
  return value === undefined ? "—" : `${value}${suffix}`;
}

export default function FeedNutrientsPage() {
  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Nutrients</h1>
          <Badge variant="secondary">{programme.sourceVersion}</Badge>
        </div>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-muted">
          Nutrient targets and constraints currently loaded from PIC for nursery and grow-finish pigs.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>PIC nutrient specifications</CardTitle>
          <CardDescription>
            {programme.source} · {programme.sourceSections.join(" · ")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-lg border border-hairline">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Phase</TableHead>
                  <TableHead>Published weight</TableHead>
                  <TableHead>Variant</TableHead>
                  <TableHead className="text-right">SID Lys</TableHead>
                  <TableHead className="text-right">ME</TableHead>
                  <TableHead className="text-right">NE</TableHead>
                  <TableHead className="text-right">STTD P</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {programme.phases.map((phase) => (
                  <TableRow key={phase.id}>
                    <TableCell className="font-medium text-ink">{phase.label}</TableCell>
                    <TableCell className="text-ink-muted">{phase.sourceWeightRange}</TableCell>
                    <TableCell className="capitalize text-ink-muted">
                      {phase.variant.replaceAll("_", " ")}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {phase.requirements.sidLysinePct !== undefined
                        ? value(phase.requirements.sidLysinePct, "%")
                        : phase.requirements.sidLysineGPerMcalME !== undefined
                          ? value(phase.requirements.sidLysineGPerMcalME, " g/Mcal ME")
                          : value(phase.requirements.sidLysineGPerMcalNE, " g/Mcal NE")}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {value(phase.requirements.metabolizableEnergyKcalKg, " kcal/kg")}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {value(phase.requirements.netEnergyKcalKg, " kcal/kg")}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {phase.requirements.minerals.sttdPhosphorusPct !== undefined
                        ? value(phase.requirements.minerals.sttdPhosphorusPct, "%")
                        : phase.requirements.minerals.sttdPhosphorusGPerMcalME !== undefined
                          ? value(phase.requirements.minerals.sttdPhosphorusGPerMcalME, " g/Mcal ME")
                          : value(phase.requirements.minerals.sttdPhosphorusGPerMcalNE, " g/Mcal NE")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Interpretation</CardTitle>
        </CardHeader>
        <CardContent className="text-sm leading-6 text-ink-muted">
          These are formulation constraints, not feed recipes. Later grow-finish phases express
          several requirements relative to diet energy, so PigFlow resolves the final percentage
          against the candidate diet&apos;s actual ME or NE density.
        </CardContent>
      </Card>
    </div>
  );
}
