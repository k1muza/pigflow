import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FEED_PROGRAMMES } from "@/lib/feed-programmes";
import { feedProgrammeHref } from "@/lib/routes";

export default function FeedProgrammesPage() {
  const loaded = FEED_PROGRAMMES.filter((programme) => programme.status === "loaded").length;

  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Programmes</h1>
          <Badge variant="secondary">
            {loaded} of {FEED_PROGRAMMES.length} loaded
          </Badge>
        </div>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-muted">
          Animal feeding programmes backed by the Brazilian Tables 2024. Growing-pig programmes
          are loaded now; breeder programmes remain placeholders until Chapter 6 is extracted.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {FEED_PROGRAMMES.map((programme) => (
          <Card key={programme.id} className="flex flex-col">
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <CardTitle className="text-base">{programme.name}</CardTitle>
                <Badge variant="secondary">
                  {programme.status === "loaded" ? "Loaded" : "Not loaded"}
                </Badge>
              </div>
              <CardDescription className="leading-6">{programme.description}</CardDescription>
            </CardHeader>
            <CardContent className="mt-auto">
              <Link
                href={feedProgrammeHref(programme.id)}
                className="text-sm font-medium text-brand hover:underline"
              >
                Open programme
              </Link>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
