"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { signInRequired, watchUser, type AppUser } from "@/lib/auth";

type Auth = {
  /** Who is signed in, or null. Always null in a build with no sign-in. */
  user: AppUser | null;
  /** Whether Firebase has finished saying who, if anyone, was already signed in. */
  ready: boolean;
  /** Whether this build asks anyone to sign in at all. */
  required: boolean;
};

const AuthContext = createContext<Auth>({ user: null, ready: !signInRequired, required: signInRequired });

/**
 * Watches who is signed in, once, for the whole app.
 *
 * It sits above the planner rather than inside it so that the header, the guard
 * on the page and the login screen all agree about the same session, and so
 * that a sign-out anywhere is seen everywhere.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Auth>({
    user: null,
    // With no Firebase project there is nothing to wait for and nobody to ask.
    ready: !signInRequired,
    required: signInRequired,
  });

  useEffect(() => {
    if (!signInRequired) return;
    let live = true;
    let stop: (() => void) | undefined;

    watchUser((user, ready) => {
      if (live) setState({ user, ready, required: true });
    }).then((unsubscribe) => {
      if (live) stop = unsubscribe;
      else unsubscribe();
    });

    return () => {
      live = false;
      stop?.();
    };
  }, []);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export function useAuth(): Auth {
  return useContext(AuthContext);
}
