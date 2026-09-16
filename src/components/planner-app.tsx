"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { addMonths, format, parseISO, subDays } from "date-fns";
import {
  Area,
  AreaChart,
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  type TooltipContentProps,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertTriangle,
  BarChart3,
  BookOpen,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Download,
  Gauge,
  HeartPulse,
  Info,
  Landmark,
  PanelLeftClose,
  PanelLeftOpen,
  PiggyBank,
  RefreshCcw,
  Save,
  Scale,
  Plus,
  Settings2,
  ShieldCheck,
  Syringe,
  Trash2,
  TableProperties,
  WalletCards,
  Wheat,
  X,
} from "lucide-react";

import {
  BENCHMARK_SOURCES,
  calculateProjection,
  cloneDefaultConfig,
  getModelMetrics,
  plannerSchema,
  SERVICES_PER_BOAR_PER_WEEK,
  withConfigDefaults,
  type MonthlyProjection,
  type PeriodSummary,
  type PlannerConfig,
  type PlannerSection,
  type Vaccination,
} from "@/lib/model";
import {
  CATEGORY_LABELS,
  EXPENSE_CATEGORIES,
  farmStateAt,
  farmWeeklyTimeline,
  INCOME_CATEGORIES,
  type CategoryTotals,
  type FarmState,
  type FarmWeekEvent,
  type LedgerCategory,
  type StockAgeGroup,
  type StockKind,
} from "@/lib/sim";

type Tab = "overview" | "simulator" | "inputs" | "cashflow" | "money" | "method";

const STORAGE_KEY = "pigflow-plan-v4";
const SIDEBAR_KEY = "pigflow-sidebar";

const NAV: { id: Tab; label: string; icon: typeof BarChart3 }[] = [
  { id: "overview", label: "Overview", icon: BarChart3 },
  { id: "simulator", label: "Farm simulator", icon: CalendarClock },
  { id: "inputs", label: "Plan inputs", icon: Settings2 },
  { id: "cashflow", label: "Cashflow", icon: TableProperties },
  { id: "money", label: "Money", icon: WalletCards },
  { id: "method", label: "Method & sources", icon: BookOpen },
];

/** Chart palette: one blue for cash, one orange for flows, an ordinal blue ramp for stages. */
const CHART = {
  grid: "#e1e0d9",
  axis: "#898781",
  baseline: "#c3c2b7",
  cash: "#2a78d6",
  flow: "#eb6834",
  stage: {
    piglets: "#86b6ef",
    weaners: "#5598e7",
    growers: "#2a78d6",
    finishers: "#1c5cab",
    gilts: "#104281",
    sows: "#2f855a",
    boars: "#8a5a2b",
  },
} as const;

const TOOLTIP_STYLE = {
  borderRadius: 10,
  border: "1px solid #e1e0d9",
  background: "#ffffff",
  boxShadow: "0 6px 20px rgba(11,11,11,0.08)",
  fontSize: 12,
  color: "#0b0b0b",
} as const;

function money(value: number, currency: string, compact = false) {
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency,
    maximumFractionDigits: compact ? 1 : 0,
    notation: compact ? "compact" : "standard",
  }).format(value);
}

