"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";

import { INGREDIENT_LIBRARY } from "@/lib/ingredient-nutrients";
import { ingredientDefaultPrice } from "@/lib/feed-ingredient-prices";
import { feedIngredientHref } from "@/lib/routes";
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

const library = INGREDIENT_LIBRARY;

function display(value: number | undefined, unit = ""): string {
  if (value === undefined) return "—";
  return `${Number(value.toFixed(3))}${unit ? ` ${unit}` : ""}`;
}

export function IngredientNutrientBrowser() {
  const [query, setQuery] = useState("");

  const ingredients = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return library.ingredients;

    return library.ingredients.filter((ingredient) => {
      const haystack = [
        ingredient.name,
        ingredient.id,
        ingredient.category,
        ...ingredient.aliases,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalized);
    });
  }, [query]);

  return (
    <Card>
      <CardHeader className="gap-3">
        <div>
          <CardTitle>NRC ingredient nutrient database</CardTitle>
          <CardDescription>
            Browse the checked-in NRC 2012 ingredient matrix. Open an ingredient for its complete
            composition, SID digestibility, minerals, and source provenance.
          </CardDescription>
        </div>
        <div className="relative max-w-xl">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-faint" />
          <Input
            aria-label="Search ingredients"
            placeholder="Search maize, soybean meal, limestone…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="pl-9"
          />
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
          <Badge variant="secondary">{library.ingredients.length} ingredients</Badge>
          <span>{library.source.title}</span>
          <span>·</span>
          <span>{library.source.edition}</span>
          <span>·</span>
          <span>{library.source.year}</span>
        </div>

        <div className="overflow-x-auto rounded-lg border border-hairline">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ingredient</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">CP</TableHead>
                <TableHead className="text-right">ME</TableHead>
                <TableHead className="text-right">NE</TableHead>
                <TableHead className="text-right">Default price</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ingredients.map((ingredient) => (
                  <TableRow key={ingredient.id}>
                    <TableCell>
                      <Link
                        href={feedIngredientHref(ingredient.id)}
                        className="font-medium text-ink underline-offset-4 hover:underline"
                      >
                        {ingredient.name}
                      </Link>
                      {ingredient.aliases.length > 0 ? (
                        <div className="mt-1 text-xs text-ink-faint">
                          {ingredient.aliases.slice(0, 3).join(", ")}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="capitalize text-ink-muted">
                      {ingredient.category.replaceAll("_", " ")}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {display(ingredient.composition.crudeProteinPct, "%")}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {display(ingredient.energy.metabolizableKcalKg, "kcal/kg")}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {display(ingredient.energy.netKcalKg, "kcal/kg")}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {ingredientDefaultPrice(ingredient.id)
                        ? `US${ingredientDefaultPrice(ingredient.id)!.usdPerTonne.toLocaleString()}/t`
                        : "—"}
                    </TableCell>
                  </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {ingredients.length === 0 ? (
          <div className="rounded-lg border border-dashed border-hairline px-4 py-8 text-center text-sm text-ink-muted">
            No NRC ingredients match “{query}”.
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
