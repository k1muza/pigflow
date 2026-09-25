import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const GROUPS = [
  {
    title: "Energy & protein",
    nutrients: [
      ["metabolizable-energy", "Metabolizable Energy", "ME", "kcal/kg", "Energy available after fecal, urinary and gaseous losses."],
      ["net-energy", "Net Energy", "NE", "kcal/kg", "Energy remaining for maintenance and production after heat increment."],
      ["crude-protein", "Crude Protein", "CP", "%", "Total protein estimate derived from nitrogen content."],
    ],
  },
  {
    title: "Amino acids",
    nutrients: [
      ["sid-lysine", "SID Lysine", "SID Lys", "% or g/Mcal", "Standardized ileal digestible lysine; the reference amino acid for ideal-protein ratios."],
      ["sid-methionine-cysteine", "SID Methionine + Cysteine", "SID Met+Cys", "% of diet / Lys ratio", "Digestible sulfur amino acids."],
      ["sid-threonine", "SID Threonine", "SID Thr", "% of diet / Lys ratio", "Standardized ileal digestible threonine."],
      ["sid-tryptophan", "SID Tryptophan", "SID Trp", "% of diet / Lys ratio", "Standardized ileal digestible tryptophan."],
      ["sid-valine", "SID Valine", "SID Val", "% of diet / Lys ratio", "Standardized ileal digestible valine."],
      ["sid-isoleucine", "SID Isoleucine", "SID Ile", "% of diet / Lys ratio", "Standardized ileal digestible isoleucine."],
      ["sid-leucine", "SID Leucine", "SID Leu", "% of diet / Lys ratio", "Standardized ileal digestible leucine."],
      ["sid-histidine", "SID Histidine", "SID His", "% of diet / Lys ratio", "Standardized ileal digestible histidine."],
      ["sid-phenylalanine-tyrosine", "SID Phenylalanine + Tyrosine", "SID Phe+Tyr", "% of diet / Lys ratio", "Combined digestible aromatic amino-acid target."],
    ],
  },
  {
    title: "Macro minerals",
    nutrients: [
      ["calcium", "Calcium", "Ca", "%", "Dietary calcium concentration."],
      ["total-phosphorus", "Total Phosphorus", "P", "%", "Total phosphorus concentration before digestibility adjustment."],
      ["sttd-phosphorus", "STTD Phosphorus", "STTD P", "% or g/Mcal", "Standardized total tract digestible phosphorus."],
      ["available-phosphorus", "Available Phosphorus", "Avail. P", "% or g/Mcal", "Phosphorus estimated to be biologically available."],
      ["sodium", "Sodium", "Na", "%", "Dietary sodium concentration."],
      ["chloride", "Chloride", "Cl", "%", "Dietary chloride concentration."],
    ],
  },
  {
    title: "Trace minerals",
    nutrients: [
      ["zinc", "Zinc", "Zn", "ppm", "Trace-mineral target."],
      ["iron", "Iron", "Fe", "ppm", "Trace-mineral target."],
      ["manganese", "Manganese", "Mn", "ppm", "Trace-mineral target."],
      ["copper", "Copper", "Cu", "ppm", "Trace-mineral target."],
      ["iodine", "Iodine", "I", "ppm", "Trace-mineral target."],
      ["selenium", "Selenium", "Se", "ppm", "Trace-mineral target."],
    ],
  },
  {
    title: "Vitamins",
    nutrients: [
      ["vitamin-a", "Vitamin A", "Vit A", "IU/kg", "Vitamin A specification."],
      ["vitamin-d", "Vitamin D", "Vit D", "IU/kg", "Vitamin D specification."],
      ["vitamin-e", "Vitamin E", "Vit E", "IU/kg", "Vitamin E specification."],
      ["vitamin-k", "Vitamin K", "Vit K", "mg/kg", "Vitamin K specification."],
      ["niacin", "Niacin", "Niacin", "mg/kg", "Niacin specification."],
      ["riboflavin", "Riboflavin", "B2", "mg/kg", "Riboflavin specification."],
      ["pantothenic-acid", "Pantothenic Acid", "B5", "mg/kg", "Pantothenic acid specification."],
      ["vitamin-b12", "Vitamin B12", "B12", "mcg/kg", "Vitamin B12 specification."],
      ["choline", "Total Choline", "Choline", "mg/kg", "Total dietary choline specification."],
    ],
  },
] as const;

export default function FeedNutrientsPage() {
  const count = GROUPS.reduce((total, group) => total + group.nutrients.length, 0);

  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Nutrients</h1>
          <Badge variant="secondary">{count} nutrient concepts</Badge>
        </div>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-muted">
          Reference catalogue of the nutrient concepts used by programmes, ingredients and diet
          validation. Programme-specific target values live under Programmes.
        </p>
      </div>

      {GROUPS.map((group) => (
        <Card key={group.title}>
          <CardHeader>
            <CardTitle className="text-base">{group.title}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {group.nutrients.map(([id, name, shortName, unit, description]) => (
              <div key={id} className="rounded-lg border border-hairline bg-raised/30 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="font-medium text-ink">{name}</div>
                  <Badge variant="secondary">{shortName}</Badge>
                </div>
                <div className="mt-2 text-xs font-mono text-ink-faint">{unit}</div>
                <p className="mt-2 text-xs leading-5 text-ink-muted">{description}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
