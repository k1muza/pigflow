import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { feedFormulationHref } from "@/lib/routes";

const programmes = [
  {
    id: "mature-boar",
    name: "Mature Boar",
    description: "Feeding and nutrient guidance for mature breeding boars.",
    status: "not_loaded",
  },
  {
    id: "developing-gilt",
    name: "Developing Gilt",
    description: "Development feeding programme for replacement gilts before breeding.",
    status: "not_loaded",
  },
  {
    id: "gestating-gilt-sow",
    name: "Gestating Gilt & Sow",
    description: "Gestation feeding and nutrient specifications for gilts and sows.",
    status: "not_loaded",
  },
  {
    id: "lactating-gilt-sow",
    name: "Lactating Gilt & Sow",
    description: "Lactation feeding and nutrient specifications for gilts and sows.",
    status: "not_loaded",
  },
  {
    id: "weaned-sow",
    name: "Weaned Sow",
    description: "Post-weaning feeding management before the next service.",
    status: "not_loaded",
  },
  {
    id: "nursery-pig",
    name: "Nursery Pig",
    description: "Prestart and late-nursery nutrient specifications by liveweight.",
    status: "loaded",
  },
  {
    id: "grow-finish-pig",
    name: "Grow-Finish Pig",
    description: "Grow-finish nutrient specifications from 23 kg through market weight.",
    status: "loaded",
  },
] as const;

export default function FeedProgrammesPage() {
  const loaded = programmes.filter((programme) => programme.status === "loaded").length;

  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Programmes</h1>
          <Badge variant="secondary">{loaded} of {programmes.length} loaded</Badge>
        </div>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-muted">
          PIC&apos;s source material covers several feeding programmes. PigFlow exposes the whole
          source catalogue here while clearly distinguishing programmes whose nutrient data has
          already been encoded.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {programmes.map((programme) => (
          <Card key={programme.id}>
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <CardTitle className="text-base">{programme.name}</CardTitle>
                <Badge variant="secondary">
                  {programme.status === "loaded" ? "Loaded" : "Not loaded"}
                </Badge>
              </div>
              <CardDescription className="leading-6">{programme.description}</CardDescription>
            </CardHeader>
            <CardContent>
              {programme.status === "loaded" ? (
                <Link
                  href={feedFormulationHref("nutrients")}
                  className="text-sm font-medium text-brand hover:underline"
                >
                  View nutrient specifications
                </Link>
              ) : (
                <span className="text-xs text-ink-faint">
                  Source programme identified; nutrient data has not yet been transcribed.
                </span>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
