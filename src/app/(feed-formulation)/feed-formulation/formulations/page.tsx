import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FEED_FORMULATIONS } from "@/lib/feed-formulations";
import { feedFormulationHref } from "@/lib/routes";

export default function FeedFormulationsPage() {
  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Formulations</h1>
          <Badge variant="secondary">{FEED_FORMULATIONS.length} saved</Badge>
        </div>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-muted">
          Formulations should be generated from PigFlow&apos;s ingredient data and evaluated against
          a selected Brazilian Tables 2024 requirement phase. No source-company example ration is
          used as a built-in formulation.
        </p>
      </div>

      {FEED_FORMULATIONS.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No static formulations loaded</CardTitle>
            <CardDescription>
              The previous source-company demonstration rations have been removed. The next step is
              to connect the formulation solver so PigFlow can create diets from your available
              ingredients, prices and Brazilian requirement constraints.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link
              href={feedFormulationHref("programmes")}
              className="inline-flex items-center gap-2 text-sm font-medium text-brand hover:underline"
            >
              Browse requirement programmes
              <ArrowRight size={14} />
            </Link>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
