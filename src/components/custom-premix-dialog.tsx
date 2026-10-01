"use client";

import { useState } from "react";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export type CustomPremixDraft = {
  name: string;
  pricePerKg: number;
  inclusionKgPerTonne: number;
  vitamins: {
    vitaminAIuKg?: number;
    vitaminDIuKg?: number;
    vitaminEIuKg?: number;
    vitaminKMgKg?: number;
    vitaminB1MgKg?: number;
    riboflavinMgKg?: number;
    vitaminB6MgKg?: number;
    vitaminB12McgKg?: number;
    pantothenicAcidMgKg?: number;
    niacinMgKg?: number;
    folicAcidMgKg?: number;
    biotinMgKg?: number;
    totalCholineMgKg?: number;
  };
  traceMineralsPpm: {
    zinc?: number;
    iron?: number;
    manganese?: number;
    copper?: number;
    iodine?: number;
    selenium?: number;
  };
};

type FieldSpec = {
  key: string;
  label: string;
  unit: string;
  toInternal?: (value: number) => number;
};

const VITAMIN_FIELDS: readonly FieldSpec[] = [
  { key: "vitaminAIuKg", label: "Vitamin A", unit: "IU/kg premix" },
  { key: "vitaminDIuKg", label: "Vitamin D3", unit: "IU/kg premix" },
  { key: "vitaminEIuKg", label: "Vitamin E", unit: "IU/kg premix" },
  { key: "vitaminKMgKg", label: "Vitamin K3", unit: "mg/kg premix" },
  { key: "vitaminB1MgKg", label: "Vitamin B1", unit: "mg/kg premix" },
  { key: "riboflavinMgKg", label: "Vitamin B2 / riboflavin", unit: "mg/kg premix" },
  { key: "vitaminB6MgKg", label: "Vitamin B6", unit: "mg/kg premix" },
  {
    key: "vitaminB12McgKg",
    label: "Vitamin B12",
    unit: "mg/kg premix",
    toInternal: (value) => value * 1000,
  },
  { key: "pantothenicAcidMgKg", label: "Pantothenic acid", unit: "mg/kg premix" },
  { key: "niacinMgKg", label: "Niacin", unit: "mg/kg premix" },
  { key: "folicAcidMgKg", label: "Folic acid", unit: "mg/kg premix" },
  { key: "biotinMgKg", label: "Biotin", unit: "mg/kg premix" },
  { key: "totalCholineMgKg", label: "Choline", unit: "mg/kg premix" },
];

const TRACE_FIELDS: readonly FieldSpec[] = [
  { key: "zinc", label: "Zinc", unit: "mg/kg premix" },
  { key: "iron", label: "Iron", unit: "mg/kg premix" },
  { key: "manganese", label: "Manganese", unit: "mg/kg premix" },
  { key: "copper", label: "Copper", unit: "mg/kg premix" },
  { key: "iodine", label: "Iodine", unit: "mg/kg premix" },
  { key: "selenium", label: "Selenium", unit: "mg/kg premix" },
];

function parsedOptional(value: string): number | undefined {
  if (value.trim() === "") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error("Nutrient values must be non-negative numbers.");
  }
  return parsed;
}

export function CustomPremixDialog({
  onAdd,
}: {
  onAdd: (premix: CustomPremixDraft) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [inclusion, setInclusion] = useState("10");
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setName("");
    setPrice("");
    setInclusion("10");
    setValues({});
    setError(null);
  }

  function addPremix() {
    try {
      const cleanName = name.trim();
      if (!cleanName) throw new Error("Enter a premix name.");

      const pricePerKg = Number(price);
      if (!Number.isFinite(pricePerKg) || pricePerKg < 0 || price.trim() === "") {
        throw new Error("Enter a valid premix price per kg.");
      }

      const inclusionKgPerTonne = Number(inclusion);
      if (
        !Number.isFinite(inclusionKgPerTonne) ||
        inclusionKgPerTonne <= 0 ||
        inclusionKgPerTonne > 1000
      ) {
        throw new Error("Inclusion must be greater than 0 and no more than 1000 kg/t.");
      }

      const vitamins: CustomPremixDraft["vitamins"] = {};
      for (const field of VITAMIN_FIELDS) {
        const raw = parsedOptional(values[field.key] ?? "");
        if (raw === undefined) continue;
        const value = field.toInternal ? field.toInternal(raw) : raw;
        (vitamins as Record<string, number>)[field.key] = value;
      }

      const traceMineralsPpm: CustomPremixDraft["traceMineralsPpm"] = {};
      for (const field of TRACE_FIELDS) {
        const value = parsedOptional(values[field.key] ?? "");
        if (value === undefined) continue;
        (traceMineralsPpm as Record<string, number>)[field.key] = value;
      }

      if (
        Object.keys(vitamins).length === 0 &&
        Object.keys(traceMineralsPpm).length === 0
      ) {
        throw new Error("Enter at least one guaranteed vitamin or trace-mineral value.");
      }

      onAdd({
        name: cleanName,
        pricePerKg,
        inclusionKgPerTonne,
        vitamins,
        traceMineralsPpm,
      });
      setOpen(false);
      reset();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline">
          <Plus size={15} />
          Add custom premix
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-4xl grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden">
        <DialogHeader className="px-5 pt-5">
          <DialogTitle>Add commercial premix</DialogTitle>
          <DialogDescription>
            Enter the supplier's guaranteed minimum label values. Leave an unknown nutrient blank;
            PigFlow will not assume it is zero. Vitamin B12 is entered in mg/kg exactly as commonly
            printed on premix labels and normalized internally.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 space-y-6 overflow-auto px-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Premix name">
              <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Pig Weaner Premix" />
            </Field>
            <Field label="Price / kg">
              <Input type="number" min="0" step="0.01" value={price} onChange={(event) => setPrice(event.target.value)} placeholder="0.00" />
            </Field>
            <Field label="Inclusion kg / tonne">
              <Input type="number" min="0.001" max="1000" step="0.1" value={inclusion} onChange={(event) => setInclusion(event.target.value)} />
            </Field>
          </div>

          <NutrientGrid
            title="Vitamins"
            fields={VITAMIN_FIELDS}
            values={values}
            onChange={(key, value) => setValues((current) => ({ ...current, [key]: value }))}
          />

          <NutrientGrid
            title="Trace minerals"
            fields={TRACE_FIELDS}
            values={values}
            onChange={(key, value) => setValues((current) => ({ ...current, [key]: value }))}
          />

          {error ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              {error}
            </div>
          ) : null}
        </div>

        <DialogFooter className="border-t border-hairline px-5 py-4">
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={addPremix}>
            Add premix
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NutrientGrid({
  title,
  fields,
  values,
  onChange,
}: {
  title: string;
  fields: readonly FieldSpec[];
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium text-ink">{title}</div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {fields.map((field) => (
          <Field key={field.key} label={field.label} hint={field.unit}>
            <Input
              type="number"
              min="0"
              step="any"
              value={values[field.key] ?? ""}
              placeholder="Unknown"
              onChange={(event) => onChange(field.key, event.target.value)}
            />
          </Field>
        ))}
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="space-y-1.5">
      <span className="flex items-baseline justify-between gap-2 text-xs font-medium uppercase tracking-wide text-ink-faint">
        <span>{label}</span>
        {hint ? <span className="normal-case font-normal">{hint}</span> : null}
      </span>
      {children}
    </label>
  );
}
