"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, LoaderCircle, PiggyBank } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { sendPasswordReset, signInProblem, signInWithEmail } from "@/lib/auth";
import { useAuth } from "@/hooks/use-auth";
import { ThemeToggle } from "@/components/theme-toggle";

type Status = "idle" | "signing-in" | "sending-reset";

export default function LoginPage() {
  const router = useRouter();
  const { user, ready, required } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [problem, setProblem] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // Somebody who is already signed in has no business on this page — including
  // the moment their own sign-in below succeeds.
  useEffect(() => {
    if (ready && (user || !required)) router.replace("/");
  }, [ready, user, required, router]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setProblem(null);
    setNote(null);
    setStatus("signing-in");
    try {
      await signInWithEmail(email, password);
      // The redirect above follows, once Firebase reports the new session.
    } catch (error) {
      console.error("PigFlow could not sign in.", error);
      setProblem(signInProblem(error));
      setStatus("idle");
    }
  }

  async function resetPassword() {
    if (!email.trim()) {
      setProblem("Put your email in first, then ask for a reset.");
      return;
    }
    setProblem(null);
    setStatus("sending-reset");
    try {
      await sendPasswordReset(email);
      // Said the same way whether or not the address has an account, so that
      // this page cannot be used to find out who does.
      setNote("If that address has an account, a reset link is on its way.");
    } catch (error) {
      console.error("PigFlow could not send a password reset.", error);
      setProblem(signInProblem(error));
    }
    setStatus("idle");
  }

  const busy = status !== "idle";

  return (
    <main className="flex min-h-dvh items-center justify-center bg-plane px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-between gap-3">
          <span className="flex items-center gap-2.5">
            <span className="flex size-9 items-center justify-center rounded-xl border border-hairline bg-surface text-ink">
              <PiggyBank size={18} />
            </span>
            <span>
              <span className="block text-sm font-semibold tracking-tight text-ink">PigFlow</span>
              <span className="block text-[11px] text-ink-faint">Piggery planning model</span>
            </span>
          </span>
          <ThemeToggle />
        </div>

        <div className="rounded-2xl border border-hairline bg-surface p-6">
          <h1 className="text-base font-semibold tracking-tight text-ink">Sign in</h1>
          <p className="mt-1.5 text-[13px] leading-5 text-ink-muted">
            The plans are shared by everyone who works on them. Accounts are made for you —
            there is nothing to sign up for here.
          </p>

          <form onSubmit={submit} className="mt-5 space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-medium text-ink-muted">Email</span>
              <Input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="username"
                autoFocus
                required
                disabled={busy}
                className="h-9"
                placeholder="you@farm.example"
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-[13px] font-medium text-ink-muted">Password</span>
              <Input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                required
                disabled={busy}
                className="h-9"
              />
            </label>

            {problem ? (
              <p
                role="alert"
                className="rounded-lg border border-critical/30 bg-critical-soft px-3 py-2 text-[13px] leading-5 text-ink"
              >
                {problem}
              </p>
            ) : null}

            {note ? (
              <p className="rounded-lg border border-hairline bg-raised px-3 py-2 text-[13px] leading-5 text-ink-muted">
                {note}
              </p>
            ) : null}

            <Button type="submit" size="lg" disabled={busy} className="w-full">
              {status === "signing-in" ? (
                <>
                  <LoaderCircle size={14} className="animate-spin" /> Signing in…
                </>
              ) : (
                <>
                  <KeyRound size={14} /> Sign in
                </>
              )}
            </Button>
          </form>

          <button
            type="button"
            onClick={resetPassword}
            disabled={busy}
            className="mt-4 text-xs text-ink-faint underline-offset-4 transition hover:text-ink hover:underline disabled:opacity-50"
          >
            {status === "sending-reset" ? "Sending…" : "Forgotten your password?"}
          </button>
        </div>

        <p className="mt-5 text-center text-xs leading-5 text-ink-faint">
          Need an account? Whoever runs this planner can add you.
        </p>
      </div>
    </main>
  );
}