/** Per-kilogram prices need their cents: rounding $3.50 to "$4" is not a price. */
function rate(value: number, currency: string) {
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function number(value: number, digits = 1) {
  return new Intl.NumberFormat("en", { maximumFractionDigits: digits }).format(value);
}

function plural(count: number, noun: string) {
  return `${number(count, 0)} ${noun}${count === 1 ? "" : "s"}`;
}

function toLocalInput(date: Date) {
  return format(date, "yyyy-MM-dd'T'HH:mm");
}

const STOCK_LABELS: Record<StockKind, { singular: string; plural: string }> = {
  sow: { singular: "Sow", plural: "Sows" },
  gilt: { singular: "Gilt", plural: "Gilts" },
  boar: { singular: "Boar", plural: "Boars" },
  piglet: { singular: "Piglet", plural: "Piglets" },
  weaner: { singular: "Weaner", plural: "Weaners" },
  grower: { singular: "Grower", plural: "Growers" },
  finisher: { singular: "Finisher", plural: "Finishers" },
};

function compactAge(ageDays: number) {
  if (ageDays < 112) return `${Math.max(0, Math.round(ageDays / 7))}w`;
  if (ageDays < 730) return `${Math.round(ageDays / 30.4375)}m`;
  return `${number(ageDays / 365.25, 1)}y`;
}

function ageSpan(group: StockAgeGroup) {
  const youngest = compactAge(group.youngestDays);
  const oldest = compactAge(group.oldestDays);
  return youngest === oldest ? `${youngest} old` : `${youngest}–${oldest} old`;
}

function HerdTooltip({ active, label, payload }: TooltipContentProps) {
  if (!active || payload.length === 0) return null;
  const total = payload.reduce((sum, item) => sum + Number(item.value ?? 0), 0);

  return (
    <div className="min-w-48 rounded-xl border border-hairline bg-surface p-3 shadow-xl">
      <p className="text-xs font-semibold text-ink">{label}</p>
      <ul className="mt-2 space-y-1.5">
        {payload.map((item) => (
          <li key={String(item.dataKey)} className="flex items-center justify-between gap-5 text-xs">
            <span className="flex items-center gap-2 text-ink-muted">
              <span
                className="size-2 rounded-full"
                style={{ backgroundColor: item.color ?? item.fill }}
                aria-hidden
              />
              {item.name}
            </span>
            <span className="font-medium tabular-nums text-ink">
              {number(Number(item.value ?? 0), 0)} head
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex items-center justify-between gap-5 border-t border-hairline pt-2 text-xs font-semibold">
        <span>Total herd</span>
        <span className="tabular-nums">{number(total, 0)} head</span>
      </div>
    </div>
  );
}

const WEEK_EVENT_TONES: Record<FarmWeekEvent["type"], string> = {
  vaccination: "bg-accent-soft text-accent",
  service: "bg-warning-soft text-ink-muted",
  farrowing: "bg-good-soft text-good",
  weaning: "bg-good-soft text-good",
  sale: "bg-accent-soft text-accent",
  selection: "bg-plane text-ink-muted",
  promotion: "bg-plane text-ink-muted",
  loss: "bg-critical-soft text-critical",
  cull: "bg-critical-soft text-critical",
  purchase: "bg-warning-soft text-ink-muted",
};

// --------------------------------------------------------------------- pieces

function Field({
  label,
  value,
  onChange,
  suffix,
  hint,
  min = 0,
  max,
  step = 0.1,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  suffix?: string;
  hint?: string;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-medium text-ink-muted">{label}</span>
        {suffix ? <span className="text-[11px] text-ink-faint">{suffix}</span> : null}
      </span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full rounded-lg border border-hairline bg-surface px-3 py-2 text-sm font-medium tabular-nums text-ink outline-none transition focus:border-accent"
      />
      {hint ? <span className="mt-1.5 block text-xs leading-5 text-ink-faint">{hint}</span> : null}
    </label>
  );
}

function TextField({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "date";
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-ink-muted">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-hairline bg-surface px-3 py-2 text-sm font-medium text-ink outline-none transition focus:border-accent"
      />
    </label>
  );
}

function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
  hint,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-ink-muted">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        className="w-full rounded-lg border border-hairline bg-surface px-3 py-2 text-sm font-medium text-ink outline-none transition focus:border-accent"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {hint ? <span className="mt-1.5 block text-xs leading-5 text-ink-faint">{hint}</span> : null}
    </label>
  );
}

function Toggle({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  hint?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-hairline bg-surface px-3 py-2.5">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 size-4 accent-accent"
      />
      <span>
        <span className="block text-[13px] font-medium text-ink">{label}</span>
        {hint ? <span className="mt-0.5 block text-xs leading-5 text-ink-faint">{hint}</span> : null}
      </span>
    </label>
  );
}

function Panel({
  title,
  description,
  action,
  children,
  className = "",
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-xl border border-hairline bg-surface p-5 ${className}`}>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-semibold tracking-tight text-ink">{title}</h3>
          {description ? (
            <p className="mt-1 max-w-2xl text-xs leading-5 text-ink-faint">{description}</p>
          ) : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function SectionCard({
  title,
  description,
  icon: Icon,
  children,
}: {
  title: string;
  description: string;
  icon: typeof PiggyBank;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-hairline bg-surface p-5 lg:p-6">
      <div className="mb-5 flex items-start gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-raised text-ink-muted">
          <Icon size={16} strokeWidth={1.75} />
        </span>
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight text-ink">{title}</h2>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-ink-faint">{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function StatTile({
  label,
  value,
  context,
  tone = "neutral",
}: {
  label: string;
  value: string;
  context?: string;
  tone?: "neutral" | "good" | "critical";
}) {
  const valueTone =
    tone === "good" ? "text-good" : tone === "critical" ? "text-critical" : "text-ink";
  return (
    <div className="rounded-xl border border-hairline bg-surface p-4">
      <p className="text-xs font-medium text-ink-faint">{label}</p>
      <p className={`mt-2 text-2xl font-semibold tracking-tight ${valueTone}`}>{value}</p>
      {context ? <p className="mt-1.5 text-xs leading-5 text-ink-faint">{context}</p> : null}
    </div>
  );
}

// ------------------------------------------------------------------ container

export default function PlannerApp() {
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [config, setConfig] = useState<PlannerConfig>(cloneDefaultConfig);
  const [hydrated, setHydrated] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    // Deferred so the first client render matches the server-rendered defaults.
    const timeout = window.setTimeout(() => {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) {
        try {
          const restored = withConfigDefaults(JSON.parse(stored));
          if (restored) setConfig(restored);
        } catch {
          // Keep safe defaults when saved browser data cannot be parsed.
        }
      }
      const storedSidebar = window.localStorage.getItem(SIDEBAR_KEY);
      setSidebarOpen(storedSidebar ? storedSidebar === "open" : window.innerWidth >= 1024);
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const timeout = window.setTimeout(() => {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
      setSavedAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [config, hydrated]);

  function toggleSidebar() {
    setSidebarOpen((open) => {
      window.localStorage.setItem(SIDEBAR_KEY, open ? "closed" : "open");
      return !open;
    });
  }

  // Simulating a large herd over the horizon costs a few hundred milliseconds, so
  // the inputs stay on the live config and the herd runs against a deferred copy.
  const settledConfig = useDeferredValue(config);
  const validation = useMemo(() => plannerSchema.safeParse(settledConfig), [settledConfig]);
  const projection = useMemo(
    () => (validation.success ? calculateProjection(validation.data) : null),
    [validation],
  );
  const modelMetrics = useMemo(() => getModelMetrics(config), [config]);

  function update<S extends PlannerSection, K extends keyof PlannerConfig[S]>(
    section: S,
    key: K,
    value: PlannerConfig[S][K],
  ) {
    setConfig((current) => ({
      ...current,
      [section]: { ...current[section], [key]: value },
    }));
  }

  function resetPlan() {
    if (window.confirm("Reset all inputs to the evidence-based starter assumptions?")) {
      setConfig(cloneDefaultConfig());
    }
  }

  async function exportExcel() {
    if (!projection || exporting) return;
    setExporting(true);
    try {
      const { buildCashflowWorkbook } = await import("@/lib/export-workbook");
      const output = await buildCashflowWorkbook(config, projection);
      const blob = new Blob([output], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${config.project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-funding-cashflow.xlsx`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (error) {
      console.error(error);
      window.alert("The Excel workbook could not be created. Please try again.");
    } finally {
      setExporting(false);
    }
  }

  const activeLabel = NAV.find((item) => item.id === activeTab)?.label;

  return (
    <div className="flex min-h-screen bg-plane text-ink">
      {sidebarOpen ? (
        <>
          <button
            type="button"
            aria-label="Close navigation"
            onClick={toggleSidebar}
            className="fixed inset-0 z-30 bg-ink/20 lg:hidden"
          />
          <aside className="fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col border-r border-hairline bg-surface lg:sticky lg:top-0 lg:z-auto lg:h-screen">
            <div className="flex items-center justify-between gap-2 px-5 py-5">
              <button
                className="flex items-center gap-2.5 text-left"
                onClick={() => setActiveTab("overview")}
              >
                <span className="flex size-8 items-center justify-center rounded-lg bg-raised text-ink">
                  <PiggyBank size={18} strokeWidth={1.75} />
                </span>
                <span>
                  <span className="block text-sm font-semibold tracking-tight">PigFlow</span>
                  <span className="block text-[11px] text-ink-faint">Piggery planning model</span>
                </span>
              </button>
              <button
                type="button"
                onClick={toggleSidebar}
                aria-label="Hide sidebar"
                className="rounded-md p-1.5 text-ink-faint transition hover:bg-raised hover:text-ink lg:hidden"
              >
                <X size={16} />
              </button>
            </div>

            <nav className="space-y-0.5 px-3">
              {NAV.map((item) => {
                const Icon = item.icon;
                const selected = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      setActiveTab(item.id);
                      if (window.innerWidth < 1024) toggleSidebar();
                    }}
                    aria-current={selected ? "page" : undefined}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition ${
                      selected
                        ? "bg-accent-soft font-medium text-accent"
                        : "text-ink-muted hover:bg-raised hover:text-ink"
                    }`}
                  >
                    <Icon size={16} strokeWidth={1.75} />
                    {item.label}
                  </button>
                );
              })}
            </nav>

            <div className="mt-auto p-4">
              <div className="rounded-lg border border-hairline bg-plane p-3.5">
                <div className="flex items-center gap-2 text-xs font-medium text-ink">
                  <HeartPulse size={14} className="text-ink-faint" strokeWidth={1.75} />
                  Planning support
                </div>
                <p className="mt-1.5 text-[11px] leading-5 text-ink-faint">
                  Validate prices, health plans and production targets with local suppliers and your
                  veterinarian.
                </p>
              </div>
            </div>
          </aside>
        </>
      ) : null}

      <main className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 border-b border-hairline bg-surface/85 px-4 py-3 backdrop-blur sm:px-6">
          <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                onClick={toggleSidebar}
                aria-expanded={sidebarOpen}
                aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
                title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
                className="rounded-lg border border-hairline p-2 text-ink-muted transition hover:bg-raised hover:text-ink"
              >
                {sidebarOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
              </button>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-[11px] text-ink-faint">
                  <span>PigFlow</span>
                  <span>/</span>
                  <span className="text-ink-muted">{activeLabel}</span>
                </div>
                <h1 className="truncate text-sm font-semibold tracking-tight text-ink sm:text-base">
                  {config.project.name}
                </h1>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="hidden items-center gap-1.5 text-xs text-ink-faint sm:flex">
                <Save size={13} />
                {savedAt ? `Saved ${savedAt}` : "Stored on this device"}
              </span>
              <button
                onClick={resetPlan}
                className="inline-flex items-center gap-2 rounded-lg border border-hairline px-3 py-2 text-xs font-medium text-ink-muted transition hover:bg-raised hover:text-ink"
              >
                <RefreshCcw size={13} /> <span className="hidden sm:inline">Reset</span>
              </button>
              <button
                onClick={exportExcel}
                disabled={!projection || exporting}
                className="inline-flex items-center gap-2 rounded-lg bg-ink px-3 py-2 text-xs font-medium text-surface transition hover:bg-ink-muted disabled:opacity-40"
              >
                <Download size={13} /> {exporting ? "Preparing…" : "Export Excel"}
              </button>
            </div>
          </div>
        </header>

        <div className="mx-auto max-w-[1500px] p-4 sm:p-6">
          {!validation.success ? (
            <div className="mb-5 flex gap-3 rounded-xl border border-critical/30 bg-critical-soft p-4 text-sm">
              <AlertTriangle className="mt-0.5 shrink-0 text-critical" size={16} />
              <div>
                <p className="font-medium text-ink">
                  One or more inputs are outside the supported range.
                </p>
                <p className="mt-1 text-ink-muted">
                  Review the highlighted planning assumptions before using the forecast.
                </p>
              </div>
            </div>
          ) : null}

          {activeTab === "overview" && projection ? (
            <Overview config={config} projection={projection} setActiveTab={setActiveTab} />
          ) : null}

          {activeTab === "simulator" && validation.success ? (
            <Simulator config={validation.data} />
          ) : null}

          {activeTab === "inputs" ? (
            <Inputs config={config} update={update} metrics={modelMetrics} />
          ) : null}

          {activeTab === "cashflow" && projection ? (
            <CashflowPreview
              config={config}
              projection={projection}
              exporting={exporting}
              onExport={exportExcel}
            />
          ) : null}

          {activeTab === "money" && projection ? (
            <Money config={config} projection={projection} />
          ) : null}

          {activeTab === "method" ? <Methodology config={config} metrics={modelMetrics} /> : null}
        </div>
      </main>
    </div>
  );
}

// ------------------------------------------------------------------- overview

function Overview({
  config,
  projection,
  setActiveTab,
}: {
  config: PlannerConfig;
  projection: ReturnType<typeof calculateProjection>;
  setActiveTab: (tab: Tab) => void;
}) {
  const [zoom, setZoom] = useState<Granularity>("month");
  const s = projection.summary;
  const currency = config.project.currency;

  // Yearly points keep a multi-year plan readable; monthly shows the swings.
  const cashData =
    zoom === "month"
      ? projection.months.map((row) => ({
          label: row.month,
          closingCash: Math.round(row.closingCash),
          netCashFlow: Math.round(row.netCashFlow),
        }))
      : projection.years.map((year) => ({
          label: year.label,
          closingCash: Math.round(year.closingCash),
          netCashFlow: Math.round(year.netCashFlow),
        }));

  const herdData = projection.months.map((row) => ({
    label: row.month,
    piglets: row.piglets,
    weaners: row.weaners,
    growers: row.growers,
    finishers: row.finishers,
    gilts: row.gilts,
    sows: row.sows,
    boars: Math.max(0, row.breedingStock - row.sows),
  }));

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-hairline bg-surface p-6">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-2xl">
            <div className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-hairline px-2.5 py-1 text-[11px] text-ink-muted">
              <CheckCircle2 size={12} className="text-good" /> Calculation checks passed
            </div>
            <h2 className="text-2xl font-semibold tracking-tight text-ink">
              See the cash gap before it becomes a farm problem.
            </h2>
            <p className="mt-2 text-sm leading-6 text-ink-muted">
              Every sow, boar and growing pig is simulated day by day. Reproduction, mortality,
              weight gain and feed efficiency flow straight into monthly cash.
            </p>
          </div>
          <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm sm:min-w-[300px]">
            <div>
              <dt className="text-xs text-ink-faint">Model horizon</dt>
              <dd className="mt-0.5 font-medium">{config.project.months} months</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-faint">Projected sales</dt>
              <dd className="mt-0.5 font-medium">{number(s.totalPigsSold, 0)} pigs</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-faint">Pigs weaned / sow / year</dt>
              <dd className="mt-0.5 font-medium">{number(s.pigsWeanedPerSowYear, 1)}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-faint">Litters / sow / year</dt>
              <dd className="mt-0.5 font-medium">{number(s.littersPerSowYear, 2)}</dd>
            </div>
          </dl>
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Closing cash"
          value={money(s.closingCash, currency)}
          context={`After ${config.project.months} months, including capital cost.`}
          tone={s.closingCash >= 0 ? "good" : "critical"}
        />
        <StatTile
          label="Peak funding need"
          value={money(s.peakFundingNeed, currency)}
          context={`Lowest cash point: ${money(s.lowestCash, currency)}.`}
          tone={s.peakFundingNeed > 0 ? "critical" : "neutral"}
        />
        <StatTile
          label="Total revenue"
          value={money(s.totalRevenue, currency)}
          context={`${number(s.totalPigsSold, 0)} pigs sold at ${rate(config.finance.salePriceKg, currency)}/kg deadweight.`}
        />
        <StatTile
          label="Feed share"
          value={`${number(s.feedShareOfOperatingCost * 100, 0)}%`}
          context={`${money(s.totalFeedCost, currency)} of feed over the forecast.`}
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(300px,0.75fr)]">
        <Panel
          title="Cash balance and net flows"
          description={currency + " · nominal values · one simulated run of this plan"}
          action={
            <div className="flex rounded-lg border border-hairline p-0.5">
              {(
                [
                  ["month", "Monthly"],
                  ["year", "Yearly"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setZoom(value)}
                  aria-pressed={zoom === value}
                  className={
                    "rounded-md px-2.5 py-1 text-[11px] font-medium transition " +
                    (zoom === value ? "bg-accent-soft text-accent" : "text-ink-muted hover:text-ink")
                  }
                >
                  {label}
                </button>
              ))}
            </div>
          }
        >
          <div className="h-[320px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={cashData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={CHART.grid} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: CHART.axis }}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={28}
                />
                <YAxis
                  tickFormatter={(value) => money(value, currency, true)}
                  tick={{ fontSize: 11, fill: CHART.axis }}
                  tickLine={false}
                  axisLine={false}
                  width={64}
                />
                <Tooltip
                  formatter={(value) => money(Number(value), currency)}
                  cursor={{ fill: "rgba(11,11,11,0.04)" }}
                  contentStyle={TOOLTIP_STYLE}
                />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, paddingTop: 12 }} />
                <ReferenceLine y={0} stroke={CHART.baseline} />
                <Bar
                  dataKey="netCashFlow"
                  name="Monthly net cash"
                  fill={CHART.flow}
                  radius={[3, 3, 0, 0]}
                  maxBarSize={18}
                  isAnimationActive={false}
                />
                <Line
                  dataKey="closingCash"
                  name="Closing cash"
                  stroke={CHART.cash}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 2, stroke: "#ffffff" }}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="What needs attention" description="Checks run against your current inputs.">
          <div className="space-y-2.5">
            {projection.warnings.slice(0, 4).map((warning) => (
              <div
                key={warning.title}
                className={`rounded-lg border p-3 ${
                  warning.level === "attention"
                    ? "border-warning/40 bg-warning-soft"
                    : "border-hairline bg-plane"
                }`}
              >
                <div className="flex gap-2.5">
                  {warning.level === "attention" ? (
                    <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warning" />
                  ) : (
                    <Info size={14} className="mt-0.5 shrink-0 text-ink-faint" />
                  )}
                  <div>
                    <p className="text-[13px] font-medium text-ink">{warning.title}</p>
                    <p className="mt-1 text-xs leading-5 text-ink-muted">{warning.detail}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <button
            onClick={() => setActiveTab("inputs")}
            className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-lg border border-hairline px-4 py-2 text-sm font-medium text-ink-muted transition hover:bg-raised hover:text-ink"
          >
            Review assumptions <ChevronRight size={14} />
          </button>
        </Panel>
      </div>

      <Panel
        title="Whole herd by stage"
        description="All pigs on the farm at each month end, including sows and boars."
      >
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={herdData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={CHART.grid} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: CHART.axis }}
                tickLine={false}
                axisLine={false}
                minTickGap={30}
              />
              <YAxis
                tick={{ fontSize: 11, fill: CHART.axis }}
                tickLine={false}
                axisLine={false}
                width={40}
              />
              <Tooltip content={HerdTooltip} cursor={{ stroke: CHART.baseline }} />
              <Legend
                iconType="circle"
                iconSize={8}
                height={36}
                wrapperStyle={{ fontSize: 12, paddingTop: 12 }}
              />
              {(
                [
                  ["piglets", "Piglets", CHART.stage.piglets],
                  ["weaners", "Weaners", CHART.stage.weaners],
                  ["growers", "Growers", CHART.stage.growers],
                  ["finishers", "Finishers", CHART.stage.finishers],
                  ["gilts", "Gilts", CHART.stage.gilts],
                  ["sows", "Sows", CHART.stage.sows],
                  ["boars", "Boars", CHART.stage.boars],
                ] as const
              ).map(([key, name, color]) => (
                <Area
                  key={key}
                  type="monotone"
                  dataKey={key}
                  stackId="stage"
                  name={name}
                  fill={color}
                  fillOpacity={1}
                  stroke="#ffffff"
                  strokeWidth={2}
                  isAnimationActive={false}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Panel>
    </div>
  );
}

// ------------------------------------------------------------------ simulator

const SOW_STATE_LABELS: Record<FarmState["sows"][number]["state"], string> = {
  gestating: "In pig",
  lactating: "Suckling",
  open: "Awaiting service",
};

function Simulator({ config }: { config: PlannerConfig }) {
  const start = parseISO(config.project.startDate);
  const end = addMonths(start, config.project.months);
  const currency = config.project.currency;

  const [instant, setInstant] = useState(() => toLocalInput(start));
  const [stockFilter, setStockFilter] = useState<"all" | StockKind>("all");
  const [drawerOpen, setDrawerOpen] = useState(false);

  // A new plan can move the horizon out from under the chosen moment.
  const clamped = useMemo(() => {
    const min = start.getTime();
    const max = subDays(end, 1).getTime();
    const chosen = parseISO(instant).getTime();
    if (Number.isNaN(chosen)) return toLocalInput(start);
    if (chosen < min) return toLocalInput(start);
    if (chosen > max) return toLocalInput(subDays(end, 1));
    return instant;
  }, [instant, start, end]);

  const state = useMemo(() => farmStateAt(config, clamped), [config, clamped]);
  const timeline = useMemo(() => farmWeeklyTimeline(config), [config]);
  const selectedWeek = Math.min(
    timeline.length,
    Math.max(1, Math.floor(Math.max(state.day, 0) / 7) + 1),
  );

  useEffect(() => {
    if (!drawerOpen) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawerOpen(false);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [drawerOpen]);

  const presets: { label: string; value: string }[] = [
    { label: "Start", value: toLocalInput(start) },
    { label: "6 months", value: toLocalInput(addMonths(start, 6)) },
    { label: "1 year", value: toLocalInput(addMonths(start, 12)) },
    { label: "2 years", value: toLocalInput(addMonths(start, 24)) },
    { label: "Horizon end", value: toLocalInput(subDays(end, 1)) },
  ].filter((preset) => parseISO(preset.value).getTime() <= subDays(end, 1).getTime());

  const stages = [
    { key: "piglets", label: "Piglets", count: state.herd.piglets, color: CHART.stage.piglets },
    { key: "weaners", label: "Weaners", count: state.herd.weaners, color: CHART.stage.weaners },
    { key: "growers", label: "Growers", count: state.herd.growers, color: CHART.stage.growers },
    {
      key: "finishers",
      label: "Finishers",
      count: state.herd.finishers,
      color: CHART.stage.finishers,
    },
    { key: "gilts", label: "Gilts", count: state.herd.gilts, color: CHART.stage.gilts },
  ];
  const growingTotal = Math.max(state.herd.growingTotal, 1);

  const costLines = EXPENSE_CATEGORIES.map((category) => ({
    label: CATEGORY_LABELS[category],
    amount: state.finance.totals[category],
  }));
  const incomeLines = INCOME_CATEGORIES.map((category) => ({
    label: CATEGORY_LABELS[category],
    amount: state.finance.totals[category],
  }));
  const stockGroups = useMemo(
    () =>
      (Object.keys(STOCK_LABELS) as StockKind[]).flatMap((kind) => {
        const animals = state.stock.filter((animal) => animal.kind === kind);
        if (animals.length === 0) return [];
        const ages = animals.reduce(
          (range, animal) => ({
            youngest: Math.min(range.youngest, animal.ageDays),
            oldest: Math.max(range.oldest, animal.ageDays),
          }),
          { youngest: Number.POSITIVE_INFINITY, oldest: Number.NEGATIVE_INFINITY },
        );
        return [
          {
            kind,
            count: animals.length,
            youngestDays: ages.youngest,
            oldestDays: ages.oldest,
          },
        ];
      }),
    [state.stock],
  );
  const filteredStock =
    stockFilter === "all" ? state.stock : state.stock.filter((animal) => animal.kind === stockFilter);
  const selectedTimelineWeek = timeline[selectedWeek - 1];

  function openWeek(week: (typeof timeline)[number]) {
    setInstant(`${week.date}T23:00`);
    setStockFilter("all");
    setDrawerOpen(true);
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-ink">Farm simulator</h2>
        <p className="mt-1.5 max-w-3xl text-sm leading-6 text-ink-muted">
          Pick any date and time inside the plan. The herd is rebuilt animal by animal up to that
          moment, so the stock numbers and the money are the same farm seen from one instant.
        </p>
      </div>

      <Panel
        title="Weekly stock timeline"
        description="Stock standing at each week end. Select a row to open its stock and activity details."
        action={
          <span className="rounded-full bg-plane px-2.5 py-1 text-xs font-medium text-ink-muted">
            {timeline.length} weeks
          </span>
        }
      >
        <div className="max-h-[540px] overflow-y-auto rounded-lg border border-hairline">
          <ul className="divide-y divide-hairline" aria-label="Farm stock by week">
            {timeline.map((week) => {
              const selected = week.week === selectedWeek;
              return (
                <li key={week.week}>
                  <button
                    type="button"
                    onClick={() => openWeek(week)}
                    className={`flex w-full items-center gap-4 px-4 py-3 text-left transition ${
                      selected ? "bg-accent-soft" : "bg-surface hover:bg-plane"
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className={`block text-sm font-semibold ${selected ? "text-accent" : "text-ink"}`}>
                        Week {week.week} - {number(week.total, 0)} head
                      </span>
                      <span className="mt-0.5 block text-xs text-ink-faint">
                        {format(parseISO(week.startDate), "d MMM")}–{format(parseISO(week.date), "d MMM yyyy")}
                      </span>
                    </span>
                    <span className="hidden text-xs text-ink-faint sm:block">
                      {week.events.length === 0
                        ? "No herd events"
                        : `${week.events.length} ${week.events.length === 1 ? "event" : "events"}`}
                    </span>
                    <ChevronRight size={16} className={selected ? "text-accent" : "text-ink-faint"} />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </Panel>

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-hairline bg-surface p-4">
        <label className="block">
          <span className="mb-1.5 block text-[13px] font-medium text-ink-muted">Date and time</span>
          <input
            type="datetime-local"
            value={clamped}
            min={toLocalInput(start)}
            max={toLocalInput(subDays(end, 1))}
            onChange={(event) => setInstant(event.target.value)}
            className="rounded-lg border border-hairline bg-surface px-3 py-2 text-sm font-medium text-ink outline-none transition focus:border-accent"
          />
        </label>
        <div className="flex flex-wrap gap-1.5">
          {presets.map((preset) => (
            <button
              key={preset.label}
              onClick={() => setInstant(preset.value)}
              className={`rounded-lg border px-3 py-2 text-xs font-medium transition ${
                clamped === preset.value
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-hairline text-ink-muted hover:bg-raised hover:text-ink"
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <p className="ml-auto text-xs text-ink-faint">
          Day {state.day + 1} of the plan · {format(parseISO(state.date), "EEEE d MMMM yyyy")}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Pigs on the farm"
          value={number(state.herd.total, 0)}
          context={`${state.herd.growingTotal} growing · ${plural(state.herd.sows, "sow")} · ${plural(state.herd.boars, "boar")}`}
        />
        <StatTile
          label="Liveweight on hand"
          value={`${number(state.herd.liveweightKg, 0)} kg`}
          context={`Finishers average ${number(state.herd.averageWeightKg.finisher, 1)} kg.`}
        />
        <StatTile
          label="Cash"
          value={money(state.finance.cash, currency)}
          context={`Opened at ${money(state.finance.openingCash, currency)}.`}
          tone={state.finance.cash >= 0 ? "good" : "critical"}
        />
        <StatTile
          label="Net worth"
          value={money(state.finance.netWorth, currency)}
          context={`Cash plus ${money(state.finance.herdValue, currency)} of stock on hand.`}
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
        <Panel
          title="Herd on this date"
          description="Counted from the individual animals standing on the farm."
        >
          <div className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full">
            {stages.map((stage) => (
              <span
                key={stage.key}
                style={{
                  width: `${(stage.count / growingTotal) * 100}%`,
                  backgroundColor: stage.color,
                }}
                className="block first:rounded-l-full last:rounded-r-full"
              />
            ))}
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
            {stages.map((stage) => (
              <div key={stage.key} className="rounded-lg border border-hairline p-3">
                <dt className="flex items-center gap-1.5 text-xs text-ink-faint">
                  <span
                    className="size-2 rounded-full"
                    style={{ backgroundColor: stage.color }}
                    aria-hidden
                  />
                  {stage.label}
                </dt>
                <dd className="mt-1.5 text-lg font-semibold tracking-tight">{stage.count}</dd>
                <dd className="text-xs text-ink-faint">
                  {number(
                    state.herd.averageWeightKg[
                      stage.key.slice(0, -1) as keyof typeof state.herd.averageWeightKg
                    ],
                    1,
                  )}{" "}
                  kg average
                </dd>
              </div>
            ))}
          </dl>

          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {[
              ["Sows in pig", String(state.herd.gestatingSows)],
              ["Sows suckling", String(state.herd.lactatingSows)],
              ["Sows to serve", String(state.herd.openSows)],
              ["Sow places used", state.herd.sows + " of " + state.herd.maxSows],
              ["Replacement gilts coming", String(state.herd.replacementPipeline)],
              ["Boars", String(state.herd.boars)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg bg-plane p-3">
                <p className="text-xs text-ink-faint">{label}</p>
                <p className="mt-1 text-lg font-semibold tracking-tight">{value}</p>
              </div>
            ))}
          </div>
        </Panel>

        <Panel
          title="Financial standing"
          description={`Everything posted to the ledger between the start date and ${format(parseISO(state.date), "d MMM yyyy")}.`}
        >
          <table className="w-full text-sm">
            <tbody>
              {incomeLines.map((line) => (
                <tr key={line.label} className="border-b border-hairline last:border-0">
                  <td className="py-1.5 text-ink-muted">{line.label}</td>
                  <td className="py-1.5 text-right tabular-nums">
                    {money(line.amount, currency)}
                  </td>
                </tr>
              ))}
              <tr className="border-y border-hairline">
                <td className="py-2 font-medium">Income to date</td>
                <td className="py-2 text-right font-medium tabular-nums">
                  {money(state.finance.income, currency)}
                </td>
              </tr>
              {costLines.map((line) => (
                <tr key={line.label} className="border-b border-hairline">
                  <td className="py-1.5 text-ink-muted">{line.label}</td>
                  <td className="py-1.5 text-right tabular-nums">
                    {money(line.amount, currency)}
                  </td>
                </tr>
              ))}
              <tr className="border-b border-hairline">
                <td className="py-2 font-medium">Costs to date</td>
                <td className="py-2 text-right font-medium tabular-nums">
                  {money(state.finance.expenses, currency)}
                </td>
              </tr>
              <tr>
                <td className="py-2 font-medium">Cash on hand</td>
                <td
                  className={`py-2 text-right font-semibold tabular-nums ${
                    state.finance.cash < 0 ? "text-critical" : ""
                  }`}
                >
                  {money(state.finance.cash, currency)}
                </td>
              </tr>
            </tbody>
          </table>
          <p className="mt-3 text-xs leading-5 text-ink-faint">
            Last 30 days: {money(state.finance.last30Days.income, currency)} in,{" "}
            {money(state.finance.last30Days.expenses, currency)} out, net{" "}
            <span className={state.finance.last30Days.net < 0 ? "text-critical" : "text-good"}>
              {money(state.finance.last30Days.net, currency)}
            </span>
            .
          </p>
        </Panel>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
        <Panel
          title="Generations on the farm"
          description="Founding stock is generation 0. Every piglet is one past its dam, so overlapping generations breed side by side."
        >
          <div className="overflow-hidden rounded-lg border border-hairline">
            <table className="w-full text-sm">
              <thead className="border-b border-hairline bg-plane text-left text-xs text-ink-muted">
                <tr>
                  {["Generation", "Born", "On the farm", "Breeding", "Sold", "Lost"].map(
                    (heading, index) => (
                      <th
                        key={heading}
                        className={
                          "whitespace-nowrap px-3 py-2 font-medium " +
                          (index > 0 ? "text-right" : "")
                        }
                      >
                        {heading}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {state.generations.map((row) => (
                  <tr key={row.generation} className="border-b border-hairline last:border-0">
                    <td className="px-3 py-2 font-medium">
                      {row.generation === 0 ? "Founding stock" : "Generation " + row.generation}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-muted">
                      {number(row.born, 0)}
                    </td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums">
                      {number(row.alive, 0)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-muted">
                      {number(row.breedingFemales, 0)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-muted">
                      {number(row.sold, 0)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-muted">
                      {number(row.died, 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs leading-5 text-ink-faint">
            {plural(state.generations.filter((row) => row.alive > 0).length, "generation")} standing
            on the farm on this date.
          </p>
        </Panel>

        <Panel
          title="What a market pig costs"
          description="Averaged over every pig sold so far. The stage bars are the pig's own bill; the breeding herd it came out of is carried underneath."
        >
          <div className="space-y-2">
            {(
              [
                ["piglet", "Farrowing house"],
                ["weaner", "Weaner"],
                ["grower", "Grower"],
                ["finisher", "Finisher"],
              ] as const
            ).map(([stage, label]) => {
              const amount = state.costOfProduction.directByStage[stage];
              const share = state.costOfProduction.directPerPig
                ? (amount / state.costOfProduction.directPerPig) * 100
                : 0;
              return (
                <div key={stage}>
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="text-ink-muted">{label}</span>
                    <span className="tabular-nums">{money(amount, currency)}</span>
                  </div>
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-raised">
                    <span
                      className="block h-full rounded-full"
                      style={{
                        width: share + "%",
                        backgroundColor: CHART.stage[(stage + "s") as keyof typeof CHART.stage],
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <table className="mt-5 w-full text-sm">
            <tbody>
              {(
                [
                  ["Direct cost per pig", state.costOfProduction.directPerPig],
                  ["Breeding herd share", state.costOfProduction.breedingCostPerPig],
                  ["Share of overheads", state.costOfProduction.allocatedOverheadPerPig],
                  ["Full cost per pig", state.costOfProduction.fullCostPerPig],
                  ["Sold for", state.costOfProduction.revenuePerPig],
                ] as const
              ).map(([label, amount], index) => (
                <tr key={label} className="border-b border-hairline">
                  <td className={"py-1.5 " + (index === 3 ? "font-medium" : "text-ink-muted")}>
                    {label}
                  </td>
                  <td
                    className={
                      "py-1.5 text-right tabular-nums " + (index === 3 ? "font-medium" : "")
                    }
                  >
                    {money(amount, currency)}
                  </td>
                </tr>
              ))}
              <tr>
                <td className="py-2 font-medium">Margin per pig</td>
                <td
                  className={
                    "py-2 text-right font-semibold tabular-nums " +
                    (state.costOfProduction.marginPerPig < 0 ? "text-critical" : "text-good")
                  }
                >
                  {money(state.costOfProduction.marginPerPig, currency)}
                </td>
              </tr>
            </tbody>
          </table>
          <p className="mt-3 text-xs leading-5 text-ink-faint">
            {rate(state.costOfProduction.fullCostPerDeadweightKg, currency)} per kg deadweight
            against a {rate(config.finance.salePriceKg, currency)} price, over{" "}
            {plural(state.costOfProduction.pigsSold, "pig")} sold at{" "}
            {number(state.costOfProduction.averageSaleWeightKg, 1)} kg live /{" "}
            {number(state.costOfProduction.averageDeadweightKg, 1)} kg carcass.
          </p>
        </Panel>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
        <Panel
          title="Breeding herd"
          description="Each row is one sow object. A home-bred sow keeps the ear tag she was born with."
        >
          <div className="max-h-[420px] overflow-auto rounded-lg border border-hairline">
            <table className="w-full min-w-[600px] text-sm">
              <thead className="sticky top-0 bg-plane text-left text-xs text-ink-faint">
                <tr>
                  {["Tag", "Bred", "Status", "Parity", "Age", "Litter", "Weaned", "Next"].map((heading) => (
                    <th key={heading} className="whitespace-nowrap px-3 py-2 font-medium">
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {state.sows.map((sow) => (
                  <tr key={sow.tag} className="border-t border-hairline">
                    <td className="whitespace-nowrap px-3 py-2 font-medium">{sow.tag}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-ink-faint">
                      {sow.homeBred ? "Home gen " + sow.generation : "Founding"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-ink-muted">
                      {SOW_STATE_LABELS[sow.state]}
                    </td>
                    <td className="px-3 py-2 tabular-nums">{sow.parity}</td>
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums text-ink-muted">
                      {number(sow.ageMonths, 0)} mo
                    </td>
                    <td className="px-3 py-2 tabular-nums">{sow.litterSize || "—"}</td>
                    <td className="px-3 py-2 tabular-nums text-ink-muted">{sow.totalWeaned}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-ink-muted">
                      {sow.nextEvent} in {sow.daysToNextEvent ?? 0}d
                    </td>
                  </tr>
                ))}
                {state.sows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-3 py-6 text-center text-ink-faint">
                      No breeding females on the farm on this date.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </Panel>

        <div className="space-y-5">
          <Panel title="Since the plan started" description="Cumulative production to this moment.">
            <dl className="grid grid-cols-2 gap-3">
              {[
                ["Litters farrowed", number(state.lifetime.litters, 0)],
                ["Piglets born alive", number(state.lifetime.bornAlive, 0)],
                ["Piglets weaned", number(state.lifetime.weaned, 0)],
                ["Pigs sold", number(state.lifetime.sold, 0)],
                ["Pre-weaning losses", number(state.lifetime.pigletDeaths, 0)],
                ["Post-weaning losses", number(state.lifetime.growingDeaths, 0)],
                ["Sows culled", number(state.lifetime.sowsCulled, 0)],
                ["Replacements bought", number(state.lifetime.giltsPurchased, 0)],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg bg-plane p-3">
                  <dt className="text-xs text-ink-faint">{label}</dt>
                  <dd className="mt-1 text-base font-semibold tracking-tight">{value}</dd>
                </div>
              ))}
            </dl>
          </Panel>

          <Panel title="Latest events" description="What the farm did just before this moment.">
            <ol className="space-y-2.5">
              {state.recentEvents.map((event, index) => (
                <li key={`${event.day}-${index}`} className="flex gap-3 text-sm">
                  <span className="w-20 shrink-0 text-xs tabular-nums text-ink-faint">
                    {format(parseISO(event.date), "d MMM yy")}
                  </span>
                  <span className="text-ink-muted">{event.message}</span>
                </li>
              ))}
              {state.recentEvents.length === 0 ? (
                <li className="text-sm text-ink-faint">Nothing has happened yet on this plan.</li>
              ) : null}
            </ol>
          </Panel>
        </div>
      </div>

      {drawerOpen && selectedTimelineWeek ? (
        <>
          <button
            type="button"
            aria-label="Close week details"
            onClick={() => setDrawerOpen(false)}
            className="fixed inset-0 z-40 cursor-default bg-black/25"
          />
          <aside
            role="dialog"
            aria-modal="true"
            aria-labelledby="week-drawer-title"
            className="fixed inset-y-0 right-0 z-50 flex w-full max-w-2xl flex-col border-l border-hairline bg-surface shadow-2xl"
          >
            <header className="flex shrink-0 items-start justify-between gap-4 border-b border-hairline px-5 py-4 sm:px-6">
              <div>
                <p className="text-xs font-medium text-accent">Farm stock timeline</p>
                <h3 id="week-drawer-title" className="mt-1 text-xl font-semibold tracking-tight text-ink">
                  Week {selectedWeek} - {number(state.stock.length, 0)} head
                </h3>
                <p className="mt-1 text-xs text-ink-faint">
                  {format(parseISO(selectedTimelineWeek.startDate), "d MMM")}–{format(parseISO(selectedTimelineWeek.date), "d MMM yyyy")}
                </p>
              </div>
              <button
                type="button"
                aria-label="Close week details"
                onClick={() => setDrawerOpen(false)}
                className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-hairline text-ink-muted transition hover:bg-plane hover:text-ink"
              >
                <X size={17} />
              </button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto">
              <section className="border-b border-hairline px-5 py-5 sm:px-6">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <h4 className="text-sm font-semibold text-ink">Events this week</h4>
                    <p className="mt-0.5 text-xs text-ink-faint">Work and herd movements recorded by the simulation.</p>
                  </div>
                  <span className="rounded-full bg-plane px-2.5 py-1 text-xs text-ink-muted">
                    {selectedTimelineWeek.events.length}
                  </span>
                </div>
                {selectedTimelineWeek.events.length > 0 ? (
                  <ul className="space-y-2">
                    {selectedTimelineWeek.events.map((event, index) => (
                      <li
                        key={`${event.type}-${index}`}
                        className="flex items-center gap-3 rounded-lg border border-hairline px-3 py-2.5"
                      >
                        <span
                          className={`size-2.5 shrink-0 rounded-full ${WEEK_EVENT_TONES[event.type]}`}
                          aria-hidden
                        />
                        <span className="text-sm font-medium text-ink">{event.label}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="rounded-lg bg-plane px-4 py-5 text-sm text-ink-faint">
                    No vaccinations, services, sales, births, weaning, purchases, or losses this week.
                  </div>
                )}
              </section>

              <section className="px-5 py-5 sm:px-6">
                <div className="mb-4">
                  <h4 className="text-sm font-semibold text-ink">Available stock</h4>
                  <p className="mt-0.5 text-xs text-ink-faint">
                    Every live animal at week end, including its age and current status.
                  </p>
                </div>

                <div className="mb-4 flex flex-wrap gap-2" aria-label="Filter available stock">
                  <button
                    type="button"
                    onClick={() => setStockFilter("all")}
                    className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                      stockFilter === "all"
                        ? "border-accent bg-accent text-white"
                        : "border-hairline text-ink-muted hover:bg-plane"
                    }`}
                  >
                    All {state.stock.length}
                  </button>
                  {stockGroups.map((group) => (
                    <button
                      key={group.kind}
                      type="button"
                      onClick={() => setStockFilter(group.kind)}
                      className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                        stockFilter === group.kind
                          ? "border-accent bg-accent text-white"
                          : "border-hairline text-ink-muted hover:bg-plane"
                      }`}
                    >
                      {STOCK_LABELS[group.kind].plural} {group.count} · {ageSpan(group)}
                    </button>
                  ))}
                </div>

                <div className="overflow-hidden rounded-lg border border-hairline">
                  <div className="divide-y divide-hairline">
                    {filteredStock.map((animal) => (
                      <div key={animal.tag} className="flex items-start justify-between gap-4 px-3 py-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-ink">
                            {animal.tag}
                            <span className="ml-2 font-normal text-ink-muted">
                              {STOCK_LABELS[animal.kind].singular}
                            </span>
                          </p>
                          <p className="mt-1 text-xs capitalize text-ink-faint">
                            {animal.sex} · {animal.status} · generation {animal.generation}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-sm font-semibold tabular-nums text-ink">
                            {compactAge(animal.ageDays)}
                          </p>
                          <p className="mt-1 text-xs tabular-nums text-ink-faint">
                            {number(animal.weightKg, 1)} kg · {number(animal.ageDays, 0)}d
                          </p>
                        </div>
                      </div>
                    ))}
                    {filteredStock.length === 0 ? (
                      <p className="px-4 py-8 text-center text-sm text-ink-faint">
                        No stock in this category for Week {selectedWeek}.
                      </p>
                    ) : null}
                  </div>
                </div>
              </section>
            </div>
          </aside>
        </>
      ) : null}
    </div>
  );
}

// --------------------------------------------------------------------- inputs

function Inputs({
  config,
  update,
  metrics,
}: {
  config: PlannerConfig;
  update: <S extends PlannerSection, K extends keyof PlannerConfig[S]>(
    section: S,
    key: K,
    value: PlannerConfig[S][K],
  ) => void;
  metrics: ReturnType<typeof getModelMetrics>;
}) {
  function updateVaccination(index: number, patch: Partial<Vaccination>) {
    const next = config.health.vaccinations.map((dose, position) =>
      position === index ? { ...dose, ...patch } : dose,
    );
    update("health", "vaccinations", next);
  }

  function removeVaccination(index: number) {
    update(
      "health",
      "vaccinations",
      config.health.vaccinations.filter((_, position) => position !== index),
    );
  }

  function addVaccination() {
    update("health", "vaccinations", [
      ...config.health.vaccinations,
      { id: "dose-" + Date.now(), name: "New treatment", ageDays: 28, costPerPig: 0.5 },
    ]);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-ink">Build from your farm facts</h2>
          <p className="mt-1.5 max-w-2xl text-sm leading-6 text-ink-muted">
            Benchmark notes are starting points, not promises. Replace them with your records,
            supplier quotes and local veterinary plan.
          </p>
        </div>
        <div className="rounded-lg border border-hairline bg-surface px-4 py-3 text-xs text-ink-muted">
          <span className="font-medium text-ink">Expected:</span>{" "}
          {number(metrics.littersPerSowYear, 2)} litters/sow/year ·{" "}
          {number(metrics.pigsWeanedPerSowYear, 1)} pigs weaned/sow/year
        </div>
      </div>

      <SectionCard
        title="Planning frame"
        description="Time period, currency and opening funds. Calendar days are calculated automatically."
        icon={WalletCards}
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="md:col-span-2">
            <TextField
              label="Project name"
              value={config.project.name}
              onChange={(value) => update("project", "name", value)}
            />
          </div>
          <TextField
            label="Start month"
            type="date"
            value={config.project.startDate}
            onChange={(value) => update("project", "startDate", value)}
          />
          <SelectField
            label="Currency"
            value={config.project.currency}
            onChange={(value) => update("project", "currency", value)}
            options={[
              { value: "USD", label: "USD" },
              { value: "ZAR", label: "ZAR" },
              { value: "GBP", label: "GBP" },
              { value: "EUR", label: "EUR" },
            ]}
          />
          <Field
            label="Forecast length"
            value={config.project.months}
            onChange={(v) => update("project", "months", v)}
            suffix="months"
            min={12}
            max={60}
            step={1}
          />
          <Field
            label="Opening cash"
            value={config.project.openingCash}
            onChange={(v) => update("project", "openingCash", v)}
            suffix={config.project.currency}
            min={-10000000}
            step={100}
          />
          <Field
            label="Initial capital costs"
            value={config.finance.initialCapitalCosts}
            onChange={(v) => update("finance", "initialCapitalCosts", v)}
            suffix={config.project.currency}
            step={100}
            hint="Pens, equipment and setup paid in month one."
          />
          <Field
            label="Scenario seed"
            value={config.project.seed}
            onChange={(v) => update("project", "seed", Math.round(v))}
            min={1}
            max={1000000}
            step={1}
            hint="Litter size, conception and mortality are drawn at random. Change the seed to replay the same plan with different luck."
          />
        </div>
      </SectionCard>

      <SectionCard
        title="Animals on hand"
        description="Starting growing pigs are spread evenly through their stage rather than bunched on one date."
        icon={PiggyBank}
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <Field
            label="Breeding sows"
            value={config.stock.sows}
            onChange={(v) => update("stock", "sows", v)}
            suffix="head"
            step={1}
          />
          <Field
            label="Maiden gilts"
            value={config.stock.gilts}
            onChange={(v) => update("stock", "gilts", v)}
            suffix="head"
            step={1}
            hint="Start from two gilts and the farm will grow its own herd up to the sow places."
          />
          <Field
            label="Boars"
            value={config.stock.boars}
            onChange={(v) => update("stock", "boars", v)}
            suffix="head"
            step={1}
            hint={`Each boar covers about ${SERVICES_PER_BOAR_PER_WEEK} services a week.`}
          />
          <Field
            label="Weaners"
            value={config.stock.weaners}
            onChange={(v) => update("stock", "weaners", v)}
            suffix="head"
            step={1}
          />
          <Field
            label="Growers"
            value={config.stock.growers}
            onChange={(v) => update("stock", "growers", v)}
            suffix="head"
            step={1}
          />
          <Field
            label="Finishers"
            value={config.stock.finishers}
            onChange={(v) => update("stock", "finishers", v)}
            suffix="head"
            step={1}
          />
        </div>
      </SectionCard>

      <SectionCard
        title="Sow places and gilt policy"
        description="How many sows the farm can carry, how the herd starts, and how replacement gilts are found."
        icon={Landmark}
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Field
            label="Maximum sows"
            value={config.herd.maxSows}
            onChange={(v) => update("herd", "maxSows", Math.round(v))}
            suffix="places"
            min={1}
            max={5000}
            step={1}
            hint="The herd grows towards this and never past it. Gilts that mature with no place are sold."
          />
          <SelectField
            label="Herd at the start date"
            value={config.herd.startMode}
            onChange={(value) => update("herd", "startMode", value)}
            options={[
              { value: "staggered", label: "Running herd, spread across the cycle" },
              { value: "synchronised", label: "All sows served on day one" },
            ]}
            hint="A running herd already has sows in pig and piglets on the ground."
          />
          <Field
            label="Cull after parity"
            value={config.herd.cullAfterParity}
            onChange={(v) => update("herd", "cullAfterParity", Math.round(v))}
            suffix="litters"
            min={1}
            max={12}
            step={1}
          />
          <Field
            label="Sow & boar mortality"
            value={config.herd.sowAnnualMortalityPct}
            onChange={(v) => update("herd", "sowAnnualMortalityPct", v)}
            suffix="% per year"
            max={100}
          />
          <Field
            label="Gilt selection weight"
            value={config.herd.giltSelectionWeightKg}
            onChange={(v) => update("herd", "giltSelectionWeightKg", v)}
            suffix="kg"
            min={15}
            max={90}
            hint="Female pigs are picked out for breeding at this weight instead of going on to market."
          />
          <Field
            label="Gilt service weight"
            value={config.herd.giltServiceWeightKg}
            onChange={(v) => update("herd", "giltServiceWeightKg", v)}
            suffix="kg"
            min={90}
            max={180}
            hint="Common guidance puts a first service at 135–170 kg."
          />
          <Field
            label="Gilt service age"
            value={config.herd.giltServiceAgeDays}
            onChange={(v) => update("herd", "giltServiceAgeDays", v)}
            suffix="days"
            min={180}
            max={400}
            step={5}
            hint="Commonly 220–270 days. She joins the herd only once both her weight and her age are met."
          />
          <Field
            label="Replacement gilt cost"
            value={config.herd.giltPurchaseCost}
            onChange={(v) => update("herd", "giltPurchaseCost", v)}
            suffix={config.project.currency}
            step={10}
          />
          <Field
            label="Cull sow value"
            value={config.herd.cullSowSaleValue}
            onChange={(v) => update("herd", "cullSowSaleValue", v)}
            suffix={config.project.currency}
            step={10}
          />
          <Field
            label="Surplus gilt value"
            value={config.herd.surplusGiltSaleValue}
            onChange={(v) => update("herd", "surplusGiltSaleValue", v)}
            suffix={`${config.project.currency}/head`}
            step={10}
            hint="What a maiden gilt fetches when the sow places are already full."
          />
          <Field
            label="Replacement boar cost"
            value={config.herd.boarPurchaseCost}
            onChange={(v) => update("herd", "boarPurchaseCost", v)}
            suffix={config.project.currency}
            step={10}
            hint="Boars cannot be bred from the market pigs, so the team is always kept up to strength."
          />
          <Field
            label="Boar working life"
            value={config.herd.boarWorkingLifeMonths}
            onChange={(v) => update("herd", "boarWorkingLifeMonths", Math.round(v))}
            suffix="months"
            min={6}
            max={72}
            step={1}
            hint="Boars are rotated off at this point. No female is ever served by her own sire, so the farm stands a second boar once home-bred gilts come to service."
          />
          <Toggle
            label="Grow replacement gilts on the farm"
            checked={config.herd.retainHomeBredGilts}
            onChange={(value) => update("herd", "retainHomeBredGilts", value)}
            hint="Female pigs are held back at selection weight until the sow places are covered."
          />
          <Toggle
            label="Buy gilts when the pipeline is short"
            checked={config.herd.buyGiltsWhenShort}
            onChange={(value) => update("herd", "buyGiltsWhenShort", value)}
            hint="Fills empty sow places immediately instead of waiting for home-bred gilts."
          />
        </div>
      </SectionCard>

      <SectionCard
        title="Breeding performance"
        description="These inputs drive the biological cycle, the farrowings and the pigs entering the growing herd."
        icon={HeartPulse}
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Field
            label="Gestation length"
            value={config.reproduction.gestationDays}
            onChange={(v) => update("reproduction", "gestationDays", v)}
            suffix="days"
            min={110}
            max={122}
            step={1}
            hint="Benchmark starting point: about 115 days."
          />
          <Field
            label="Weaning age"
            value={config.reproduction.weaningAgeDays}
            onChange={(v) => update("reproduction", "weaningAgeDays", v)}
            suffix="days"
            min={18}
            max={56}
            step={1}
          />
          <Field
            label="Weaning to service"
            value={config.reproduction.weanToServiceDays}
            onChange={(v) => update("reproduction", "weanToServiceDays", v)}
            suffix="days"
            min={3}
            max={35}
            step={1}
            hint="Many healthy sows return to estrus within 7 days."
          />
          <Field
            label="Conception rate"
            value={config.reproduction.farrowingSuccessPct}
            onChange={(v) => update("reproduction", "farrowingSuccessPct", v)}
            suffix="% of services"
            max={100}
            step={1}
            hint="A service that does not hold costs another 21-day cycle."
          />
          <Field
            label="Born alive per litter"
            value={config.reproduction.bornAlivePerLitter}
            onChange={(v) => update("reproduction", "bornAlivePerLitter", v)}
            suffix="piglets"
            max={25}
            hint="AHDB average reference: 12.4. Litters vary around this mean."
          />
          <Field
            label="Pre-weaning mortality"
            value={config.reproduction.preWeanMortalityPct}
            onChange={(v) => update("reproduction", "preWeanMortalityPct", v)}
            suffix="%"
            max={100}
            hint="AHDB average reference: about 12.7%."
          />
        </div>
      </SectionCard>

      <SectionCard
        title="Weights, growth and FCR"
        description="Feed conversion ratio means kilograms of feed for one kilogram of liveweight gain. Lower is better only when measurements are comparable."
        icon={Gauge}
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Field
            label="Weaning weight"
            value={config.growth.weaningWeightKg}
            onChange={(v) => update("growth", "weaningWeightKg", v)}
            suffix="kg"
          />
          <Field
            label="Grower starts"
            value={config.growth.growerStartWeightKg}
            onChange={(v) => update("growth", "growerStartWeightKg", v)}
            suffix="kg"
          />
          <Field
            label="Finisher starts"
            value={config.growth.finisherStartWeightKg}
            onChange={(v) => update("growth", "finisherStartWeightKg", v)}
            suffix="kg"
          />
          <Field
            label="Sale weight"
            value={config.growth.saleWeightKg}
            onChange={(v) => update("growth", "saleWeightKg", v)}
            suffix="kg liveweight"
          />
          <Field
            label="Weaner daily gain"
            value={config.growth.weanerDailyGainKg}
            onChange={(v) => update("growth", "weanerDailyGainKg", v)}
            suffix="kg/day"
            step={0.01}
          />
          <Field
            label="Grower daily gain"
            value={config.growth.growerDailyGainKg}
            onChange={(v) => update("growth", "growerDailyGainKg", v)}
            suffix="kg/day"
            step={0.01}
          />
          <Field
            label="Finisher daily gain"
            value={config.growth.finisherDailyGainKg}
            onChange={(v) => update("growth", "finisherDailyGainKg", v)}
            suffix="kg/day"
            step={0.01}
          />
          <div className="hidden xl:block" />
          <Field
            label="Weaner FCR"
            value={config.growth.weanerFcr}
            onChange={(v) => update("growth", "weanerFcr", v)}
            suffix="feed : gain"
            step={0.05}
          />
          <Field
            label="Grower FCR"
            value={config.growth.growerFcr}
            onChange={(v) => update("growth", "growerFcr", v)}
            suffix="feed : gain"
            step={0.05}
          />
          <Field
            label="Finisher FCR"
            value={config.growth.finisherFcr}
            onChange={(v) => update("growth", "finisherFcr", v)}
            suffix="feed : gain"
            step={0.05}
            hint="Pork Gateway: 3.0 average, 2.8 good in its reference system."
          />
          <div className="hidden xl:block" />
          <Field
            label="Weaner mortality"
            value={config.growth.weanerMortalityPct}
            onChange={(v) => update("growth", "weanerMortalityPct", v)}
            suffix="% per stage"
            max={100}
          />
          <Field
            label="Grower mortality"
            value={config.growth.growerMortalityPct}
            onChange={(v) => update("growth", "growerMortalityPct", v)}
            suffix="% per stage"
            max={100}
          />
          <Field
            label="Finisher mortality"
            value={config.growth.finisherMortalityPct}
            onChange={(v) => update("growth", "finisherMortalityPct", v)}
            suffix="% per stage"
            max={100}
          />
        </div>
      </SectionCard>

      <SectionCard
        title="Feed consumption and prices"
        description="Sows eat by daily intake, scaled to their weight. Growing pigs eat daily gain × stage FCR, with the maintenance share scaled by weight and appetite by sex."
        icon={Wheat}
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Field
            label="Gestation intake"
            value={config.feed.gestationKgDay}
            onChange={(v) => update("feed", "gestationKgDay", v)}
            suffix="kg/sow/day"
          />
          <Field
            label="Lactation intake"
            value={config.feed.lactationKgDay}
            onChange={(v) => update("feed", "lactationKgDay", v)}
            suffix="kg/sow/day"
            hint="Covers the sow and the milk her litter lives on."
          />
          <Field
            label="Boar intake"
            value={config.feed.boarKgDay}
            onChange={(v) => update("feed", "boarKgDay", v)}
            suffix="kg/boar/day"
          />
          <div className="hidden xl:block" />
          <Field
            label="Creep feed starts"
            value={config.feed.creepStartAgeDays}
            onChange={(v) => update("feed", "creepStartAgeDays", v)}
            suffix="days of age"
            min={0}
            max={56}
            step={1}
            hint="Before this a piglet lives on milk, which is paid for through the sow's ration."
          />
          <Field
            label="Creep feed offered"
            value={config.feed.creepKgPerPigDay}
            onChange={(v) => update("feed", "creepKgPerPigDay", v)}
            suffix="kg/piglet/day"
            step={0.01}
            max={1}
          />
          <Field
            label="Creep feed price"
            value={config.feed.creepFeedCostKg}
            onChange={(v) => update("feed", "creepFeedCostKg", v)}
            suffix={`${config.project.currency}/kg`}
            step={0.05}
          />
          <div className="hidden xl:block" />
          <Field
            label="Sow feed price"
            value={config.feed.sowFeedCostKg}
            onChange={(v) => update("feed", "sowFeedCostKg", v)}
            suffix={`${config.project.currency}/kg`}
            step={0.01}
          />
          <Field
            label="Weaner feed price"
            value={config.feed.weanerFeedCostKg}
            onChange={(v) => update("feed", "weanerFeedCostKg", v)}
            suffix={`${config.project.currency}/kg`}
            step={0.01}
          />
          <Field
            label="Grower feed price"
            value={config.feed.growerFeedCostKg}
            onChange={(v) => update("feed", "growerFeedCostKg", v)}
            suffix={`${config.project.currency}/kg`}
            step={0.01}
          />
          <Field
            label="Finisher feed price"
            value={config.feed.finisherFeedCostKg}
            onChange={(v) => update("feed", "finisherFeedCostKg", v)}
            suffix={`${config.project.currency}/kg`}
            step={0.01}
          />
        </div>
      </SectionCard>

      <SectionCard
        title="Health costs by age"
        description="Every pig is charged for each treatment on the day it reaches that age, and for heat while it is still young enough to need it."
        icon={Syringe}
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Field
            label="Routine vet allowance"
            value={config.health.vetCostPerSowMonth}
            onChange={(v) => update("health", "vetCostPerSowMonth", v)}
            suffix={`${config.project.currency}/sow/month`}
            hint="Charged to every sow in the herd each month."
          />
          <Field
            label="Heating"
            value={config.health.heatingCostPerPigDay}
            onChange={(v) => update("health", "heatingCostPerPigDay", v)}
            suffix={`${config.project.currency}/pig/day`}
            step={0.005}
          />
          <Field
            label="Heated until"
            value={config.health.heatedUntilAgeDays}
            onChange={(v) => update("health", "heatedUntilAgeDays", v)}
            suffix="days of age"
            min={0}
            max={120}
            step={1}
            hint={`Costs ${money(config.health.heatingCostPerPigDay * config.health.heatedUntilAgeDays, config.project.currency)} per pig reared.`}
          />
          <div className="flex items-end">
            <div className="w-full rounded-lg bg-plane px-3 py-2.5 text-xs text-ink-muted">
              <span className="font-medium text-ink">
                {money(metrics.vaccinationCostPerPig, config.project.currency)}
              </span>{" "}
              of treatment per pig across the schedule below.
            </div>
          </div>
        </div>

        <div className="mt-5 overflow-hidden rounded-lg border border-hairline">
          <table className="w-full text-sm">
            <thead className="border-b border-hairline bg-plane text-left text-xs text-ink-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Treatment</th>
                <th className="w-32 px-3 py-2 text-right font-medium">Age (days)</th>
                <th className="w-36 px-3 py-2 text-right font-medium">
                  Cost ({config.project.currency}/pig)
                </th>
                <th className="w-12 px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {config.health.vaccinations.map((dose, index) => (
                <tr key={dose.id} className="border-b border-hairline last:border-0">
                  <td className="px-2 py-1.5">
                    <input
                      value={dose.name}
                      aria-label={"Treatment " + (index + 1) + " name"}
                      onChange={(event) =>
                        updateVaccination(index, { name: event.target.value })
                      }
                      className="w-full rounded-md border border-transparent bg-transparent px-2 py-1.5 text-sm outline-none transition hover:border-hairline focus:border-accent"
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      type="number"
                      min={0}
                      max={400}
                      step={1}
                      value={dose.ageDays}
                      aria-label={"Treatment " + (index + 1) + " age in days"}
                      onChange={(event) =>
                        updateVaccination(index, { ageDays: Number(event.target.value) })
                      }
                      className="w-full rounded-md border border-transparent bg-transparent px-2 py-1.5 text-right text-sm tabular-nums outline-none transition hover:border-hairline focus:border-accent"
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      type="number"
                      min={0}
                      step={0.05}
                      value={dose.costPerPig}
                      aria-label={"Treatment " + (index + 1) + " cost per pig"}
                      onChange={(event) =>
                        updateVaccination(index, { costPerPig: Number(event.target.value) })
                      }
                      className="w-full rounded-md border border-transparent bg-transparent px-2 py-1.5 text-right text-sm tabular-nums outline-none transition hover:border-hairline focus:border-accent"
                    />
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <button
                      onClick={() => removeVaccination(index)}
                      aria-label={"Remove " + dose.name}
                      className="rounded-md p-1.5 text-ink-faint transition hover:bg-critical-soft hover:text-critical"
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
              {config.health.vaccinations.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3 py-4 text-center text-xs text-ink-faint">
                    No treatments scheduled. Add the programme agreed with your veterinarian.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
          <div className="border-t border-hairline bg-plane px-3 py-2">
            <button
              onClick={addVaccination}
              disabled={config.health.vaccinations.length >= 16}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-ink-muted transition hover:bg-surface hover:text-ink disabled:opacity-40"
            >
              <Plus size={14} /> Add a treatment
            </button>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="Sales and operating costs"
        description="Use written quotations where possible. Health costs should reflect a locally agreed vaccination and biosecurity programme."
        icon={WalletCards}
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Field
            label="Pig sale price"
            value={config.finance.salePriceKg}
            onChange={(v) => update("finance", "salePriceKg", v)}
            suffix={`${config.project.currency}/kg deadweight`}
            step={0.05}
            hint="Abattoirs pay on the carcass, so this is a deadweight price."
          />
          <Field
            label="Dressing percentage"
            value={config.finance.dressingPct}
            onChange={(v) => update("finance", "dressingPct", v)}
            suffix="% of liveweight"
            min={45}
            max={90}
            hint={`A ${number(config.growth.saleWeightKg, 0)} kg pig dresses out at ${number((config.growth.saleWeightKg * config.finance.dressingPct) / 100, 1)} kg of carcass.`}
          />
          <Field
            label="Transport per sale pig"
            value={config.finance.transportPerPigSold}
            onChange={(v) => update("finance", "transportPerPigSold", v)}
            suffix={config.project.currency}
          />
          <Field
            label="Wage per stockperson"
            value={config.finance.labourCostPerWorkerMonth}
            onChange={(v) => update("finance", "labourCostPerWorkerMonth", v)}
            suffix={`${config.project.currency}/month`}
          />
          <Field
            label="Pigs per stockperson"
            value={config.finance.pigsPerWorker}
            onChange={(v) => update("finance", "pigsPerWorker", v)}
            suffix="head"
            min={20}
            max={5000}
            step={10}
            hint="The farm hires as the herd grows: the wage bill is re-read from the head count every month."
          />
          <Field
            label="Minimum stockpeople"
            value={config.finance.minimumWorkers}
            onChange={(v) => update("finance", "minimumWorkers", Math.round(v))}
            suffix="people"
            min={0}
            max={100}
            step={1}
          />
          <Field
            label="Utilities"
            value={config.finance.utilitiesMonthly}
            onChange={(v) => update("finance", "utilitiesMonthly", v)}
            suffix={`${config.project.currency}/month`}
          />
          <Field
            label="Bedding & sanitation"
            value={config.finance.beddingMonthly}
            onChange={(v) => update("finance", "beddingMonthly", v)}
            suffix={`${config.project.currency}/month`}
          />
          <Field
            label="Biosecurity"
            value={config.finance.biosecurityMonthly}
            onChange={(v) => update("finance", "biosecurityMonthly", v)}
            suffix={`${config.project.currency}/month`}
          />
          <Field
            label="Other fixed costs"
            value={config.finance.otherFixedMonthly}
            onChange={(v) => update("finance", "otherFixedMonthly", v)}
            suffix={`${config.project.currency}/month`}
          />
          <Field
            label="Other monthly income"
            value={config.finance.otherIncomeMonthly}
            onChange={(v) => update("finance", "otherIncomeMonthly", v)}
            suffix={`${config.project.currency}/month`}
          />
          <Field
            label="Contingency"
            value={config.finance.contingencyPct}
            onChange={(v) => update("finance", "contingencyPct", v)}
            suffix="% of operating costs"
            max={100}
          />
        </div>
      </SectionCard>
    </div>
  );
}

// ------------------------------------------------------------------- cashflow

type CashflowPreviewRow = {
  key: string;
  label: string;
  kind?: "line" | "total" | "balance" | "funding";
  monthValue: (month: MonthlyProjection, index: number) => number;
  planValue: number;
};

function cashflowMoney(value: number, currency: string) {
  if (Math.abs(value) < 0.005) return "—";
  const formatted = money(Math.abs(value), currency);
  return value < 0 ? `(${formatted})` : formatted;
}

function CashflowPreview({
  config,
  projection,
  exporting,
  onExport,
}: {
  config: PlannerConfig;
  projection: ReturnType<typeof calculateProjection>;
  exporting: boolean;
  onExport: () => void;
}) {
  const currency = config.project.currency;
  const total = (pick: (month: MonthlyProjection) => number) =>
    projection.months.reduce((sum, month) => sum + pick(month), 0);
  const rows: Array<CashflowPreviewRow | { key: string; label: string; kind: "section" }> = [
    {
      key: "opening",
      label: "Opening cash balance",
      kind: "balance",
      monthValue: (_month, index) =>
        index === 0 ? config.project.openingCash : projection.months[index - 1].closingCash,
      planValue: config.project.openingCash,
    },
    { key: "receipts-section", label: "Cash receipts", kind: "section" },
    {
      key: "pig-sales",
      label: "Pig sales",
      monthValue: (month) => month.totals["pig-sales"],
      planValue: total((month) => month.totals["pig-sales"]),
    },
    {
      key: "gilt-sales",
      label: "Breeding gilt sales",
      monthValue: (month) => month.totals["gilt-sales"],
      planValue: total((month) => month.totals["gilt-sales"]),
    },
    {
      key: "cull-sales",
      label: "Cull sow sales",
      monthValue: (month) => month.totals["cull-sales"],
      planValue: total((month) => month.totals["cull-sales"]),
    },
    {
      key: "other-income",
      label: "Other income",
      monthValue: (month) => month.totals["other-income"],
      planValue: total((month) => month.totals["other-income"]),
    },
    {
      key: "total-receipts",
      label: "Total receipts",
      kind: "total",
      monthValue: (month) => month.revenue,
      planValue: projection.summary.totalRevenue,
    },
    { key: "payments-section", label: "Cash payments", kind: "section" },
    {
      key: "feed",
      label: "Feed",
      monthValue: (month) => month.totals.feed,
      planValue: total((month) => month.totals.feed),
    },
    {
      key: "vaccination",
      label: "Vaccination & treatment",
      monthValue: (month) => month.totals.vaccination,
      planValue: total((month) => month.totals.vaccination),
    },
    {
      key: "veterinary",
      label: "Routine veterinary",
      monthValue: (month) => month.totals.veterinary,
      planValue: total((month) => month.totals.veterinary),
    },
    {
      key: "heating",
      label: "Heating",
      monthValue: (month) => month.totals.heating,
      planValue: total((month) => month.totals.heating),
    },
    {
      key: "labour",
      label: "Labour",
      monthValue: (month) => month.totals.labour,
      planValue: total((month) => month.totals.labour),
    },
    {
      key: "overheads",
      label: "Fixed overheads",
      monthValue: (month) => month.totals.overheads,
      planValue: total((month) => month.totals.overheads),
    },
    {
      key: "transport",
      label: "Transport",
      monthValue: (month) => month.totals.transport,
      planValue: total((month) => month.totals.transport),
    },
    {
      key: "breeding-stock",
      label: "Bought-in breeding stock",
      monthValue: (month) => month.totals["breeding-stock"],
      planValue: total((month) => month.totals["breeding-stock"]),
    },
    {
      key: "contingency",
      label: "Contingency",
      monthValue: (month) => month.totals.contingency,
      planValue: total((month) => month.totals.contingency),
    },
    {
      key: "capital",
      label: "Capital expenditure",
      monthValue: (month) => month.totals.capital,
      planValue: total((month) => month.totals.capital),
    },
    {
      key: "total-payments",
      label: "Total payments",
      kind: "total",
      monthValue: (month) => month.totalCost,
      planValue: projection.summary.totalCost,
    },
    {
      key: "net-cashflow",
      label: "Net cash flow",
      kind: "balance",
      monthValue: (month) => month.netCashFlow,
      planValue: total((month) => month.netCashFlow),
    },
    {
      key: "closing",
      label: "Closing cash balance",
      kind: "balance",
      monthValue: (month) => month.closingCash,
      planValue: projection.summary.closingCash,
    },
    {
      key: "funding",
      label: "Funding requirement",
      kind: "funding",
      monthValue: (month) => Math.max(0, -month.closingCash),
      planValue: projection.summary.peakFundingNeed,
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-ink">Detailed cashflow</h2>
          <p className="mt-1.5 max-w-3xl text-sm leading-6 text-ink-muted">
            Preview the complete monthly cashflow used in the funding workbook. Scroll across to
            inspect every month; the last column shows plan totals or the final balance.
          </p>
        </div>
        <button
          type="button"
          onClick={onExport}
          disabled={exporting}
          className="inline-flex items-center gap-2 rounded-lg bg-ink px-4 py-2.5 text-xs font-medium text-surface transition hover:bg-ink-muted disabled:opacity-40"
        >
          <Download size={14} /> {exporting ? "Preparing…" : "Export this cashflow"}
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Opening cash" value={money(config.project.openingCash, currency)} />
        <StatTile
          label="Peak funding need"
          value={money(projection.summary.peakFundingNeed, currency)}
          context="Largest projected cash shortfall"
          tone={projection.summary.peakFundingNeed > 0 ? "critical" : "good"}
        />
        <StatTile
          label="Total receipts"
          value={money(projection.summary.totalRevenue, currency)}
        />
        <StatTile
          label="Closing cash"
          value={money(projection.summary.closingCash, currency)}
          tone={projection.summary.closingCash < 0 ? "critical" : "good"}
        />
      </div>

      <section className="overflow-hidden rounded-xl border border-hairline bg-surface">
        <div className="max-h-[680px] overflow-auto">
          <table className="border-separate border-spacing-0 text-xs">
            <thead className="sticky top-0 z-20 bg-plane text-ink-muted">
              <tr>
                <th className="sticky left-0 z-30 min-w-56 border-b border-r border-hairline bg-plane px-4 py-3 text-left font-medium">
                  Cashflow line
                </th>
                {projection.months.map((month) => (
                  <th
                    key={month.date}
                    className="min-w-28 border-b border-r border-hairline px-3 py-3 text-right font-medium"
                  >
                    {month.month}
                  </th>
                ))}
                <th className="min-w-32 border-b border-hairline bg-accent-soft px-3 py-3 text-right font-semibold text-accent">
                  Plan total / end
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                if (row.kind === "section") {
                  return (
                    <tr key={row.key}>
                      <th
                        colSpan={projection.months.length + 2}
                        className="sticky left-0 border-b border-hairline bg-ink px-4 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-surface"
                      >
                        {row.label}
                      </th>
                    </tr>
                  );
                }

                const strong = row.kind === "total" || row.kind === "balance";
                return (
                  <tr
                    key={row.key}
                    className={
                      row.kind === "funding"
                        ? "bg-warning-soft"
                        : strong
                          ? "bg-plane/70"
                          : "hover:bg-plane/50"
                    }
                  >
                    <th
                      className={
                        "sticky left-0 z-10 border-b border-r border-hairline px-4 py-2.5 text-left " +
                        (row.kind === "funding"
                          ? "bg-warning-soft font-semibold text-critical"
                          : strong
                            ? "bg-plane font-semibold text-ink"
                            : "bg-surface font-normal text-ink-muted")
                      }
                    >
                      {row.label}
                    </th>
                    {projection.months.map((month, index) => {
                      const value = row.monthValue(month, index);
                      return (
                        <td
                          key={month.date}
                          className={
                            "whitespace-nowrap border-b border-r border-hairline px-3 py-2.5 text-right tabular-nums " +
                            (value < 0 || (row.kind === "funding" && value > 0)
                              ? "text-critical"
                              : strong
                                ? "font-medium text-ink"
                                : "text-ink-muted")
                          }
                        >
                          {cashflowMoney(value, currency)}
                        </td>
                      );
                    })}
                    <td
                      className={
                        "whitespace-nowrap border-b border-hairline bg-accent-soft/50 px-3 py-2.5 text-right font-semibold tabular-nums " +
                        (row.planValue < 0 || (row.kind === "funding" && row.planValue > 0)
                          ? "text-critical"
                          : "text-ink")
                      }
                    >
                      {cashflowMoney(row.planValue, currency)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-hairline bg-plane px-4 py-3 text-xs text-ink-faint">
          <span>Figures update automatically when plan inputs change.</span>
          <span>{projection.months.length} months · {currency}</span>
        </div>
      </section>
    </div>
  );
}

type Granularity = "month" | "year";

/** One row of the money table, whether it covers a month or a whole plan year. */
type PeriodView = {
  key: string;
  label: string;
  sublabel: string;
  totals: CategoryTotals;
  revenue: number;
  totalCost: number;
  netCashFlow: number;
  closingCash: number;
  bornAlive: number;
  weaned: number;
  pigsSold: number;
  saleLiveweightKg: number;
  saleDeadweightKg: number;
  giltsSold: number;
  deaths: number;
};

function monthView(month: MonthlyProjection): PeriodView {
  return {
    key: month.date,
    label: month.month,
    sublabel: format(parseISO(month.date), "MMMM yyyy"),
    totals: month.totals,
    revenue: month.revenue,
    totalCost: month.totalCost,
    netCashFlow: month.netCashFlow,
    closingCash: month.closingCash,
    bornAlive: month.bornAlive,
    weaned: month.weaned,
    pigsSold: month.pigsSold,
    saleLiveweightKg: month.saleLiveweightKg,
    saleDeadweightKg: month.saleDeadweightKg,
    giltsSold: month.giltsSold,
    deaths: month.deaths,
  };
}

function yearView(year: PeriodSummary, months: MonthlyProjection[]): PeriodView {
  const covered = months.filter((month) => year.months.includes(month.index));
  return {
    key: year.key,
    label: year.label,
    sublabel:
      format(parseISO(year.startDate), "MMM yyyy") +
      " – " +
      format(parseISO(covered.at(-1)!.date), "MMM yyyy"),
    totals: year.totals,
    revenue: year.revenue,
    totalCost: year.totalCost,
    netCashFlow: year.netCashFlow,
    closingCash: year.closingCash,
    bornAlive: year.bornAlive,
    weaned: year.weaned,
    pigsSold: year.pigsSold,
    saleLiveweightKg: covered.reduce((sum, month) => sum + month.saleLiveweightKg, 0),
    saleDeadweightKg: covered.reduce((sum, month) => sum + month.saleDeadweightKg, 0),
    giltsSold: year.giltsSold,
    deaths: covered.reduce((sum, month) => sum + month.deaths, 0),
  };
}

function Money({
  config,
  projection,
}: {
  config: PlannerConfig;
  projection: ReturnType<typeof calculateProjection>;
}) {
  const [granularity, setGranularity] = useState<Granularity>("month");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const currency = config.project.currency;

  const periods = useMemo(
    () =>
      granularity === "month"
        ? projection.months.map(monthView)
        : projection.years.map((year) => yearView(year, projection.months)),
    [granularity, projection],
  );

  const selected = periods.find((period) => period.key === selectedKey) ?? periods[0];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-ink">Money in and money out</h2>
          <p className="mt-1.5 max-w-2xl text-sm leading-6 text-ink-muted">
            Zoom out to plan years for the shape of the business, or stay on months and pick one to
            see exactly what it is expected to earn and spend.
          </p>
        </div>
        <div className="flex rounded-lg border border-hairline p-0.5">
          {(
            [
              ["month", "Monthly"],
              ["year", "Yearly"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              onClick={() => {
                setGranularity(value);
                setSelectedKey(null);
              }}
              aria-pressed={granularity === value}
              className={
                "rounded-md px-3 py-1.5 text-xs font-medium transition " +
                (granularity === value
                  ? "bg-accent-soft text-accent"
                  : "text-ink-muted hover:text-ink")
              }
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(330px,0.65fr)]">
        <div className="overflow-hidden rounded-xl border border-hairline bg-surface">
          <div className="max-h-[640px] overflow-auto">
            <table className="w-full min-w-[520px] border-collapse text-xs">
              <thead className="sticky top-0 border-b border-hairline bg-plane text-left text-ink-muted">
                <tr>
                  {["Period", "Received", "Spent", "Net", "Cash"].map(
                    (heading, index) => (
                      <th
                        key={heading}
                        className={
                          "whitespace-nowrap px-3.5 py-3 font-medium " +
                          (index > 0 ? "text-right" : "")
                        }
                      >
                        {heading}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {periods.map((period) => {
                  const active = period.key === selected?.key;
                  return (
                    <tr
                      key={period.key}
                      onClick={() => setSelectedKey(period.key)}
                      aria-selected={active}
                      className={
                        "cursor-pointer border-b border-hairline last:border-0 " +
                        (active ? "bg-accent-soft" : "hover:bg-plane")
                      }
                    >
                      <td className="whitespace-nowrap px-3.5 py-2.5 font-medium">
                        {period.label}
                      </td>
                      <td className="whitespace-nowrap px-3.5 py-2.5 text-right tabular-nums text-ink-muted">
                        {money(period.revenue, currency)}
                      </td>
                      <td className="whitespace-nowrap px-3.5 py-2.5 text-right tabular-nums text-ink-muted">
                        {money(period.totalCost, currency)}
                      </td>
                      <td
                        className={
                          "whitespace-nowrap px-3.5 py-2.5 text-right font-medium tabular-nums " +
                          (period.netCashFlow < 0 ? "text-critical" : "")
                        }
                      >
                        {money(period.netCashFlow, currency)}
                      </td>
                      <td
                        className={
                          "whitespace-nowrap px-3.5 py-2.5 text-right font-medium tabular-nums " +
                          (period.closingCash < 0 ? "text-critical" : "")
                        }
                      >
                        {money(period.closingCash, currency)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-hairline bg-plane px-4 py-3 text-xs text-ink-faint">
            <span>Pick a row to break it down.</span>
            <span>
              {periods.length} {granularity === "month" ? "months" : "plan years"} simulated
            </span>
          </div>
        </div>

        {selected ? <PeriodDetail period={selected} currency={currency} /> : null}
      </div>
    </div>
  );
}

function PeriodDetail({ period, currency }: { period: PeriodView; currency: string }) {
  const lines = (categories: readonly LedgerCategory[]) =>
    categories
      .map((category) => ({ category, amount: period.totals[category] }))
      .filter((line) => line.amount !== 0)
      .sort((a, b) => b.amount - a.amount);

  const income = lines(INCOME_CATEGORIES);
  const spend = lines(EXPENSE_CATEGORIES);

  return (
    <section className="h-fit rounded-xl border border-hairline bg-surface p-5 xl:sticky xl:top-24">
      <p className="text-xs text-ink-faint">{period.sublabel}</p>
      <h3 className="mt-0.5 text-[15px] font-semibold tracking-tight text-ink">
        Expected to receive and spend
      </h3>

      <p className="mt-5 text-xs font-medium text-ink-faint">Money in</p>
      <table className="mt-1.5 w-full text-sm">
        <tbody>
          {income.map((line) => (
            <tr key={line.category} className="border-b border-hairline">
              <td className="py-1.5 text-ink-muted">{CATEGORY_LABELS[line.category]}</td>
              <td className="py-1.5 text-right tabular-nums">{money(line.amount, currency)}</td>
            </tr>
          ))}
          {income.length === 0 ? (
            <tr>
              <td className="py-1.5 text-ink-faint">Nothing sold in this period</td>
              <td className="py-1.5 text-right tabular-nums text-ink-faint">
                {money(0, currency)}
              </td>
            </tr>
          ) : null}
          <tr>
            <td className="py-2 font-medium">Total received</td>
            <td className="py-2 text-right font-medium tabular-nums">
              {money(period.revenue, currency)}
            </td>
          </tr>
        </tbody>
      </table>

      <p className="mt-5 text-xs font-medium text-ink-faint">Money out</p>
      <table className="mt-1.5 w-full text-sm">
        <tbody>
          {spend.map((line) => (
            <tr key={line.category} className="border-b border-hairline">
              <td className="py-1.5 text-ink-muted">{CATEGORY_LABELS[line.category]}</td>
              <td className="py-1.5 text-right tabular-nums">{money(line.amount, currency)}</td>
            </tr>
          ))}
          <tr>
            <td className="py-2 font-medium">Total spent</td>
            <td className="py-2 text-right font-medium tabular-nums">
              {money(period.totalCost, currency)}
            </td>
          </tr>
        </tbody>
      </table>

      <div className="mt-4 space-y-1.5 rounded-lg bg-plane p-3.5 text-sm">
        <div className="flex justify-between">
          <span className="text-ink-muted">Net for the period</span>
          <span
            className={
              "font-semibold tabular-nums " +
              (period.netCashFlow < 0 ? "text-critical" : "text-good")
            }
          >
            {money(period.netCashFlow, currency)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-ink-muted">Cash at the end</span>
          <span
            className={
              "font-medium tabular-nums " + (period.closingCash < 0 ? "text-critical" : "")
            }
          >
            {money(period.closingCash, currency)}
          </span>
        </div>
      </div>

      <p className="mt-4 text-xs font-medium text-ink-faint">What drove it</p>
      <dl className="mt-1.5 grid grid-cols-2 gap-2">
        {[
          ["Piglets born", number(period.bornAlive, 0)],
          ["Piglets weaned", number(period.weaned, 0)],
          ["Pigs sold", number(period.pigsSold, 0)],
          ["Liveweight sold", number(period.saleLiveweightKg, 0) + " kg"],
          ["Deadweight sold", number(period.saleDeadweightKg, 0) + " kg"],
          ["Gilts sold", number(period.giltsSold, 0)],
          ["Losses", number(period.deaths, 0)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-hairline px-3 py-2">
            <dt className="text-[11px] text-ink-faint">{label}</dt>
            <dd className="mt-0.5 text-sm font-medium tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

// --------------------------------------------------------------------- method

function Methodology({
  config,
  metrics,
}: {
  config: PlannerConfig;
  metrics: ReturnType<typeof getModelMetrics>;
}) {
  const formulas = [
    [
      "Farrowing interval",
      "gestation + weaning age + wean-to-service + repeat services × 21 days",
      `${number(metrics.cycleDays, 0)} days`,
    ],
    [
      "Litters per sow/year",
      "365 ÷ farrowing interval",
      `${number(metrics.littersPerSowYear, 2)} litters`,
    ],
    [
      "Pigs weaned per litter",
      "born alive × (1 − pre-weaning mortality)",
      `${number(metrics.weanedPerLitter, 1)} pigs`,
    ],
    [
      "Growing-pig feed",
      "daily gain × stage FCR, scaled by sex and by weight through the stage",
      "Charged per pig per day",
    ],
    [
      "Days to sale weight",
      "weaning age + each stage's weight range ÷ its daily gain",
      number(metrics.daysToSaleWeight, 0) + " days",
    ],
    [
      "Health cost per pig",
      "each treatment charged on the day the pig reaches that age",
      money(metrics.vaccinationCostPerPig, config.project.currency) + " of treatment",
    ],
    [
      "Gilt retention",
      "female pigs are held back while sow places are uncovered, and sold on if they are not",
      config.herd.maxSows + " sow places",
    ],
    [
      "Pig sales",
      "sale liveweight × dressing % × deadweight price",
      config.growth.saleWeightKg +
        " kg live → " +
        number((config.growth.saleWeightKg * config.finance.dressingPct) / 100, 1) +
        " kg carcass × " +
        rate(config.finance.salePriceKg, config.project.currency),
    ],
    [
      "Labour",
      "one stockperson per " + config.finance.pigsPerWorker + " head, re-counted every month",
      money(config.finance.labourCostPerWorkerMonth, config.project.currency) + " per person",
    ],
    [
      "Boar rotation",
      "boars work a fixed term and never serve their own daughters",
      config.herd.boarWorkingLifeMonths + " months per boar",
    ],
    ["Closing cash", "prior cash + income − every cost posted that day", "Reconciled daily"],
  ];

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-ink">How the model works</h2>
        <p className="mt-1.5 max-w-3xl text-sm leading-6 text-ink-muted">
          PigFlow simulates the farm one day at a time. Each sow, boar and growing pig is an object
          with a sex, a weight, an age and a dam: it eats according to what it is, is charged for
          the treatments and heat its age calls for, and posts all of it to a ledger. The monthly
          cashflow is that ledger rolled up, so the plan and the simulator can never disagree.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {formulas.map(([title, formula, result], index) => (
          <div key={title} className="rounded-xl border border-hairline bg-surface p-5">
            <div className="flex items-start gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-raised text-xs font-medium text-ink-muted">
                {index + 1}
              </span>
              <div>
                <h3 className="text-sm font-medium text-ink">{title}</h3>
                <p className="mt-1.5 font-mono text-xs leading-5 text-ink-faint">{formula}</p>
                <p className="mt-2.5 inline-flex rounded-md bg-plane px-2 py-1 text-xs font-medium text-ink-muted">
                  {result}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <SectionCard
          title="Benchmark sources"
          description="These support the starter assumptions and the reasonableness checks. They do not replace local farm records or a herd-specific veterinary programme."
          icon={BookOpen}
        >
          <div className="space-y-2.5">
            {BENCHMARK_SOURCES.map((source) => (
              <a
                key={source.url}
                href={source.url}
                target="_blank"
                rel="noreferrer"
                className="group flex items-start justify-between gap-4 rounded-lg border border-hairline p-3.5 transition hover:border-accent hover:bg-accent-soft"
              >
                <div>
                  <p className="text-[13px] font-medium text-ink">{source.title}</p>
                  <p className="mt-1 text-xs leading-5 text-ink-faint">{source.note}</p>
                </div>
                <ChevronRight size={15} className="mt-0.5 shrink-0 text-ink-faint" />
              </a>
            ))}
          </div>
        </SectionCard>

        <SectionCard
          title="What this version still does not model"
          description="Explicit limits protect the model from creating false precision."
          icon={ShieldCheck}
        >
          <ul className="space-y-2.5 text-sm leading-6 text-ink-muted">
            {[
              "One random run per seed: this is a plausible farm, not the average of many.",
              "No loan interest, tax, depreciation or inflation unless entered through costs.",
              "No disease outbreak, seasonal fertility effect or market-price volatility.",
              "Sow places are the only capacity limit: growing pens, feed storage and labour are not.",
              "Heating cost is a flat rate per young pig per day, with no seasonal swing.",
              "Artificial insemination is not modelled; services need a boar on the farm.",
            ].map((item) => (
              <li key={item} className="flex gap-2.5">
                <CheckCircle2 size={15} className="mt-1 shrink-0 text-ink-faint" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <div className="mt-5 flex gap-3 rounded-lg border border-warning/40 bg-warning-soft p-3.5">
            <Info size={16} className="mt-0.5 shrink-0 text-warning" />
            <p className="text-xs leading-5 text-ink-muted">
              <strong className="font-medium text-ink">Animal-health note:</strong> this app supports
              budgeting. Diagnosis, treatment, vaccination schedules, medicine use and biosecurity
              decisions require a veterinarian familiar with your herd and local disease risks.
            </p>
          </div>
        </SectionCard>
      </div>

      <div className="flex gap-3 rounded-xl border border-hairline bg-surface p-5">
        <Scale size={18} className="mt-0.5 shrink-0 text-ink-faint" />
        <div>
          <h3 className="text-sm font-medium text-ink">Trust comes from replacing defaults</h3>
          <p className="mt-1 text-sm leading-6 text-ink-muted">
            Use at least three months of measured feed use, weights, mortality and sales to calibrate
            this plan. Compare forecast against actual every month and update the assumptions — not
            the calculated outputs.
          </p>
        </div>
      </div>
    </div>
  );
}
