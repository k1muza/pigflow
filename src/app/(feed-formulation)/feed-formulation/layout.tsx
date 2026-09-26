import type { ReactNode } from "react";

import AuthGate from "@/components/auth-gate";
import { FeedFormulationShell } from "@/components/feed-formulation-shell";

export default function FeedFormulationLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGate>
      <FeedFormulationShell>{children}</FeedFormulationShell>
    </AuthGate>
  );
}
