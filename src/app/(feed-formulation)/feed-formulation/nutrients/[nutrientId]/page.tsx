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
import { FEED_PROGRAMMES } from "@/lib/feed-programmes";
import {
  FEED_NUTRIENTS,
  feedNutrientById,
  nutrientRequirementValue,
} from "@/lib/feed-nutrients";
import { feedFormulationHref, feedProgrammePhaseHref } from "@/lib/routes";

export default async function FeedNutrientPage({
  params,
}: {
  params: Promise<{ nutrientId: string }>;
}) {
  const { nutrientId } = await params;
  const nutrient = feedNutrientById(nutrientId);
  if (!nutrient) notFound();

  const requirements = FEED_PROGRAMMES.flatMap((programme) =>
    programme.phases.flatMap((phase) => {
      const requirement = nutrientRequirementValue(nutrient.id, phase);
      return requirement ? [{ programme, phase, requirement }] : [];
    }),
  );

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={feedFormulationHref("nutrients")}
          className="mb-4 inline-flex items-center gap-2 text-sm font-medium text-brand hover:underline"
        >
          <ArrowLeft size={14} />
          Nutrients
        </Link>

        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">{nutrient.name}</h1>
          <Badge variant="secondary">{nutrient.shortName}</Badge>
          <Badge variant="secondary">{nutrient.group}</Badge>
        </div>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-muted">
          {nutrient.description}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Measurement</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {nutrient.units.map((unit) => (
                <Badge key={unit} variant="secondary">{unit}</Badge>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Formulation role</CardTitle>
          </CardHeader>
          <CardContent className="text-sm leading-6 text-ink-muted">
            {nutrient.formulationRole}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Loaded PIC requirements</CardTitle>
          <CardDescription>
            Requirement values currently available in PigFlow. Values remain programme- and phase-specific.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {requirements.length > 0 ? (
            <div className="overflow-x-auto rounded-lg border border-hairline">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Programme</TableHead>
                    <TableHead>Phase</TableHead>
                    <TableHead className="text-right">Requirement</TableHead>
                    <TableHead>Basis</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {requirements.map(({ programme, phase, requirement }) => (
                    <TableRow key={`${programme.id}:${phase.id}`}>
                      <TableCell>{programme.name}</TableCell>
                      <TableCell>
                        <Link
                          href={feedProgrammePhaseHref(programme.id, phase.id)}
                          className="font-medium text-brand hover:underline"
                        >
                          {phase.label}
                        </Link>
                      </TableCell>
                      <TableCell className="text-right font-mono">{requirement.value}</TableCell>
                      <TableCell className="text-ink-muted">{requirement.basis}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-hairline px-4 py-6 text-sm text-ink-muted">
              No programme requirement for this nutrient has been loaded yet.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function generateStaticParams() {
  return FEED_NUTRIENTS.map((nutrient) => ({ nutrientId: nutrient.id }));
}
