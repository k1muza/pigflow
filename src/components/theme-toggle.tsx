"use client";

import { useEffect } from "react";
import { Moon, Sun } from "lucide-react";

const STORAGE_KEY = "pigflow-theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

/** Follow operating-system changes until the user makes an explicit choice. */
function followSystemTheme(event: MediaQueryListEvent): void {
  if (window.localStorage.getItem(STORAGE_KEY) !== null) return;
  document.documentElement.classList.toggle("dark", event.matches);
}

export function ThemeToggle({ className = "" }: { className?: string }) {
  useEffect(() => {
    const preference = window.matchMedia(DARK_QUERY);
    preference.addEventListener("change", followSystemTheme);
    return () => preference.removeEventListener("change", followSystemTheme);
  }, []);

  function toggle(): void {
    const dark = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", dark);
    window.localStorage.setItem(STORAGE_KEY, dark ? "dark" : "light");
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Toggle colour theme"
      title="Toggle light and dark mode"
      className={`inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-hairline text-ink-muted transition hover:bg-raised hover:text-ink ${className}`}
    >
      <Moon className="size-4 dark:hidden" aria-hidden="true" />
      <Sun className="hidden size-4 dark:block" aria-hidden="true" />
    </button>
  );
}
