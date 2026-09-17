import type { ReactNode } from "react";
import AuthGate from "@/components/auth-gate";
import PlansProvider from "@/components/plans-provider";

/**
 * Everything that reads the plans sits in here, and nothing else does — the
 * sign-in page is outside it, or signing in would need you to be signed in.
 *
 * The group is only for grouping: `(planner)` is in brackets, so it adds
 * nothing to any address. What it buys is one place, above the plan in the
 * address, for the things that must not start over when the plan changes: the
 * sign-in check and the plans themselves.
 */
export default function PlannerLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGate>
      <PlansProvider>{children}</PlansProvider>
    </AuthGate>
  );
}
