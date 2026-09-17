"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

/**
 * Keeps the planner behind a sign-in.
 *
 * This is about what a person sees, not about what the plans allow: a browser
 * is the wrong place to enforce anything, and the rules in `firestore.rules`
 * are what actually turn away a caller with no account. What this stops is a
 * signed-out visitor being shown an empty planner and left to wonder why none
 * of their typing saves.
 *
 * With no Firebase project configured there is no sign-in, and the planner opens
 * straight away with its plans kept in the browser.
 */
export default function AuthGate({ children }: { children: ReactNode }) {
  const { user, ready, required } = useAuth();
  const router = useRouter();

  const shutOut = ready && required && !user;

  useEffect(() => {
    if (shutOut) router.replace("/login");
  }, [shutOut, router]);

  if (!ready || shutOut) return <Waiting />;
  return <>{children}</>;
}

function Waiting() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-plane">
      <span className="flex items-center gap-2 text-sm text-ink-faint">
        <LoaderCircle size={15} className="animate-spin" />
        Opening PigFlow…
      </span>
    </main>
  );
}
