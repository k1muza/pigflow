"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, LayoutDashboard, PiggyBank, Wheat } from "lucide-react";

import { ThemeToggle } from "@/components/theme-toggle";
import { feedFormulationHref } from "@/lib/routes";

const NAV = [
  { href: feedFormulationHref(), label: "Dashboard", icon: LayoutDashboard },
  { href: feedFormulationHref("ingredients"), label: "Ingredients", icon: Wheat },
  { href: feedFormulationHref("requirements"), label: "Requirements", icon: BookOpen },
];

export function FeedFormulationShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-dvh bg-plane text-ink">
      <header className="sticky top-0 z-30 border-b border-hairline bg-surface/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-5">
            <Link href={feedFormulationHref()} className="flex items-center gap-2.5">
              <span className="flex size-8 items-center justify-center rounded-lg bg-raised text-ink">
                <Wheat size={18} strokeWidth={1.75} />
              </span>
              <span>
                <span className="block text-sm font-semibold tracking-tight">PigFlow Feed</span>
                <span className="block text-[11px] text-ink-faint">Formulation workspace</span>
              </span>
            </Link>

            <nav className="hidden items-center gap-1 md:flex">
              {NAV.map((item) => {
                const Icon = item.icon;
                const selected =
                  item.href === feedFormulationHref()
                    ? pathname === item.href
                    : pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={selected ? "page" : undefined}
                    className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition ${
                      selected
                        ? "bg-brand-soft font-medium text-brand"
                        : "text-ink-muted hover:bg-raised hover:text-ink"
                    }`}
                  >
                    <Icon size={15} strokeWidth={1.75} />
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/"
              className="inline-flex items-center gap-2 rounded-lg border border-hairline px-3 py-2 text-sm text-ink-muted transition hover:bg-raised hover:text-ink"
            >
              <PiggyBank size={15} strokeWidth={1.75} />
              <span className="hidden sm:inline">Farm planner</span>
            </Link>
            <ThemeToggle />
          </div>
        </div>

        <nav className="flex gap-1 overflow-x-auto border-t border-hairline px-4 py-2 md:hidden">
          {NAV.map((item) => {
            const Icon = item.icon;
            const selected =
              item.href === feedFormulationHref()
                ? pathname === item.href
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`inline-flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm ${
                  selected
                    ? "bg-brand-soft font-medium text-brand"
                    : "text-ink-muted"
                }`}
              >
                <Icon size={15} strokeWidth={1.75} />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </header>

      <main className="mx-auto max-w-[1500px] px-4 py-6 sm:px-6 lg:py-8">{children}</main>
    </div>
  );
}
