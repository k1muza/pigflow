"use client";

import { useState } from "react";

import {
  INGREDIENT_LIBRARY,
  sidAminoAcidPct,
  sttdPhosphorusPctOf,
} from "@/lib/ingredient-nutrients";
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

const library = INGREDIENT_LIBRARY;

function display(value: number | undefined, unit = ""): string {
  if (value === undefined) return "—";
  return `${Number(value.toFixed(4))}${unit ? ` ${unit}` : ""}`;
}

export function IngredientNutrientBrowser() {
  const [ingredientId, setIngredientId] = useState(library.ingredients[0]?.id ?? "");
  const ingredient =
    library.ingredients.find((candidate) => candidate.id === ingredientId) ??
    library.ingredients[0];

  if (!ingredient) return null;

  const aminoAcids = Object.keys(ingredient.aminoAcids.totalPct);

  return (
    <Card>
      <CardHeader>
        <CardTitle>NRC ingredient nutrient database</CardTitle>
        <CardDescription>
          Raw NRC 2012 loading values are preserved separately from PigFlow&apos;s derived SID
          concentrations.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-4 lg:grid-cols-[minmax(280px,420px)_1fr]">
          <div className="space-y-2">
            <label htmlFor="ingredient-browser" className="text-xs font-medium text-ink-muted">
              Ingredient
            </label>
            <Select value={ingredient.id} onValueChange={setIngredientId}>
              <SelectTrigger id="ingredient-browser" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {library.ingredients.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="rounded-lg border border-hairline bg-raised/40 p-4 text-xs leading-5 text-ink-muted">
            <div className="font-medium text-ink">{library.source.title}</div>
            <div>
              {library.source.edition} · {library.source.year} · {ingredient.provenance.sourceTable ?? "source table"}
            </div>
            <div>
              NRC name: {ingredient.provenance.sourceIngredientName ?? ingredient.name}
              {ingredient.provenance.sourcePage ? ` · p. ${ingredient.provenance.sourcePage}` : ""}
            </div>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Composition & energy</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableBody>
                  {[
                    ["Dry matter", display(ingredient.composition.dryMatterPct, "%")],
                    ["Crude protein", display(ingredient.composition.crudeProteinPct, "%")],
                    ["Crude fat", display(ingredient.composition.crudeFatPct, "%")],
                    ["Crude fibre", display(ingredient.composition.crudeFibrePct, "%")],
                    ["NDF", display(ingredient.composition.neutralDetergentFibrePct, "%")],
                    ["ADF", display(ingredient.composition.acidDetergentFibrePct, "%")],
                    ["Starch", display(ingredient.composition.starchPct, "%")],
                    ["DE", display(ingredient.energy.digestibleKcalKg, "kcal/kg")],
                    ["ME", display(ingredient.energy.metabolizableKcalKg, "kcal/kg")],
                    ["NE", display(ingredient.energy.netKcalKg, "kcal/kg")],
                  ].map(([label, value]) => (
                    <TableRow key={label}>
                      <TableCell className="text-sm text-ink-muted">{label}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{value}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Macro minerals</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableBody>
                  {[
                    ["Calcium", display(ingredient.macroMinerals.calciumPct, "%")],
                    ["Total phosphorus", display(ingredient.macroMinerals.totalPhosphorusPct, "%")],
                    [
                      "STTD P digestibility",
                      display(ingredient.macroMinerals.sttdPhosphorusDigestibilityPct, "%"),
                    ],
                    ["Derived STTD phosphorus", display(sttdPhosphorusPctOf(ingredient), "%")],
                    ["Sodium", display(ingredient.macroMinerals.sodiumPct, "%")],
                    ["Chloride", display(ingredient.macroMinerals.chloridePct, "%")],
                    ["Potassium", display(ingredient.macroMinerals.potassiumPct, "%")],
                    ["Magnesium", display(ingredient.macroMinerals.magnesiumPct, "%")],
                  ].map(([label, value]) => (
                    <TableRow key={label}>
                      <TableCell className="text-sm text-ink-muted">{label}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{value}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>

        {aminoAcids.length > 0 ? (
          <div>
            <h3 className="mb-2 text-sm font-semibold text-ink">Amino acids</h3>
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
                  {aminoAcids.map((name) => (
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
          </div>
        ) : null}

        {ingredient.provenance.notes.length > 0 || ingredient.constraints.notes.length > 0 ? (
          <div className="rounded-lg border border-hairline bg-raised/40 px-4 py-3 text-xs leading-5 text-ink-muted">
            {[...ingredient.provenance.notes, ...ingredient.constraints.notes].map((note) => (
              <p key={note}>{note}</p>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
