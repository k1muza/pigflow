"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useWorkspace } from "@/hooks/use-workspace";

const SIDEBAR_KEY = "pigflow-sidebar";

/**
 * Everything that has to outlive a change of plan.
 *
 * `/projects/[projectId]` is a route segment, so React takes the shell down and
 * builds it again when the plan in the address changes. Anything held inside it
 * would go with it: a plan started a moment ago and not yet written, the live
 * connection to the shared plans, whether the sidebar was open. All of that
 * belongs above the plan, which is where this sits — one level up, under the
 * sign-in, shared by every page of every plan.
 */
export type Plans = ReturnType<typeof useWorkspace> & {
  sidebarOpen: boolean;
  toggleSidebar: () => void;
};

const PlansContext = createContext<Plans | null>(null);

export function usePlans(): Plans {
  const plans = useContext(PlansContext);
  if (!plans) throw new Error("The planner has to be rendered inside the plans provider.");
  return plans;
}

export default function PlansProvider({ children }: { children: ReactNode }) {
  const workspace = useWorkspace();
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    // Deferred so the first client render matches the server-rendered default.
    const timeout = window.setTimeout(() => {
      const stored = window.localStorage.getItem(SIDEBAR_KEY);
      setSidebarOpen(stored ? stored === "open" : window.innerWidth >= 1024);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  function toggleSidebar() {
    setSidebarOpen((shown) => {
      window.localStorage.setItem(SIDEBAR_KEY, shown ? "closed" : "open");
      return !shown;
    });
  }

  return (
    <PlansContext.Provider value={{ ...workspace, sidebarOpen, toggleSidebar }}>
      {children}
    </PlansContext.Provider>
  );
}
