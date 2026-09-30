"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, Calculator, Plus, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  ingredientDefaultPrice,
  ingredientDefaultPricePerKg,
} from "@/lib/feed-ingredient-prices";
import type {
  FormulationIngredientOption,
  FormulationIngredientSuggestionResult,
  LeastCostFormulationResult,
} from "@/lib/feed-optimizer";

type ProgrammeOption = {
  id: string;
  name: string;
  phases: { id: string; label: string; sourceTable: string }[];
};

type IngredientOption = {
  id: string;
  name: string;
  category: string;
  minInclusionPct?: number;
  maxInclusionPct?: number;
};

type Row = {
  key: number;
  ingredientId: string;
  price: string;
  min: string;
  max: string;
};

function defaultPriceInput(ingredientId: string): string {
  const price = ingredientDefaultPricePerKg(ingredientId);
  return price === undefined ? "" : price.toFixed(4);
}

export function FeedFormulationWorkbench({
  programmes,
  ingredients,
}: {
  programmes: ProgrammeOption[];
  ingredients: IngredientOption[];
}) {
  const firstProgramme = programmes[0];
  const [programmeId, setProgrammeId] = useState(firstProgramme?.id ?? "");
  const selectedProgramme = useMemo(
    () => programmes.find((programme) => programme.id === programmeId) ?? programmes[0],
    [programmeId, programmes],
  );
  const [phaseId, setPhaseId] = useState(firstProgramme?.phases[0]?.id ?? "");
  const [energySystem, setEnergySystem] = useState<"ME" | "NE">("ME");
  const [nextKey, setNextKey] = useState(100);
  const [addIngredientId, setAddIngredientId] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [result, setResult] = useState<LeastCostFormulationResult | null>(null);
  const [running, setRunning] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestionError, setSuggestionError] = useState<string | null>(null);

  const ingredientById = useMemo(
    () => new Map(ingredients.map((ingredient) => [ingredient.id, ingredient])),
    [ingredients],
  );

  const availableToAdd = ingredients.filter(
    (ingredient) => !rows.some((row) => row.ingredientId === ingredient.id),
  );

  useEffect(() => {
    if (!programmeId || !phaseId) return;

    const controller = new AbortController();
    setSuggesting(true);
    setSuggestionError(null);
    setResult(null);

    void (async () => {
      try {
        const response = await fetch("/api/feed-formulation/suggest", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            programmeId,
            phaseId,
            energySystem,
          }),
          signal: controller.signal,
        });
        const payload = (await response.json()) as
          | FormulationIngredientSuggestionResult
          | { status: "error"; message?: string };

        if (!response.ok) {
          throw new Error(
            "message" in payload && payload.message
              ? payload.message
              : "Ingredient suggestion request failed.",
          );
        }
        if (payload.status !== "suggested") {
          throw new Error(payload.message);
        }

        const suggestedIds = payload.ingredientIds.filter((ingredientId) =>
          ingredients.some((ingredient) => ingredient.id === ingredientId),
        );
        setRows(
          suggestedIds.map((ingredientId, index) => ({
            key: index,
            ingredientId,
            price: defaultPriceInput(ingredientId),
            min: "",
            max: "",
          })),
        );
      } catch (error) {
        if (controller.signal.aborted) return;
        setRows([]);
        setSuggestionError(error instanceof Error ? error.message : String(error));
      } finally {
        if (!controller.signal.aborted) {
          setSuggesting(false);
        }
      }
    })();

    return () => controller.abort();
  }, [programmeId, phaseId, energySystem, ingredients]);

  function changeProgramme(value: string) {
    const programme = programmes.find((candidate) => candidate.id === value);
    setProgrammeId(value);
    setPhaseId(programme?.phases[0]?.id ?? "");
    setResult(null);
  }

  function updateRow(key: number, field: keyof Omit<Row, "key">, value: string) {
    setRows((current) =>
      current.map((row) => (row.key === key ? { ...row, [field]: value } : row)),
    );
    setResult(null);
  }

  function addIngredient() {
    if (!addIngredientId) return;
    setRows((current) => [
      ...current,
      {
        key: nextKey,
        ingredientId: addIngredientId,
        price: defaultPriceInput(addIngredientId),
        min: "",
        max: "",
      },
    ]);
    setNextKey((value) => value + 1);
    setAddIngredientId("");
    setResult(null);
  }

  async function formulate() {
    setRequestError(null);
    setResult(null);

    if (!programmeId || !phaseId) {
      setRequestError("Select a requirement programme and phase.");
      return;
    }
    if (rows.length === 0) {
      setRequestError("Add at least one available ingredient.");
      return;
    }

    let requestIngredients: FormulationIngredientOption[];
    try {
      requestIngredients = rows.map((row) => {
        const pricePerKg = Number(row.price);
        if (!Number.isFinite(pricePerKg) || pricePerKg < 0 || row.price.trim() === "") {
          throw new Error(
            `Enter a valid price per kg for ${ingredientById.get(row.ingredientId)?.name ?? row.ingredientId}.`,
          );
        }
        const min = row.min.trim() === "" ? undefined : Number(row.min);
        const max = row.max.trim() === "" ? undefined : Number(row.max);
        if (min !== undefined && (!Number.isFinite(min) || min < 0 || min > 100)) {
          throw new Error("Minimum inclusion must be between 0% and 100%.");
        }
        if (max !== undefined && (!Number.isFinite(max) || max < 0 || max > 100)) {
          throw new Error("Maximum inclusion must be between 0% and 100%.");
        }
        return {
          ingredientId: row.ingredientId,
          pricePerKg,
          minInclusionPct: min,
          maxInclusionPct: max,
        };
      });
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : String(error));
      return;
    }

    setRunning(true);
    try {
      const response = await fetch("/api/feed-formulation/optimize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          programmeId,
          phaseId,
          energySystem,
          ingredients: requestIngredients,
        }),
      });
      const payload = (await response.json()) as LeastCostFormulationResult & {
        message?: string;
      };
      if (!response.ok) {
        throw new Error(payload.message ?? "Formulation request failed.");
      }
      setResult(payload);
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : String(error));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Least-cost formulation</CardTitle>
          <CardDescription>
            Choose the Brazilian requirement phase and energy basis. PigFlow suggests a feasible
            starter basket from ingredients with complete modeled nutrient data; you can then add or
            remove ingredients and enter current local prices per kg before optimization.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Programme">
              <select
                value={programmeId}
                onChange={(event) => changeProgramme(event.target.value)}
                className="h-9 w-full rounded-md border border-hairline bg-background px-3 text-sm text-ink"
              >
                {programmes.map((programme) => (
                  <option key={programme.id} value={programme.id}>
                    {programme.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Phase">
              <select
                value={phaseId}
                onChange={(event) => {
                  setPhaseId(event.target.value);
                  setResult(null);
                }}
                className="h-9 w-full rounded-md border border-hairline bg-background px-3 text-sm text-ink"
              >
                {(selectedProgramme?.phases ?? []).map((phase) => (
                  <option key={phase.id} value={phase.id}>
                    {phase.label} · Table {phase.sourceTable}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Energy basis">
              <select
                value={energySystem}
                onChange={(event) => {
                  setEnergySystem(event.target.value as "ME" | "NE");
                  setResult(null);
                }}
                className="h-9 w-full rounded-md border border-hairline bg-background px-3 text-sm text-ink"
              >
                <option value="ME">Metabolizable energy (ME)</option>
                <option value="NE">Net energy (NE)</option>
              </select>
            </Field>
          </div>

          {suggesting ? (
            <div className="rounded-lg border border-hairline bg-raised/30 px-4 py-3 text-sm text-ink-muted">
              Finding a feasible starter basket for this requirement phase…
            </div>
          ) : null}

          <div className="overflow-x-auto rounded-lg border border-hairline">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-raised/70 text-left text-xs uppercase tracking-wide text-ink-faint">
                <tr>
                  <th className="px-3 py-2.5">Ingredient</th>
                  <th className="w-36 px-3 py-2.5">Price / kg</th>
                  <th className="w-28 px-3 py-2.5">Min %</th>
                  <th className="w-28 px-3 py-2.5">Max %</th>
                  <th className="w-12 px-3 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const ingredient = ingredientById.get(row.ingredientId);
                  const defaultPrice = ingredientDefaultPrice(row.ingredientId);
                  return (
                    <tr key={row.key} className="border-t border-hairline">
                      <td className="px-3 py-2.5">
                        <div className="font-medium text-ink">{ingredient?.name ?? row.ingredientId}</div>
                        <div className="mt-0.5 text-xs text-ink-faint">{ingredient?.category}</div>
                      </td>
                      <td className="px-3 py-2.5">
                        <Input
                          type="number"
                          min="0"
                          step="0.001"
                          value={row.price}
                          placeholder="0.000"
                          onChange={(event) => updateRow(row.key, "price", event.target.value)}
                        />
                        {defaultPrice ? (
                          <div
                            className="mt-1 text-[11px] leading-4 text-ink-faint"
                            title={defaultPrice.note}
                          >
                            Default: {defaultPrice.market} · {defaultPrice.asOf}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-3 py-2.5">
                        <Input
                          type="number"
                          min="0"
                          max="100"
                          step="0.1"
                          value={row.min}
                          placeholder={ingredient?.minInclusionPct?.toString() ?? "0"}
                          onChange={(event) => updateRow(row.key, "min", event.target.value)}
                        />
                      </td>
                      <td className="px-3 py-2.5">
                        <Input
                          type="number"
                          min="0"
                          max="100"
                          step="0.1"
                          value={row.max}
                          placeholder={ingredient?.maxInclusionPct?.toString() ?? "100"}
                          onChange={(event) => updateRow(row.key, "max", event.target.value)}
                        />
                      </td>
                      <td className="px-3 py-2.5">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`Remove ${ingredient?.name ?? row.ingredientId}`}
                          onClick={() => {
                            setRows((current) => current.filter((candidate) => candidate.key !== row.key));
                            setResult(null);
                          }}
                        >
                          <Trash2 size={15} />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap gap-2">
            <select
              value={addIngredientId}
              onChange={(event) => setAddIngredientId(event.target.value)}
              className="h-9 min-w-72 rounded-md border border-hairline bg-background px-3 text-sm text-ink"
            >
              <option value="">Add another ingredient…</option>
              {availableToAdd.map((ingredient) => (
                <option key={ingredient.id} value={ingredient.id}>
                  {ingredient.name}
                </option>
              ))}
            </select>
            <Button type="button" variant="outline" onClick={addIngredient} disabled={!addIngredientId}>
              <Plus size={15} />
              Add ingredient
            </Button>
            <Button type="button" onClick={() => void formulate()} disabled={running || rows.length === 0}>
              <Calculator size={15} />
              {running ? "Formulating…" : "Find least-cost formula"}
            </Button>
          </div>

          {suggestionError ? (
            <div className="rounded-lg border border-hairline bg-raised/30 p-3 text-sm text-ink-muted">
              PigFlow could not build an automatic starter basket: {suggestionError} You can still
              add ingredients manually.
            </div>
          ) : null}

          {requestError ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              {requestError}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {result ? <ResultPanel result={result} ingredientById={ingredientById} /> : null}
    </div>
  );
}

function ResultPanel({
  result,
  ingredientById,
}: {
  result: LeastCostFormulationResult;
  ingredientById: Map<string, IngredientOption>;
}) {
  if (result.status === "optimal") {
    return (
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle>Optimal formula</CardTitle>
            <Badge variant="secondary">Hard constraints satisfied</Badge>
          </div>
          <CardDescription>
            Calculated cost: {result.solution.costPerKg.toFixed(4)} per kg using the prices entered above.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <FormulaTable
            rows={result.solution.formula.ingredients}
            ingredientById={ingredientById}
          />
          <Unsupported requirements={result.unsupportedRequirements} />
        </CardContent>
      </Card>
    );
  }

  if (result.status === "missing-data") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Ingredient matrix is incomplete</CardTitle>
          <CardDescription>{result.message}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {result.missingData.map((missing) => (
            <div key={missing.ingredientId} className="rounded-lg border border-hairline p-3 text-sm">
              <div className="font-medium text-ink">
                {ingredientById.get(missing.ingredientId)?.name ?? missing.ingredientId}
              </div>
              <div className="mt-1 text-xs leading-5 text-ink-muted">
                Missing: {missing.nutrientIds.join(", ")}
              </div>
            </div>
          ))}
          <Unsupported requirements={result.unsupportedRequirements} />
        </CardContent>
      </Card>
    );
  }

  if (result.status === "infeasible") {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <AlertTriangle size={18} className="text-amber-600" />
            <CardTitle>No exact formulation</CardTitle>
          </div>
          <CardDescription>{result.message}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {result.diagnostics.length > 0 ? (
            <div className="space-y-2">
              {result.diagnostics.map((diagnostic) => (
                <div key={diagnostic.constraintId} className="rounded-lg border border-hairline p-3 text-sm">
                  <div className="font-medium text-ink">{diagnostic.label}</div>
                  <div className="mt-1 text-xs text-ink-muted">
                    Actual {diagnostic.actual.toFixed(4)} {diagnostic.unit}; required{" "}
                    {diagnostic.relation === "min" ? "≥" : "≤"} {diagnostic.bound} {diagnostic.unit}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          {result.bestEffort ? (
            <div>
              <div className="mb-2 text-sm font-medium text-ink">Closest diagnostic blend</div>
              <FormulaTable
                rows={result.bestEffort.formula.ingredients}
                ingredientById={ingredientById}
              />
            </div>
          ) : null}
          <Unsupported requirements={result.unsupportedRequirements} />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Formulation error</CardTitle>
        <CardDescription>{result.message}</CardDescription>
      </CardHeader>
    </Card>
  );
}

function FormulaTable({
  rows,
  ingredientById,
}: {
  rows: readonly { ingredientId: string; inclusionPct: number }[];
  ingredientById: Map<string, IngredientOption>;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-hairline">
      <table className="w-full text-sm">
        <thead className="bg-raised/70 text-left text-xs uppercase tracking-wide text-ink-faint">
          <tr>
            <th className="px-3 py-2.5">Ingredient</th>
            <th className="px-3 py-2.5 text-right">Inclusion</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.ingredientId} className="border-t border-hairline">
              <td className="px-3 py-2.5 text-ink">
                {ingredientById.get(row.ingredientId)?.name ?? row.ingredientId}
              </td>
              <td className="px-3 py-2.5 text-right font-medium text-ink">
                {row.inclusionPct.toFixed(3)}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Unsupported({ requirements }: { requirements: readonly string[] }) {
  if (requirements.length === 0) return null;
  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs leading-5 text-ink-muted">
      The current ingredient matrix cannot yet hard-constrain: {requirements.join(", ")}. PigFlow
      reports these explicitly rather than inventing zero values.
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="space-y-1.5">
      <span className="text-xs font-medium uppercase tracking-wide text-ink-faint">{label}</span>
      {children}
    </label>
  );
}
