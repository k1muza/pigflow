"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";
import { usePlans } from "@/components/plans-provider";
import { planHref } from "@/lib/routes";

/**
 * Sends a visitor who asked for no plan in particular to the last one they had
 * open.
 *
 * Which plan that is only becomes knowable once the shared plans have arrived,
 * so this is a wait rather than a redirect: the address of a plan cannot be
 * guessed from the address of the planner. It stands in for `/` and `/projects`,
 * and it replaces rather than pushes, so the back button leaves the planner
 * instead of bouncing through here again.
 */
export default function OpenLastPlan() {
  const { workspace, hydrated } = usePlans();
  const router = useRouter();
  const openId = hydrated ? workspace.activeId : null;

  useEffect(() => {
    if (openId) router.replace(planHref(openId));
  }, [openId, router]);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-plane">
      <span className="flex items-center gap-2 text-sm text-ink-faint">
        <LoaderCircle size={15} className="animate-spin" />
        Opening your plans…
      </span>
    </main>
  );
}
