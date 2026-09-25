"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import {
  INGREDIENT_LIBRARY,
  sidAminoAcidPct,
  sttdPhosphorusPctOf,
  type IngredientNutrientRecord,
} from "@/lib/ingredient-nutrients";
import { usePlanner } from "@/components/planner-shell";
import { ingredientHref } from "@/lib/routes";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function display(value: number | undefined, unit = ""): string {
  if (value === undefined) return "—";
  return `${Number(value.toFixed(4))}${unit ? ` ${unit}` : ""}`;
}

function ValueRows({ rows }: { rows: Array<[string, string]> }) {
  return (
    <Table>
      <TableBody>
        {rows.map(([label, value]) => (
          <TableRow key={label}>
            <TableCell className="text-sm text-ink-muted">{label}</TableCell>
            <TableCell className="text-right font-mono text-sm text-ink">{value}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function IngredientDetail({ ingredientId }: { ingredientId: string }) {
  const { projectId, config, update } = usePlanner();
  const ingredient = INGREDIENT_LIBRARY.ingredients.find((row) => row.id === ingredientId);

  if (!ingredient) {
    return (
      <div className="space-y-4">
        <Link
          href={ingredientHref(projectId)}
          className="inline-flex items-center gap-2 text-sm font-medium text-brand"
        >
          <ArrowLeft className="size-4" />
          Ingredient database
        </Link>
        <Card>
          <CardHeader>
            <CardTitle>Ingredient not found</CardTitle>
            <CardDescription>
              “{ingredientId}” is not present in the checked-in NRC ingredient library.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const currentPrice = config.nutrition.ingredientPrices.find(
    (row) => row.ingredientId === ingredient.id,
  )?.pricePerKg;

  const setPrice = (raw: string) => {
    const others = config.nutrition.ingredientPrices.filter(
      (row) => row.ingredientId !== ingredient.id,
    );
    update(
      "nutrition",
      "ingredientPrices",
      raw === ""
        ? others
        : [
            ...others,
            {
              ingredientId: ingredient.id,
              pricePerKg: Math.max(0, Number(raw) || 0),
            },
          ],
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={ingredientHref(projectId)}
          className="mb-4 inline-flex items-center gap-2 text-sm font-medium text-brand hover:underline"
        >
          <ArrowLeft className="size-4" />
          Ingredient database
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">{ingredient.name}</h1>
          <Badge variant="secondary" className="capitalize">
            {ingredient.category.replaceAll("_", " ")}
          </Badge>
        </div>
        <p className="mt-2 text-sm text-ink-muted">
          {ingredient.aliases.length > 0 ? ingredient.aliases.join(" · ") : "NRC feed ingredient"}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Farm price</CardTitle>
          <CardDescription>
            Your local price is plan data. It does not modify the NRC nutrient record.
          </CardDescription>
        </CardHeader>
        <CardContent className="max-w-sm space-y-2">
          <label htmlFor="ingredient-price" className="text-xs font-medium text-ink-muted">
            {config.project.currency} / kg
          </label>
          <Input
            id="ingredient-price"
            type="number"
            min={0}
            step="0.01"
            value={currentPrice ?? ""}
            placeholder="Enter local price"
            onChange={(event) => setPrice(event.target.value)}
          />
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Composition & energy</CardTitle>
          </CardHeader>
          <CardContent>
            <ValueRows
              rows={[
                ["Dry matter", display(ingredient.composition.dryMatterPct, "%")],
                ["Crude protein", display(ingredient.composition.crudeProteinPct, "%")],
                ["Crude fat", display(ingredient.composition.crudeFatPct, "%")],
                ["Crude fibre", display(ingredient.composition.crudeFibrePct, "%")],
                ["Ash", display(ingredient.composition.ashPct, "%")],
                ["Starch", display(ingredient.composition.starchPct, "%")],
                ["NDF", display(ingredient.composition.neutralDetergentFibrePct, "%")],
                ["ADF", display(ingredient.composition.acidDetergentFibrePct, "%")],
                ["DE", display(ingredient.energy.digestibleKcalKg, "kcal/kg")],
                ["ME", display(ingredient.energy.metabolizableKcalKg, "kcal/kg")],
                ["NE", display(ingredient.energy.netKcalKg, "kcal/kg")],
              ]}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Minerals</CardTitle>
          </CardHeader>
          <CardContent>
            <ValueRows
              rows={[
                ["Calcium", display(ingredient.macroMinerals.calciumPct, "%")],
                ["Total phosphorus", display(ingredient.macroMinerals.totalPhosphorusPct, "%")],
                [
                  "STTD P digestibility",
                  display(ingredient.macroMinerals.sttdPhosphorusDigestibilityPct, "%"),
                ],
                ["Derived STTD phosphorus", display(sttdPhosphorusPctOf(ingredient), "%")],
                ["Available phosphorus", display(ingredient.macroMinerals.availablePhosphorusPct, "%")],
                ["Sodium", display(ingredient.macroMinerals.sodiumPct, "%")],
                ["Chloride", display(ingredient.macroMinerals.chloridePct, "%")],
                ["Potassium", display(ingredient.macroMinerals.potassiumPct, "%")],
                ["Magnesium", display(ingredient.macroMinerals.magnesiumPct, "%")],
              ]}
            />
          </CardContent>
        </Card>
      </div>

      <AminoAcids ingredient={ingredient} />

      {Object.keys(ingredient.traceMineralsPpm).length > 0 ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Trace minerals</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-lg border border-hairline">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Mineral</TableHead>
                    <TableHead className="text-right">ppm</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Object.entries(ingredient.traceMineralsPpm).map(([name, value]) => (
                    <TableRow key={name}>
                      <TableCell className="capitalize text-ink-muted">{name}</TableCell>
                      <TableCell className="text-right font-mono">{display(value)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">NRC provenance</CardTitle>
          <CardDescription>
            The source record is kept separate from any PigFlow-derived values.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm leading-6 text-ink-muted">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <SourceFact label="Source" value={INGREDIENT_LIBRARY.source.title} />
            <SourceFact label="Edition" value={INGREDIENT_LIBRARY.source.edition} />
            <SourceFact label="Table" value={ingredient.provenance.sourceTable ?? "—"} />
            <SourceFact
              label="Page"
              value={ingredient.provenance.sourcePage?.toString() ?? "—"}
            />
          </div>
          <p>
            <span className="font-medium text-ink">NRC ingredient name:</span>{" "}
            {ingredient.provenance.sourceIngredientName ?? ingredient.name}
          </p>
          {[...ingredient.provenance.notes, ...ingredient.constraints.notes].map((note) => (
            <p key={note}>{note}</p>
          ))}
          <a
            href={INGREDIENT_LIBRARY.source.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex font-medium text-brand underline underline-offset-4"
          >
            Open NRC source
          </a>
        </CardContent>
      </Card>
    </div>
  );
}

function AminoAcids({ ingredient }: { ingredient: IngredientNutrientRecord }) {
  const names = Array.from(
    new Set([
      ...Object.keys(ingredient.aminoAcids.totalPct),
      ...Object.keys(ingredient.aminoAcids.sidPct),
    ]),
  );

  if (names.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Amino acids</CardTitle>
        <CardDescription>
          NRC total concentration and SID digestibility are shown independently. Derived SID %
          is calculated by PigFlow.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto rounded-lg border border-hairline">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Amino acid</TableHead>
                <TableHead className="text-right">Total %</TableHead>
                <TableHead className="text-right">SID digestibility %</TableHead>
                <TableHead className="text-right">Derived SID %</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {names.map((name) => (
                <TableRow key={name}>
                  <TableCell className="capitalize text-ink-muted">{name}</TableCell>
                  <TableCell className="text-right font-mono">
                    {display(ingredient.aminoAcids.totalPct[name])}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {display(ingredient.aminoAcids.sidDigestibilityPct[name])}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {display(sidAminoAcidPct(ingredient, name))}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function SourceFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-hairline bg-raised/40 p-3">
      <div className="text-[11px] uppercase tracking-wide text-ink-faint">{label}</div>
      <div className="mt-1 font-medium text-ink">{value}</div>
    </div>
  );
}
