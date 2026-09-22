"use client";

import { useMemo, useState } from "react";
import {
  addMonths,
  differenceInCalendarMonths,
  format,
  parseISO,
  startOfMonth,
  subDays,
} from "date-fns";
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
  BookOpen,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  Gauge,
  HeartPulse,
  Info,
  Landmark,
  Minus,
  PiggyBank,
  Rows3,
  Scale,
  Plus,
  ShieldCheck,
  Syringe,
  TestTubes,
  Trash2,
  Truck,
  WalletCards,
  Wheat,
} from "lucide-react";

import {
  MAX_STARTING_STOCK_ROWS,
  STARTING_STOCK_TYPES,
  TYPICAL_AGE_DAYS,
  expectedGiltServiceAgeDays,
  openingCounts,
  type StartingBoarEntry,
  type StartingSowEntry,
  type StartingStockEntry,
  type StartingStockType,
} from "@/lib/config";
import { money, number, plural, rate } from "@/lib/format";
import {
  BENCHMARK_SOURCES,
  calculateProjection,
  getModelMetrics,
  type CashMovement,
  type MonthlyProjection,
  type PeriodSummary,
  type PlannerConfig,
  type PlannerSection,
  type Vaccination,
} from "@/lib/model";
import {
  generatedTotal,
  isGenerated,
  planCashInjections,
  planCashWithdrawals,
} from "@/lib/funding";
import {
  daySnapshotAt,
  type DaySnapshot,
  type PlanSimulationResult,
} from "@/lib/simulation-result";
import {
  inventoryAdjustedPnL,
  reconcileProfit,
  type InventoryAdjustedPnL,
  type PeriodAccounting,
  type PnLReconciliation,
} from "@/lib/accounts";
import { inventoryTotal } from "@/lib/sim/accounting";
import {
  STARTING_STOCK_LABELS,
  STARTING_STOCK_NAMES,
  openingStockValue,
} from "@/lib/sim/starting-stock";
import {
  CATEGORY_LABELS,
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  LEDGER_CATEGORIES,
  emptyTotals,
  farmWorthLines,
  herdGroups,
  type CategoryTotals,
  type FarmCalendarDay,
  type FarmCalendarMonth,
  type FarmPeriodEvent,
  type LedgerCategory,
} from "@/lib/sim";
import { Button } from "@/components/ui/button";
import { Calendar, CalendarDayButton } from "@/components/ui/calendar";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

/** Chart palette: one blue for cash, one orange for flows, an ordinal blue ramp for stages. */
const CHART = {
  grid: "var(--color-hairline)",
  axis: "var(--color-ink-faint)",
  baseline: "var(--color-rule)",
  cash: "var(--color-brand)",
  flow: "var(--color-flow)",
  warning: "var(--color-warning)",
  stage: {
    piglets: "var(--color-piglets)",
    weaners: "var(--color-weaners)",
    growers: "var(--color-growers)",
    finishers: "var(--color-finishers)",
    gilts: "var(--color-gilts)",
    sows: "var(--color-sows)",
    boars: "var(--color-boars)",
  },
} as const;

const TOOLTIP_STYLE = {
  borderRadius: 10,
  border: "1px solid var(--color-hairline)",
  background: "var(--color-surface)",
  boxShadow: "0 6px 20px color-mix(in srgb, var(--color-ink) 10%, transparent)",
  fontSize: 12,
  color: "var(--color-ink)",
} as const;

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

const EVENT_TONES: Record<FarmPeriodEvent["type"], string> = {
  vaccination: "bg-brand-soft text-brand",
  processing: "bg-brand-soft text-brand",
  service: "bg-warning-soft text-ink-muted",
  scan: "bg-warning-soft text-ink-muted",
  conception: "bg-good-soft text-good",
  growth: "bg-plane text-ink-muted",
  farrowing: "bg-good-soft text-good",
  weaning: "bg-good-soft text-good",
  sale: "bg-brand-soft text-brand",
  selection: "bg-plane text-ink-muted",
  promotion: "bg-plane text-ink-muted",
  loss: "bg-critical-soft text-critical",
  cull: "bg-critical-soft text-critical",
  purchase: "bg-warning-soft text-ink-muted",
  feed: "bg-warning-soft text-ink-muted",
};

/**
 * The dot a kind of activity puts on its square. Related activities share one,
 * so a year of squares can be read for shape: the breeding cycle turning, pigs
 * changing what they are, pigs leaving, feed arriving. Vaccinations and losses
 * are deliberately unmarked — they fall on so many days that a dot for them
 * would colour the whole calendar and say nothing.
 */
const DAY_MARKS: Partial<Record<FarmPeriodEvent["type"], string>> = {
  service: CHART.stage.sows,
  scan: CHART.stage.sows,
  conception: CHART.stage.sows,
  farrowing: CHART.stage.sows,
  weaning: CHART.stage.gilts,
  growth: CHART.stage.gilts,
  selection: CHART.stage.gilts,
  promotion: CHART.stage.gilts,
  sale: CHART.cash,
  feed: CHART.warning,
};

/** Fixed order, so a square's dots never rearrange themselves day to day. */
const MARK_ORDER = [CHART.stage.sows, CHART.stage.gilts, CHART.cash, CHART.warning] as const;

/** A short word for the kind of activity, so the day reads as a work list. */
const EVENT_NAMES: Record<FarmPeriodEvent["type"], string> = {
  vaccination: "Health",
  processing: "Process",
  scan: "Scan",
  service: "Service",
  conception: "In pig",
  growth: "Grow on",
  farrowing: "Farrow",
  weaning: "Wean",
  sale: "Sale",
  selection: "Select",
  promotion: "Promote",
  loss: "Loss",
  cull: "Cull",
  purchase: "Buy",
  feed: "Feed",
};

/** Calendar or a list of months — the same plan, read at two zoom levels. */
type TimelineView = "calendar" | "months";

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
  disabled = false,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  suffix?: string;
  hint?: string;
  min?: number;
  max?: number;
  step?: number;
  /** Greyed out for an input the plan is not currently reading. */
  disabled?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-medium text-ink-muted">{label}</span>
        {suffix ? <span className="text-[11px] text-ink-faint">{suffix}</span> : null}
      </span>
      <Input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        className="font-medium tabular-nums disabled:opacity-50"
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
      <Input type={type} value={value} onChange={(event) => onChange(event.target.value)} />
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
      <Select value={value} onValueChange={(next) => onChange(next as T)}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
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
        className="mt-0.5 size-4 accent-brand"
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
    <Card className={className}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
        {action ? <CardAction>{action}</CardAction> : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function SectionCard({
  title,
  description,
  icon: Icon,
  children,
  className,
}: {
  title: string;
  description: string;
  icon: typeof PiggyBank;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={`[--card-spacing:--spacing(5)] ${className ?? ""}`}>
      <CardHeader className="grid-cols-[auto_1fr] gap-x-3">
        <span className="row-span-2 flex size-8 items-center justify-center rounded-lg bg-raised text-ink-muted">
          <Icon size={16} strokeWidth={1.75} />
        </span>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
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
    <Card size="sm">
      <CardContent>
        <p className="text-xs font-medium text-ink-faint">{label}</p>
        <p className={`mt-2 text-2xl font-semibold tracking-tight ${valueTone}`}>{value}</p>
        {context ? <p className="mt-1.5 text-xs leading-5 text-ink-faint">{context}</p> : null}
      </CardContent>
    </Card>
  );
}

// ------------------------------------------------------------------- overview

export function Overview({
  config,
  projection,
  onOpenInputs,
}: {
  config: PlannerConfig;
  projection: ReturnType<typeof calculateProjection>;
  onOpenInputs: () => void;
}) {
  const [zoom, setZoom] = useState<Granularity>("month");
  const [span, setSpan] = useState<YearSpan>(null);
  const s = projection.summary;
  const currency = config.project.currency;

  const planYears = projection.years.length;
  // A shorter horizon can leave a stale span pointing past the end of the plan.
  const shown = clampSpan(span, planYears);
  const months = shown
    ? projection.months.filter(
      (row) => row.index >= shown.from * 12 && row.index < (shown.to + 1) * 12,
    )
    : projection.months;
  const years = shown ? projection.years.slice(shown.from, shown.to + 1) : projection.years;

  function pickYear(year: number) {
    setSpan((current) => {
      const held = clampSpan(current, planYears);
      // One year is showing: a second click opens the view out across both.
      if (held && held.from === held.to) {
        if (held.from === year) return null;
        return { from: Math.min(held.from, year), to: Math.max(held.from, year) };
      }
      return { from: year, to: year };
    });
  }

  // Yearly points keep a multi-year plan readable; monthly shows the swings.
  const cashData =
    zoom === "month"
      ? months.map((row) => ({
        label: row.month,
        closingCash: Math.round(row.closingCash),
        netCashFlow: Math.round(row.netCashFlow),
      }))
      : years.map((year) => ({
        label: year.label,
        closingCash: Math.round(year.closingCash),
        netCashFlow: Math.round(year.netCashFlow),
      }));

  // The same periods read at cost rather than at the bank. `owned` is what the
  // farm has standing on it — feed in the bins and every animal at what has
  // been spent on it — and the line is that less the overdraft and the
  // suppliers. Buildings are in neither: the model carries the places a farm
  // has as a limit on the herd, not as something on a balance sheet.
  const worthPoint = (row: { storeValue: number; netWorth: number; accounting: PeriodAccounting }) => ({
    owned: Math.round(row.storeValue + inventoryTotal(row.accounting.closing)),
    netWorth: Math.round(row.netWorth),
  });
  const worthData =
    zoom === "month"
      ? months.map((row) => ({ label: row.month, ...worthPoint(row) }))
      : years.map((year) => ({ label: year.label, ...worthPoint(year) }));

  const herdData = months.map((row) => ({
    label: row.month,
    piglets: row.piglets,
    weaners: row.weaners,
    growers: row.growers,
    finishers: row.finishers,
    gilts: row.gilts,
    sows: row.sows,
    boars: Math.max(0, row.breedingStock - row.sows),
    total: row.piglets + row.weaners + row.growers + row.finishers + row.gilts + row.breedingStock,
  }));

  const housingCapacity = {
    farrowing: config.housing.farrowingPlaces,
    weaners: config.housing.weanerPlaces,
    growers: config.housing.growerPlaces,
    finishers: config.housing.finisherPlaces,
    sows: config.herd.maxSows,
  };
  const housingPct = (occupants: number, places: number) =>
    places > 0 ? Math.round((occupants / places) * 100) : 0;
  const usesRecordedHousing = config.project.engine === "2.0";
  const housingData = months.map((row) => {
    const farrowingPlaces = row.days > 0
      ? (row.farrowings * (config.reproduction.weaningAgeDays + 7)) / row.days
      : 0;
    const recorded = row.housingPeak;
    return {
      label: row.month,
      farrowing: housingPct(recorded?.farrowing ?? farrowingPlaces, housingCapacity.farrowing),
      weaners: housingPct(recorded?.weaner ?? row.weaners, housingCapacity.weaners),
      growers: housingPct(recorded?.grower ?? row.growers, housingCapacity.growers),
      finishers: housingPct(recorded?.finisher ?? row.finishers, housingCapacity.finishers),
      sows: housingPct(row.sows, housingCapacity.sows),
    };
  });

  const feedPlan = projection.months.reduce(
    (plan, row) => {
      const consumedKg = row.sowFeedKg + row.growingFeedKg;
      const rawInventory = plan.inventoryKg + row.feedDeliveredKg - consumedKg;
      const inventoryKg = Math.abs(rawInventory) < 0.01 ? 0 : rawInventory;
      return {
        inventoryKg,
        rows: [
          ...plan.rows,
          {
            index: row.index,
            label: row.month,
            deliveredKg: Math.round(row.feedDeliveredKg),
            consumedKg: Math.round(consumedKg),
            inventoryKg: Math.max(0, Math.round(inventoryKg)),
            days: row.days,
          },
        ],
      };
    },
    {
      inventoryKg: 0,
      rows: [] as {
        index: number;
        label: string;
        deliveredKg: number;
        consumedKg: number;
        inventoryKg: number;
        days: number;
      }[],
    },
  );
  const allFeedData = feedPlan.rows;
  const visibleIndexes = new Set(months.map((row) => row.index));
  const feedData = allFeedData.filter((row) => visibleIndexes.has(row.index));

  const peakHerd = herdData.reduce(
    (peak, row) => (row.total > peak.total ? row : peak),
    herdData[0] ?? { label: "—", total: 0 },
  );
  const firstMonth = months[0];
  const nextFarrowingMonth = months.find((row) => row.farrowings > 0);
  const nextSaleMonth = months.find((row) => row.pigsSold > 0);
  const firstFeed = feedData[0];
  const firstDailyFeed = firstFeed && firstFeed.days > 0
    ? firstFeed.consumedKg / firstFeed.days
    : 0;
  const feedCoverDays = firstDailyFeed > 0 && firstFeed
    ? firstFeed.inventoryKg / firstDailyFeed
    : 0;
  const visibleTotals = months.reduce(
    (total, row) => ({
      bornAlive: total.bornAlive + row.bornAlive,
      weaned: total.weaned + row.weaned,
      sold: total.sold + row.pigsSold,
    }),
    { bornAlive: 0, weaned: 0, sold: 0 },
  );
  const funnel = [
    { label: "Born alive", value: visibleTotals.bornAlive, color: CHART.stage.piglets },
    { label: "Weaned", value: visibleTotals.weaned, color: CHART.stage.weaners },
    { label: "Sold", value: visibleTotals.sold, color: CHART.stage.finishers },
  ];
  const funnelMax = Math.max(...funnel.map((item) => item.value), 1);
  const breedingEvents = months
    .filter((row) => row.farrowings > 0 || row.weaned > 0)
    .slice(0, 6);

  return (
    <div className="flex flex-col gap-5">
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

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatTile
          label="Peak herd"
          value={plural(peakHerd.total, "pig")}
          context={`Highest month-end head count in ${peakHerd.label}.`}
        />
        <StatTile
          label="Upcoming farrowings"
          value={plural(nextFarrowingMonth?.farrowings ?? 0, "sow")}
          context={nextFarrowingMonth ? `${nextFarrowingMonth.month} forecast.` : "None in this plan window."}
        />
        <StatTile
          label="Feed cover"
          value={`${number(feedCoverDays, 1)} days`}
          context={`Estimated stock left after ${firstMonth?.month ?? "the first month"}.`}
          tone={feedCoverDays < config.feed.feedBufferDays ? "critical" : "neutral"}
        />
        <StatTile
          label="Closing cash"
          value={money(s.closingCash, currency)}
          context={`Lowest point: ${money(s.lowestCash, currency)}.`}
          tone={s.closingCash >= 0 ? "good" : "critical"}
        />
        <StatTile
          label="Ready for sale"
          value={plural(nextSaleMonth?.pigsSold ?? 0, "pig")}
          context={nextSaleMonth ? `Reaching sale weight in ${nextSaleMonth.month}.` : "None in this plan window."}
        />
      </div>

      {planYears > 1 ? (
        <YearSpanPicker
          planYears={planYears}
          span={shown}
          onPick={pickYear}
          onClear={() => setSpan(null)}
          months={months.length}
        />
      ) : null}

      <div className="order-6 grid gap-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(300px,0.75fr)]">
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
                    (zoom === value ? "bg-brand-soft text-brand" : "text-ink-muted hover:text-ink")
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
                  cursor={{ fill: "color-mix(in srgb, var(--color-ink) 5%, transparent)" }}
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
                  dot={cashData.length <= 14 ? { r: 2.5, strokeWidth: 0, fill: CHART.cash } : false}
                  activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--color-surface)" }}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* The same plan read at cost. Cash says whether the farm can survive
              the month; this says whether the money it is spending is going
              into something it still owns. */}
          <div className="mt-5 border-t border-hairline pt-4">
            <p className="text-[13px] font-medium text-ink">
              Farm net worth
              <span className="ml-1.5 text-[10px] font-normal text-ink-faint">experimental</span>
            </p>
            <p className="mt-0.5 text-xs leading-5 text-ink-faint">
              Herd, stores and cash at what they cost, less what is owed. Buildings are not in it.
            </p>
            <div className="mt-3 h-[220px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={worthData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
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
                    cursor={{ fill: "color-mix(in srgb, var(--color-ink) 5%, transparent)" }}
                    contentStyle={TOOLTIP_STYLE}
                  />
                  <Legend
                    iconType="circle"
                    iconSize={8}
                    wrapperStyle={{ fontSize: 12, paddingTop: 12 }}
                  />
                  <ReferenceLine y={0} stroke={CHART.baseline} />
                  <Area
                    dataKey="owned"
                    name="Herd and stores at cost"
                    stroke="none"
                    fill={CHART.stage.sows}
                    fillOpacity={0.35}
                    isAnimationActive={false}
                  />
                  <Line
                    dataKey="netWorth"
                    name="Net worth"
                    stroke={CHART.stage.finishers}
                    strokeWidth={2}
                    dot={
                      worthData.length <= 14
                        ? { r: 2.5, strokeWidth: 0, fill: CHART.stage.finishers }
                        : false
                    }
                    activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--color-surface)" }}
                    isAnimationActive={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        </Panel>

        <Panel title="What needs attention" description="Checks run against your current inputs.">
          <div className="space-y-2.5">
            {projection.warnings.slice(0, 4).map((warning) => (
              <div
                key={warning.title}
                className={`rounded-lg border p-3 ${warning.level === "attention"
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
            type="button"
            onClick={onOpenInputs}
            className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-lg border border-hairline px-4 py-2 text-sm font-medium text-ink-muted transition hover:bg-raised hover:text-ink"
          >
            Review assumptions <ChevronRight size={14} />
          </button>
        </Panel>
      </div>

      <Panel
        className="order-4"
        title="Herd composition over time"
        description="Month-end head count by production stage. Use the year control above to inspect a shorter window."
      >
        <div className="h-[340px]">
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
                  stroke="var(--color-surface)"
                  strokeWidth={2}
                  isAnimationActive={false}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Panel>

      <div className="order-5 grid gap-5 xl:grid-cols-2">
        <Panel
          title="Housing pressure"
          description={
            usesRecordedHousing
              ? "Peak daily room occupancy against entered capacity. Capacity is shown for planning and is not currently enforced."
              : "Estimated places used against entered capacity. Switch to the 2.0 engine for recorded daily room occupancy."
          }
        >
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={housingData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={CHART.grid} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: CHART.axis }}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={28}
                />
                <YAxis
                  tickFormatter={(value) => `${value}%`}
                  tick={{ fontSize: 11, fill: CHART.axis }}
                  tickLine={false}
                  axisLine={false}
                  width={46}
                />
                <Tooltip
                  formatter={(value) => `${number(Number(value), 0)}% used`}
                  contentStyle={TOOLTIP_STYLE}
                />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 12 }} />
                <ReferenceLine
                  y={100}
                  stroke={CHART.flow}
                  strokeDasharray="5 4"
                  label={{ value: "capacity", fill: CHART.flow, fontSize: 10, position: "insideTopRight" }}
                />
                {(
                  [
                    ["farrowing", "Farrowing", CHART.flow],
                    ["weaners", "Weaner", CHART.stage.weaners],
                    ["growers", "Grower", CHART.stage.growers],
                    ["finishers", "Finisher", CHART.stage.finishers],
                    ["sows", "Sow", CHART.stage.sows],
                  ] as const
                ).map(([key, name, color]) => (
                  <Line
                    key={key}
                    type="monotone"
                    dataKey={key}
                    name={name}
                    stroke={color}
                    strokeWidth={2}
                    dot={housingData.length <= 14 ? { r: 2, strokeWidth: 0, fill: color } : false}
                    isAnimationActive={false}
                  />
                ))}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-3 text-[11px] leading-5 text-ink-faint">
            Entered capacity: {housingCapacity.farrowing} farrowing, {housingCapacity.weaners} weaner,
            {" "}{housingCapacity.growers} grower, {housingCapacity.finishers} finisher and {housingCapacity.sows} sow places.
          </p>
        </Panel>

        <Panel
          title="Feed demand and inventory"
          description="Monthly deliveries and consumption, with the estimated physical balance carried forward."
        >
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={feedData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={CHART.grid} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: CHART.axis }}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={28}
                />
                <YAxis
                  yAxisId="flow"
                  tickFormatter={(value) => `${number(value / 1000, 1)}t`}
                  tick={{ fontSize: 11, fill: CHART.axis }}
                  tickLine={false}
                  axisLine={false}
                  width={48}
                />
                <YAxis
                  yAxisId="stock"
                  orientation="right"
                  tickFormatter={(value) => `${number(value / 1000, 1)}t`}
                  tick={{ fontSize: 11, fill: CHART.axis }}
                  tickLine={false}
                  axisLine={false}
                  width={48}
                />
                <Tooltip
                  formatter={(value) => `${number(Number(value), 0)} kg`}
                  contentStyle={TOOLTIP_STYLE}
                />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 12 }} />
                <Bar
                  yAxisId="flow"
                  dataKey="deliveredKg"
                  name="Delivered"
                  fill={CHART.stage.sows}
                  radius={[3, 3, 0, 0]}
                  maxBarSize={16}
                  isAnimationActive={false}
                />
                <Bar
                  yAxisId="flow"
                  dataKey="consumedKg"
                  name="Consumed"
                  fill={CHART.warning}
                  radius={[3, 3, 0, 0]}
                  maxBarSize={16}
                  isAnimationActive={false}
                />
                <Line
                  yAxisId="stock"
                  type="monotone"
                  dataKey="inventoryKg"
                  name="Closing inventory"
                  stroke={CHART.cash}
                  strokeWidth={2}
                  dot={feedData.length <= 14 ? { r: 2.5, strokeWidth: 0, fill: CHART.cash } : false}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      <div className="order-7 grid gap-5 xl:grid-cols-2">
        <Panel
          title="Production funnel"
          description="Animal movements in the selected period. Opening stock means these are flow totals, not one birth cohort."
        >
          <div className="space-y-5">
            {funnel.map((item) => (
              <div key={item.label}>
                <div className="mb-1.5 flex items-baseline justify-between gap-4 text-xs">
                  <span className="font-medium text-ink-muted">{item.label}</span>
                  <span className="font-semibold tabular-nums text-ink">{number(item.value, 0)}</span>
                </div>
                <div className="h-3 overflow-hidden rounded-full bg-raised">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.max(2, (item.value / funnelMax) * 100)}%`,
                      backgroundColor: item.color,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Upcoming breeding events" description="The next active months in the selected plan window.">
          {breedingEvents.length > 0 ? (
            <div className="divide-y divide-hairline">
              {breedingEvents.map((row) => (
                <div
                  key={row.index}
                  className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 py-2.5 text-xs"
                >
                  <span className="font-medium text-ink">{row.month}</span>
                  <span className="rounded-full bg-good-soft px-2 py-1 text-good">
                    {number(row.farrowings, 0)} farrow
                  </span>
                  <span className="rounded-full bg-brand-soft px-2 py-1 text-brand">
                    {number(row.weaned, 0)} wean
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-ink-muted">No farrowings or weanings fall inside this period.</p>
          )}
        </Panel>
      </div>
    </div>
  );
}

/** A run of plan years the charts are held to, or null for the whole plan. */
type YearSpan = { from: number; to: number } | null;

function clampSpan(span: YearSpan, planYears: number): YearSpan {
  if (!span || planYears < 1) return null;
  const last = planYears - 1;
  const from = Math.min(Math.max(span.from, 0), last);
  const to = Math.min(Math.max(span.to, 0), last);
  const low = Math.min(from, to);
  const high = Math.max(from, to);
  return low === 0 && high === last ? null : { from: low, to: high };
}

/**
 * Picks the years the Overview charts cover. One click holds the charts to a
 * single year; a second click stretches the view to take in everything between,
 * which is why the years shown can only ever be a continuous run.
 */
function YearSpanPicker({
  planYears,
  span,
  onPick,
  onClear,
  months,
}: {
  planYears: number;
  span: YearSpan;
  onPick: (year: number) => void;
  onClear: () => void;
  months: number;
}) {
  const caption = !span
    ? `The whole plan, Year 1 to Year ${planYears}. Click a year to look at it on its own.`
    : span.from === span.to
      ? `Year ${span.from + 1} on its own. Click another year to stretch the view across both.`
      : `Year ${span.from + 1} to Year ${span.to + 1}, ${months} months. Click any year to start again.`;

  function chip(active: boolean) {
    return (
      "rounded-lg border px-2.5 py-1 text-xs font-medium transition " +
      (active
        ? "border-brand/40 bg-brand-soft text-brand"
        : "border-hairline text-ink-muted hover:bg-raised hover:text-ink")
    );
  }

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-hairline bg-surface p-4 lg:flex-row lg:items-center lg:justify-between">
      <div>
        <p className="text-[13px] font-medium text-ink">Years in view</p>
        <p className="mt-0.5 text-xs text-ink-muted">{caption}</p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" onClick={onClear} aria-pressed={!span} className={chip(!span)}>
          All years
        </button>
        {Array.from({ length: planYears }, (unusedYear, year) => {
          const active = span !== null && year >= span.from && year <= span.to;
          return (
            <button
              key={year}
              type="button"
              onClick={() => onPick(year)}
              aria-pressed={active}
              className={chip(active)}
            >
              Year {year + 1}
            </button>
          );
        })}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ simulator

/**
 * The calendar and the day panel, read off the plan's one run.
 *
 * The run is handed in rather than started here. It used to run the farm twice
 * over on its own account — once for the timeline and again for the selected
 * day — on top of the run the cashflow page had already made of the same plan,
 * and a fourth time every time somebody picked another date. Now it runs once,
 * in a worker, and a date is an index into what came back.
 */
export function Simulator({ simulation }: { simulation: PlanSimulationResult }) {
  const config = simulation.config;
  const start = parseISO(config.project.startDate);
  const end = addMonths(start, config.project.months);
  const lastDay = subDays(end, 1);
  const currency = config.project.currency;

  const timeline = simulation.timeline;
  const [view, setView] = useState<TimelineView>("calendar");
  const [picked, setPicked] = useState(() => config.project.startDate);
  const [yearIndex, setYearIndex] = useState(0);
  const [dayOpen, setDayOpen] = useState(false);
  const [savingLog, setSavingLog] = useState(false);

  /**
   * The farm's own log of the run, as a CSV.
   *
   * Asked for rather than held with the timeline, because the whole of it is
   * wanted only when somebody wants it — a five year plan writes thousands of
   * lines the calendar never shows, and carrying them in every result to serve
   * a button nobody has pressed is the wrong trade. So it is a farm run of its
   * own, and it goes to a worker of its own: it used to run here, which took
   * the page away for as long as the run.
   */
  async function downloadEventLog() {
    if (savingLog) return;
    setSavingLog(true);
    try {
      const [{ eventLogCsv, eventLogFilename }, { runSimulationJob }] = await Promise.all([
        import("@/lib/export-event-log"),
        import("@/workers/simulation-client"),
      ]);
      const answer = await runSimulationJob({ type: "event-log", config });
      if (answer.type !== "event-log") throw new Error("The farm answered the wrong question.");
      const blob = new Blob([eventLogCsv(answer.events)], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = eventLogFilename(config);
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (error) {
      console.error(error);
      window.alert("The event log could not be created. Please try again.");
    } finally {
      setSavingLog(false);
    }
  }

  // A new plan can move the horizon out from under the chosen day.
  const selected = useMemo(() => {
    const chosen = parseISO(picked).getTime();
    if (Number.isNaN(chosen)) return format(start, "yyyy-MM-dd");
    if (chosen < start.getTime()) return format(start, "yyyy-MM-dd");
    if (chosen > lastDay.getTime()) return format(lastDay, "yyyy-MM-dd");
    return picked;
  }, [picked, start, lastDay]);

  // A lookup into the run, not a run: the farm was read on every day of the
  // plan as it went, and this picks that day's figures out of the columns.
  const state = useMemo(
    () => daySnapshotAt(simulation, `${selected}T23:00`),
    [simulation, selected],
  );
  const byDate = useMemo(
    () => new Map(timeline.days.map((day) => [day.date, day])),
    [timeline],
  );
  const selectedDay = byDate.get(selected) ?? null;
  const selectedMonth =
    timeline.months.find((month) => selected >= month.date && selected <= month.endDate) ?? null;

  // The panel is headed by a day or by a month, and what it shows standing on
  // the farm has to be read on the day it is headed by. A month is read at its
  // last day: picking a day and then switching to months would otherwise put
  // the month's herd beside that day's money, and the two would not foot.
  const panelDate = view === "months" ? (selectedMonth?.endDate ?? selected) : selected;
  const panelState = useMemo(
    () => daySnapshotAt(simulation, `${panelDate}T23:00`),
    [simulation, panelDate],
  );

  // The calendar shows a whole plan year at a time, so a year is the unit the
  // arrows move by.
  const planYears = Math.max(1, Math.ceil(config.project.months / 12));
  const year = Math.min(Math.max(yearIndex, 0), planYears - 1);
  const yearStart = addMonths(startOfMonth(start), year * 12);
  const monthsThisYear = Math.min(12, config.project.months - year * 12);

  function choose(date: string, open = true) {
    setPicked(date);
    const months = differenceInCalendarMonths(parseISO(date), startOfMonth(start));
    setYearIndex(Math.floor(months / 12));
    if (open) setDayOpen(true);
  }

  /**
   * Each square carries a dot for the kinds of thing that happened on it, so a
   * year of the plan can be read for shape before any day is opened.
   */
  const DayCell = useMemo(() => {
    function DayCell(props: React.ComponentProps<typeof CalendarDayButton>) {
      const entry = byDate.get(format(props.day.date, "yyyy-MM-dd"));
      const dots = entry
        ? MARK_ORDER.filter((colour) =>
          entry.events.some((event) => DAY_MARKS[event.type] === colour),
        )
        : [];
      return (
        // The day button stamps data-day with a locale-formatted date. Left to
        // the ambient locale that is one string on the server and another in the
        // browser, which fails hydration, so the format is pinned here.
        <CalendarDayButton {...props} locale={{ code: "en-GB" }}>
          {props.children}
          <span className="flex h-1 items-center justify-center gap-0.5 opacity-100!">
            {dots.map((colour) => (
              <span
                key={colour}
                className="size-1 rounded-full"
                style={{ backgroundColor: colour }}
              />
            ))}
          </span>
        </CalendarDayButton>
      );
    }
    return DayCell;
  }, [byDate]);

  const costLines = EXPENSE_CATEGORIES.map((category) => ({
    label: CATEGORY_LABELS[category],
    amount: state.finance.totals[category],
  }));
  const incomeLines = INCOME_CATEGORIES.map((category) => ({
    label: CATEGORY_LABELS[category],
    amount: state.finance.totals[category],
  }));

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-ink">Farm simulator</h2>
        <p className="mt-1.5 max-w-3xl text-sm leading-6 text-ink-muted">
          A year of the plan at a time. Open any date to see what the farm did that day, what it
          took in and paid out, and every animal standing on it. The event log takes the whole run
          away as a spreadsheet, line by line, in the order the farm wrote it.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            <p className="font-semibold text-ink">
              Plan year {year + 1}
              <span className="ml-2 font-normal text-ink-faint">
                {format(yearStart, "MMM yyyy")} –{" "}
                {format(addMonths(yearStart, monthsThisYear - 1), "MMM yyyy")}
              </span>
            </p>
          </CardTitle>
          <CardAction className="flex flex-wrap items-center justify-end gap-2">
            <ToggleGroup
              type="single"
              size="sm"
              variant="outline"
              value={view}
              onValueChange={(next) => {
                if (next) setView(next as TimelineView);
              }}
              aria-label="Timeline view"
            >
              <ToggleGroupItem value="calendar" aria-label="Calendar of days">
                <CalendarDays size={14} />
                Calendar
              </ToggleGroupItem>
              <ToggleGroupItem value="months" aria-label="List of months">
                <Rows3 size={14} />
                Months
              </ToggleGroupItem>
            </ToggleGroup>
            <Button
              variant="outline"
              size="sm"
              disabled={savingLog}
              onClick={downloadEventLog}
            >
              <Download size={14} />
              {savingLog ? "Preparing…" : "Event log"}
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          {view === "calendar" ? (
            <div>
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="Previous plan year"
                    disabled={year === 0}
                    onClick={() => setYearIndex(year - 1)}
                  >
                    <ChevronLeft size={16} />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="Next plan year"
                    disabled={year >= planYears - 1}
                    onClick={() => setYearIndex(year + 1)}
                  >
                    <ChevronRight size={16} />
                  </Button>

                </div>
                <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ink-faint">
                  <Marker color={CHART.stage.sows}>Service, in pig, farrowing</Marker>
                  <Marker color={CHART.stage.gilts}>Weaning and stage changes</Marker>
                  <Marker color={CHART.cash}>Sale</Marker>
                  <Marker color={CHART.warning}>Feed lorry</Marker>
                </p>
              </div>
              <Calendar
                mode="single"
                required
                selected={parseISO(selected)}
                onSelect={(date) => {
                  if (date) choose(format(date, "yyyy-MM-dd"));
                }}
                month={yearStart}
                numberOfMonths={monthsThisYear}
                hideNavigation
                showOutsideDays={false}
                startMonth={startOfMonth(start)}
                endMonth={startOfMonth(lastDay)}
                disabled={{ before: start, after: lastDay }}
                components={{ DayButton: DayCell }}
                className="w-full p-0 [--cell-size:--spacing(9)]"
                classNames={{
                  months:
                    "grid w-full grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4",
                  month_caption: "flex h-8 items-center",
                  caption_label: "text-[13px] font-semibold text-ink",
                }}
              />
            </div>
          ) : (
            <ScrollArea className="h-[520px] w-full rounded-xl border border-hairline">
              <ul className="divide-y divide-hairline">
                {timeline.months.map((month) => {
                  const active = selected >= month.date && selected <= month.endDate;
                  return (
                    <li key={month.date}>
                      <button
                        type="button"
                        onClick={() => choose(month.endDate)}
                        className={`flex w-full items-center gap-3 px-4 py-3 text-left transition ${active ? "bg-brand-soft" : "hover:bg-plane"
                          }`}
                      >
                        <span className="min-w-0 flex-1">
                          <span
                            className={`block text-sm font-semibold ${active ? "text-brand" : "text-ink"}`}
                          >
                            {month.label}
                          </span>
                          <span className="mt-0.5 block text-xs text-ink-faint">
                            {number(month.total, 0)} head · {number(month.sold, 0)} sold ·{" "}
                            {plural(month.lorriesIn, "lorry", "lorries")} ·{" "}
                            {money(month.netCashFlow, currency)} net
                          </span>
                        </span>
                        <ChevronRight
                          size={16}
                          className={active ? "text-brand" : "text-ink-faint"}
                        />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </ScrollArea>
          )}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-plane px-4 py-3">
            <div>
              <p className="text-xs text-ink-faint">Showing the farm as it stood on</p>
              <p className="text-sm font-semibold text-ink">
                {format(parseISO(state.date), "EEEE d MMMM yyyy")} · day {state.day + 1}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => setDayOpen(true)}>
              {view === "months" ? "Open this month" : "Open this day"}
              <ChevronRight size={14} />
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Financial standing</CardTitle>
            <CardDescription>
              Everything posted to the ledger between the start date and{" "}
              {format(parseISO(state.date), "d MMM yyyy")}.
            </CardDescription>
          </CardHeader>
          <CardContent>
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
                <tr className="border-b border-hairline">
                  <td className="py-2 font-medium">Cash on hand</td>
                  <td
                    className={`py-2 text-right font-semibold tabular-nums ${state.finance.cash < 0 ? "text-critical" : ""
                      }`}
                  >
                    {money(state.finance.cash, currency)}
                  </td>
                </tr>
                <tr className="border-b border-hairline">
                  <td className="py-2 font-medium">Net worth</td>
                  <td className="py-2 text-right font-semibold tabular-nums">
                    {money(state.finance.netWorth, currency)}
                  </td>
                </tr>
                {/* The same day at cost rather than at what the stock might
                    fetch. It is the experimental reading, so it is shown under
                    the established one and labelled as what it is. */}
                <tr>
                  <td className="py-2 font-medium">
                    Net worth at cost
                    <span className="ml-1.5 text-[10px] font-normal text-ink-faint">
                      experimental
                    </span>
                  </td>
                  <td className="py-2 text-right font-semibold tabular-nums">
                    {money(state.finance.valuation.netWorth, currency)}
                  </td>
                </tr>
              </tbody>
            </table>
            <p className="mt-3 text-xs leading-5 text-ink-faint">
              At cost the farm is holding{" "}
              {money(
                state.finance.valuation.inventory.marketLivestock +
                  state.finance.valuation.inventory.replacementGilts,
                currency,
              )}{" "}
              of livestock and{" "}
              {money(
                state.finance.valuation.breedingAssets.sows +
                  state.finance.valuation.breedingAssets.boars,
                currency,
              )}{" "}
              of breeding stock.
            </p>
            <p className="mt-3 text-xs leading-5 text-ink-faint">
              Cash plus {money(state.finance.herdValue, currency)} of stock on hand. Last 30 days:{" "}
              {money(state.finance.last30Days.income, currency)} in,{" "}
              {money(state.finance.last30Days.expenses, currency)} out, net{" "}
              <span className={state.finance.last30Days.net < 0 ? "text-critical" : "text-good"}>
                {money(state.finance.last30Days.net, currency)}
              </span>
              .
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>What a market pig costs</CardTitle>
            <CardDescription>
              Averaged over every pig sold so far. The stage bars are the pig&apos;s own bill; the
              breeding herd it came out of is carried underneath.
            </CardDescription>
          </CardHeader>
          <CardContent>
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
          </CardContent>
        </Card>
      </div>

      <DetailPanel
        open={dayOpen}
        onOpenChange={setDayOpen}
        view={view}
        day={selectedDay}
        month={selectedMonth}
        monthEnd={selectedMonth ? (byDate.get(selectedMonth.endDate) ?? null) : null}
        state={panelState}
        config={config}
      />
    </div>
  );
}

/** A coloured dot beside a word, for the calendar's key. */
function Marker({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="size-1.5 rounded-full" style={{ backgroundColor: color }} aria-hidden />
      {children}
    </span>
  );
}

/**
 * The panel the timeline opens into. A day shows what the farm did and what was
 * standing on it; a month shows the same, led by the income and expenditure the
 * month posted — which is the question a month-at-a-time view is being asked.
 */
function DetailPanel({
  open,
  onOpenChange,
  view,
  day,
  month,
  monthEnd,
  state,
  config,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  view: TimelineView;
  day: FarmCalendarDay | null;
  month: FarmCalendarMonth | null;
  monthEnd: FarmCalendarDay | null;
  state: DaySnapshot;
  config: PlannerConfig;
}) {
  const currency = config.project.currency;
  const months = view === "months";
  const herd = months ? monthEnd : day;
  const events = months ? month?.events : day?.events;
  if (months ? !month : !day) return null;

  const counts = herd?.counts ?? null;
  const groups = counts
    ? herdGroups(counts, state.valueAtCost).filter((group) => group.count > 0)
    : [];
  // A bin with nothing in it is not standing on the farm, and this section is
  // what is standing on the farm.
  const stores = state.stores.filter((store) => store.quantity > 0);
  const worth = farmWorthLines(state.finance);
  // A category at nothing is a category the month did not have. Printing all
  // fifteen of them buries the three that happened under a column of zeroes,
  // so only the lines that moved are shown. The totals under them are printed
  // whatever they come to: a month with no money in is a fact to read, not a
  // gap to leave out.
  const moved = (category: LedgerCategory) => (month?.totals[category] ?? 0) !== 0;
  const income = INCOME_CATEGORIES.filter(moved);
  const expenses = EXPENSE_CATEGORIES.filter(moved);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 sm:max-w-lg">
        <SheetHeader className="shrink-0 border-b border-hairline">
          <p className="text-xs font-medium text-brand">
            {months
              ? `Month ${(month?.index ?? 0) + 1} of the plan`
              : `Day ${(day?.day ?? 0) + 1} of the plan`}
          </p>
          <SheetTitle>
            {months
              ? month?.label
              : format(parseISO(day?.date ?? state.date), "EEEE d MMMM yyyy")}
          </SheetTitle>
          <SheetDescription>
            {number(herd?.total ?? 0, 0)} head on the farm
            {months ? " at the end of the month" : " when the day closed"}.
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-6 px-4 py-5">
            {months && month ? (
              <section>
                <h4 className="text-sm font-semibold text-ink">Income and expenditure</h4>
                <table className="mt-3 w-full text-sm">
                  <tbody>
                    {income.map((category) => (
                      <tr key={category} className="border-b border-hairline">
                        <td className="py-1.5 text-ink-muted">{CATEGORY_LABELS[category]}</td>
                        <td className="py-1.5 text-right tabular-nums">
                          {money(month.totals[category], currency)}
                        </td>
                      </tr>
                    ))}
                    <tr className="border-b border-hairline">
                      <td className="py-2 font-medium">Money in</td>
                      <td className="py-2 text-right font-medium tabular-nums">
                        {money(month.cashIn, currency)}
                      </td>
                    </tr>
                    {expenses.map((category) => (
                      <tr key={category} className="border-b border-hairline">
                        <td className="py-1.5 text-ink-muted">{CATEGORY_LABELS[category]}</td>
                        <td className="py-1.5 text-right tabular-nums">
                          {money(month.totals[category], currency)}
                        </td>
                      </tr>
                    ))}
                    <tr className="border-b border-hairline">
                      <td className="py-2 font-medium">Money out</td>
                      <td className="py-2 text-right font-medium tabular-nums">
                        {money(month.cashOut, currency)}
                      </td>
                    </tr>
                    <tr className="border-b border-hairline">
                      <td className="py-2 font-medium">Net for the month</td>
                      <td
                        className={`py-2 text-right font-semibold tabular-nums ${month.netCashFlow < 0 ? "text-critical" : "text-good"
                          }`}
                      >
                        {money(month.netCashFlow, currency)}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-2 font-medium">Cash at month end</td>
                      <td
                        className={`py-2 text-right font-semibold tabular-nums ${month.closingCash < 0 ? "text-critical" : ""
                          }`}
                      >
                        {money(month.closingCash, currency)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </section>
            ) : null}
            
            <section>
              <h4 className="text-sm font-semibold text-ink">What the farm is worth on the day</h4>
              <dl className="mt-3 space-y-1.5">
                {worth.map((line) => (
                  <div
                    key={line.label}
                    className={
                      line.total
                        ? "mt-2.5 flex items-baseline justify-between gap-3 border-t border-hairline pt-2.5"
                        : "flex items-baseline justify-between gap-3 border-b border-hairline pb-1.5"
                    }
                  >
                    <dt
                      className={
                        line.total ? "text-xs font-medium text-ink" : "text-xs text-ink-muted"
                      }
                    >
                      {line.label}
                    </dt>
                    <dd
                      className={
                        "text-sm tabular-nums " +
                        (line.total ? "font-semibold " : "font-medium ") +
                        (line.amount < 0 ? "text-critical" : "text-ink")
                      }
                    >
                      {money(line.amount, currency)}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>

            <section>
              <h4 className="text-sm font-semibold text-ink">
                {months ? "Activities this month" : "Activities"}
              </h4>
              {events && events.length > 0 ? (
                <ul className="mt-3 space-y-2">
                  {events.map((event, index) => (
                    <li
                      key={`${event.type}-${index}`}
                      className="flex items-start gap-2.5 text-sm text-ink-muted"
                    >
                      <span
                        className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${EVENT_TONES[event.type]}`}
                      >
                        {EVENT_NAMES[event.type]}
                      </span>
                      <span className="min-w-0">{event.label}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-sm text-ink-faint">
                  {months
                    ? "A quiet month: the herd is fed and grown, and nothing else falls due."
                    : "A quiet day: the herd is fed and grown, and nothing else falls due."}
                </p>
              )}
            </section>

            <section>
              <h4 className="text-sm font-semibold text-ink">In the stores</h4>
              <p className="mt-1 text-xs leading-5 text-ink-faint">
                What is standing on the farm at the close of this day, and how long the herd
                can go on it at the rate it is using it now.
              </p>
              {stores.length > 0 ? (
                <dl className="mt-3 space-y-1.5">
                  {stores.map((store) => (
                    <div
                      key={store.id}
                      className="flex items-baseline justify-between gap-3 border-b border-hairline pb-1.5 last:border-0"
                    >
                      <dt className="text-xs text-ink-muted">
                        {store.label}
                        {store.capacity !== null ? (
                          <span className="ml-1.5 text-[11px] text-ink-faint">
                            of {number(store.capacity, 0)} {store.unit}
                          </span>
                        ) : null}
                      </dt>
                      <dd className="flex items-baseline gap-2.5 text-right">
                        <span className="text-[11px] text-ink-faint">
                          {store.daysOfCover === null
                            ? "—"
                            : `${number(store.daysOfCover, 0)} days`}
                        </span>
                        <span className="text-sm font-medium tabular-nums text-ink">
                          {number(store.quantity, 0)} {store.unit}
                        </span>
                        <span className="w-16 text-[11px] tabular-nums text-ink-faint">
                          {money(store.value, currency)}
                        </span>
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="mt-3 text-sm text-ink-faint">
                  Every store is empty at the close of this day.
                </p>
              )}
              <p className="mt-2.5 text-xs leading-5 text-ink-faint">
                {money(state.finance.storeValue, currency)} of goods bought and not yet used,
                which is part of what the farm is worth.
              </p>
            </section>

            <section>
              <h4 className="text-sm font-semibold text-ink">Pigs on the farm</h4>
              
              {groups.length > 0 ? (
                <dl className="mt-3 space-y-1.5">
                  {groups.map((group) => (
                    <div
                      key={group.label}
                      className="flex items-baseline justify-between gap-3 border-b border-hairline pb-1.5 last:border-0"
                    >
                      <dt className="text-xs text-ink-muted">{group.label}</dt>
                      <dd className="flex items-baseline gap-2.5 text-right">
                        <span className="text-sm font-medium tabular-nums text-ink">
                          {number(group.count, 0)} head
                        </span>
                        <span className="w-20 text-[11px] tabular-nums text-ink-faint">
                          {money(group.value, currency)}
                        </span>
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="mt-3 text-sm text-ink-faint">
                  No animals are standing on the farm on this day.
                </p>
              )}
              {counts ? (
                <p className="mt-2.5 text-xs leading-5 text-ink-faint">
                  {number(counts.total, 0)} head in all, carrying{" "}
                  {number(state.liveweightKg, 0)} kg of liveweight.
                  {counts.replacementPipeline > 0 ? (
                    <>
                      {" "}
                      {plural(counts.replacementPipeline, "gilt")}{" "}
                      {counts.replacementPipeline === 1 ? "is" : "are"} growing on{" "}
                      {counts.sows > 0
                        ? `to replace the ${plural(counts.sows, "sow")} in the herd.`
                        : "to start the breeding herd, which has no sow in it."}
                    </>
                  ) : counts.sows === 0 ? (
                    " There is no breeding female on the farm, so no litter is coming."
                  ) : null}
                </p>
              ) : null}
            </section>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

// ------------------------------------------------------------- starting stock

/**
 * The shape of every box on the starting-stock form, so they match.
 *
 * A box carries a hairline of its own rather than waiting for a hover to show
 * one: bare numbers do not look like something you can type into, and typing
 * into them is the whole of what this section is for.
 */
const CELL_FIELD =
  "rounded-md border border-hairline bg-plane px-2 py-1.5 text-sm text-ink outline-none transition placeholder:text-ink-faint hover:border-rule focus:border-brand focus:ring-2 focus:ring-brand/25";
const CELL_NUMBER = CELL_FIELD + " text-right tabular-nums";
/** A dropdown standing among the boxes: the trigger sits the way an input does. */
const CELL_SELECT = "h-9 rounded-md border-hairline bg-plane px-2 hover:border-rule";

/**
 * A change to one animal, whatever kind it is.
 *
 * The kinds are a discriminated union, and a patch is a few keys off one arm of
 * it. Narrowing that properly at every box would cost more than it buys, so the
 * patch is loose here and the row it lands on is the thing that keeps its
 * shape: a box only ever appears on the kind whose field it edits.
 */
type StartingStockPatch = Partial<
  Omit<StartingSowEntry, "type"> & Omit<StartingBoarEntry, "type">
>;

/** A box on the history line, narrow and captioned. */
function HistoryBox({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex shrink-0 items-center gap-1.5">
      <span className="text-[11px] text-ink-faint">{label}</span>
      {children}
    </label>
  );
}

/**
 * What a sow or a boar is carrying that its age cannot say.
 *
 * Shown only on the kinds it means anything for, under the three lines every
 * animal answers. A growing pig has no working history, so it gets none of this
 * and its row stays a single line.
 */
function StartingStockHistory({
  entry,
  index,
  config,
  onPatch,
  optionalNumber,
}: {
  entry: StartingStockEntry;
  index: number;
  config: PlannerConfig;
  onPatch: (index: number, patch: StartingStockPatch) => void;
  optionalNumber: (text: string) => number | undefined;
}) {
  const label = (what: string) => "Animal " + (index + 1) + " " + what;
  const line = "mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 pl-3";

  if (entry.type === "boar") {
    return (
      <div className={line}>
        <HistoryBox label="Months in service">
          <input
            type="number"
            min={0}
            max={120}
            step={1}
            value={entry.monthsInService}
            aria-label={label("months in service")}
            title="How long he has been working, which is what his rotation and his write-off are counted from. His age is a separate thing."
            onChange={(event) =>
              onPatch(index, { monthsInService: Math.max(0, Number(event.target.value)) })
            }
            className={CELL_NUMBER + " w-20"}
          />
        </HistoryBox>
      </div>
    );
  }

  if (entry.type !== "sow") return null;

  return (
    <div className={line}>
      <HistoryBox label="Parity">
        <input
          type="number"
          min={0}
          max={12}
          step={1}
          value={entry.parity}
          aria-label={label("parity")}
          title="Litters she has already had. It decides when she is culled and what is left of her value to write off."
          onChange={(event) =>
            onPatch(index, {
              parity: Math.min(12, Math.max(0, Math.round(Number(event.target.value)))),
            })
          }
          className={CELL_NUMBER + " w-16"}
        />
      </HistoryBox>
      <Select
        value={entry.reproductiveState}
        onValueChange={(value) =>
          onPatch(index, {
            reproductiveState: value as StartingSowEntry["reproductiveState"],
          })
        }
      >
        <SelectTrigger
          aria-label={label("reproductive state")}
          className={CELL_SELECT + " h-8 w-44"}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="open">Open, due to serve</SelectItem>
          <SelectItem value="gestating">In pig</SelectItem>
          <SelectItem value="lactating">Suckling a litter</SelectItem>
        </SelectContent>
      </Select>
      {entry.reproductiveState === "gestating" ? (
        <HistoryBox label="Days pregnant">
          <input
            type="number"
            min={0}
            max={config.reproduction.gestationDays}
            step={1}
            value={entry.daysPregnant ?? ""}
            placeholder="spread"
            aria-label={label("days pregnant")}
            title={
              "How far into this pregnancy she is, which fixes the day she farrows. Left empty, she is spread across the " +
              Math.round(config.reproduction.gestationDays) +
              " days of gestation with the others."
            }
            onChange={(event) =>
              onPatch(index, { daysPregnant: optionalNumber(event.target.value) })
            }
            className={CELL_NUMBER + " w-20"}
          />
        </HistoryBox>
      ) : null}
      {entry.reproductiveState === "lactating" ? (
        <HistoryBox label="Days since farrowing">
          <input
            type="number"
            min={0}
            max={config.reproduction.weaningAgeDays}
            step={1}
            value={entry.daysSinceFarrowing ?? ""}
            placeholder="spread"
            aria-label={label("days since farrowing")}
            title={
              "How long this litter has been on her, which fixes the day she weans and comes back into heat. Left empty, she is spread across the " +
              Math.round(config.reproduction.weaningAgeDays) +
              " days of lactation with the others."
            }
            onChange={(event) =>
              onPatch(index, { daysSinceFarrowing: optionalNumber(event.target.value) })
            }
            className={CELL_NUMBER + " w-20"}
          />
        </HistoryBox>
      ) : null}
    </div>
  );
}

/** The widths the caption strip and every animal's line are both laid out on. */
const AGE_WIDTH = "w-24 sm:w-28";
const WORTH_WIDTH = "w-24 sm:w-32";

/**
 * What the farm already owns on the day the plan opens, animal by animal.
 *
 * A head count cannot say what a herd is worth, and the plan has no way to work
 * it out: a bought-in gilt cost what she cost, and rebuilding her value from
 * what she would have cost to rear here is a history this farm did not have. So
 * the farmer says it, one animal at a time, and these animals are what the plan
 * starts with — there is no head count kept anywhere else to fall out of step
 * with them.
 *
 * Three things are asked of every animal alike: what it is, what it is worth,
 * and how old it is. Age is the one clock. It is what says how much a pig
 * weighs and how far through its stage it stands, so nothing is asked twice in
 * different units, and the same line does for a suckling piglet and a boar.
 */
function StartingStock({
  config,
  entries,
  onAdd,
  onChangeType,
  onPatch,
  onRemove,
  optionalNumber,
  className,
}: {
  config: PlannerConfig;
  entries: readonly StartingStockEntry[];
  onAdd: (type: StartingStockType) => void;
  onChangeType: (index: number, type: StartingStockType) => void;
  onPatch: (index: number, patch: StartingStockPatch) => void;
  onRemove: (index: number) => void;
  optionalNumber: (text: string) => number | undefined;
  className?: string;
}) {
  const currency = config.project.currency;
  const worth = openingStockValue(config);
  const counts = openingCounts(config);
  const full = entries.length >= MAX_STARTING_STOCK_ROWS;
  const herd = STARTING_STOCK_TYPES.filter((type) => counts[type] > 0).map(
    (type) => number(counts[type], 0) + " " + STARTING_STOCK_LABELS[type].toLowerCase(),
  );

  return (
    <SectionCard
      className={className}
      title="Starting flock"
      description="Every animal the farm already has on day one, and what it is worth. An opening balance: it lifts what the farm owns without any of it being a cost, a payment or a sale in month one."
      icon={Scale}
    >
      {entries.length > 0 ? (
        <>
          <div className="flex items-center gap-2 px-1 pb-1.5 text-[11px] font-medium text-ink-faint">
            <span className="flex-1">Animal</span>
            <span className={WORTH_WIDTH + " text-right"}>Worth ({currency})</span>
            <span className={AGE_WIDTH + " text-right"}>Age (days)</span>
            <span className="w-8" />
          </div>
          <ul className="space-y-1.5">
            {entries.map((entry, index) => (
              <li key={entry.id}>
                <div className="flex items-center gap-2">
                  <Select
                    value={entry.type}
                    onValueChange={(value) => onChangeType(index, value as StartingStockType)}
                  >
                    <SelectTrigger
                      aria-label={"Animal " + (index + 1) + " type"}
                      className={CELL_SELECT + " flex-1"}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STARTING_STOCK_TYPES.map((type) => (
                        <SelectItem key={type} value={type}>
                          {STARTING_STOCK_NAMES[type]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <input
                    type="number"
                    min={0}
                    step={10}
                    value={entry.openingValue}
                    aria-label={"Animal " + (index + 1) + " worth"}
                    onChange={(event) =>
                      onPatch(index, { openingValue: Math.max(0, Number(event.target.value)) })
                    }
                    className={CELL_NUMBER + " " + WORTH_WIDTH}
                  />
                  <input
                    type="number"
                    min={0}
                    max={4000}
                    step={1}
                    value={entry.ageDays}
                    aria-label={"Animal " + (index + 1) + " age in days"}
                    onChange={(event) =>
                      onPatch(index, {
                        ageDays: Math.min(
                          4000,
                          Math.max(0, Math.round(Number(event.target.value))),
                        ),
                      })
                    }
                    className={CELL_NUMBER + " " + AGE_WIDTH}
                  />
                  <button
                    onClick={() => onRemove(index)}
                    aria-label={"Remove animal " + (index + 1)}
                    title="Remove this animal"
                    className="w-8 shrink-0 rounded-md p-1.5 text-ink-faint transition hover:bg-critical-soft hover:text-critical"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                <StartingStockHistory
                  entry={entry}
                  index={index}
                  config={config}
                  onPatch={onPatch}
                  optionalNumber={optionalNumber}
                />
              </li>
            ))}
          </ul>

          <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-lg border border-hairline bg-plane px-3 py-2 text-xs">
            <span className="font-medium text-ink">{plural(entries.length, "animal")}</span>
            <span className="text-ink-faint">{herd.join(" · ")}</span>
            <span className="ml-auto font-medium tabular-nums text-ink">
              {money(worth, currency)}
            </span>
          </div>
        </>
      ) : null}

      <div className={"rounded-lg border border-dashed border-hairline p-3" + (entries.length > 0 ? " mt-2" : "")}>
        <span className="text-xs font-medium text-ink-muted">
          {entries.length > 0 ? "Add another animal" : "Add what the farm already has"}
        </span>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {STARTING_STOCK_TYPES.map((type) => (
            <button
              key={type}
              onClick={() => onAdd(type)}
              disabled={full}
              className="inline-flex items-center gap-1 rounded-md border border-hairline bg-surface px-2.5 py-1.5 text-xs font-medium text-ink-muted transition hover:border-brand hover:text-brand disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Plus size={12} /> {STARTING_STOCK_NAMES[type]}
            </button>
          ))}
        </div>
        {full ? (
          <span className="mt-2 block text-xs text-ink-faint">
            A plan holds {number(MAX_STARTING_STOCK_ROWS, 0)} animals, and this one is full.
          </span>
        ) : null}
      </div>

      <p className="mt-3 text-xs leading-5 text-ink-faint">
        {entries.length > 0
          ? "These animals are what the farm starts with. What one is worth is what it would fetch today, not what it once cost — a sow entered at 275 is carried at 275 on day one, and only what is left of her value is written off over the litters she has ahead of her. When a starting market pig is sold, its opening value plus everything spent on it since is the cost of that sale. Age says the rest: what a pig weighs, and how far through its stage it is standing."
          : "A plan with no animals starts an empty farm. Add what is standing in the pens today — each one with what it would fetch and how old it is — and the plan opens on the farm you actually have."}
      </p>
    </SectionCard>
  );
}

// --------------------------------------------------------------- farm inputs

export function FarmInputs({
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
  type InputTab = "plan" | "flock" | "breeding" | "growth" | "costs";
  const [activeTab, setActiveTab] = useState<InputTab>("plan");
  const cardClass = (tab: InputTab) => (activeTab !== tab ? "hidden" : undefined);

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

  const startingStock = config.stock.starting;

  function writeStartingStock(next: StartingStockEntry[]) {
    update("stock", "starting", next);
  }

  function patchStartingStock(index: number, patch: StartingStockPatch) {
    writeStartingStock(
      startingStock.map((row, position) =>
        position === index ? ({ ...row, ...patch } as StartingStockEntry) : row,
      ),
    );
  }

  function removeStartingStock(index: number) {
    writeStartingStock(startingStock.filter((_, position) => position !== index));
  }

  /**
   * An animal of a given kind, at a believable age and with no history behind
   * it: the shape the form writes, whether it is adding one or changing one.
   *
   * A sow has a parity and a place in her cycle; a boar has months behind him;
   * a growing pig has neither. Those are what the kinds differ by, so changing
   * the kind is changing the shape and the history starts again.
   */
  function startingAnimal(
    id: string,
    type: StartingStockType,
    ageDays: number,
    openingValue: number,
  ): StartingStockEntry {
    const kept = { id, ageDays, openingValue };
    if (type === "sow") return { ...kept, type, parity: 0, reproductiveState: "open" };
    if (type === "boar") return { ...kept, type, monthsInService: 0 };
    return { ...kept, type };
  }

  /**
   * One more animal, of the kind that was asked for.
   *
   * The kind is picked on the way in rather than corrected afterwards, and the
   * animal arrives at a believable age for it: the farmer is correcting a
   * plausible number rather than filling an empty box.
   */
  function addStartingStock(type: StartingStockType) {
    writeStartingStock([
      ...startingStock,
      startingAnimal(
        "stock-" + Date.now() + "-" + startingStock.length,
        type,
        TYPICAL_AGE_DAYS[type],
        0,
      ),
    ]);
  }

  /** The same animal, made a different kind. Age and value are what the farmer
   * has already typed, so they come across; the history cannot, because a sow
   * has no months in service and a boar no parity. */
  function changeStartingStockType(index: number, type: StartingStockType) {
    const row = startingStock[index];
    if (row.type === type) return;
    const next = startingAnimal(row.id, type, row.ageDays, row.openingValue);
    writeStartingStock(
      startingStock.map((existing, position) => (position === index ? next : existing)),
    );
  }

  /**
   * A number typed into an animal's history, where empty means "you work it
   * out". Days pregnant and days since farrowing are both optional, and the
   * difference between an empty box and a zero matters: empty spreads her
   * across the part of the cycle she is in, zero puts her at the start of it.
   */
  function optionalNumber(text: string): number | undefined {
    if (text.trim() === "") return undefined;
    const value = Number(text);
    return Number.isFinite(value) ? Math.max(0, Math.round(value)) : undefined;
  }

  function addVaccination() {
    update("health", "vaccinations", [
      ...config.health.vaccinations,
      {
        id: "dose-" + Date.now(),
        name: "New treatment",
        ageDays: 28,
        costPerPig: 0.5,
        kind: "vaccination" as const,
        appliesTo: "all" as const,
        dosesPerPack: 1,
        openPackKeepsDays: 0,
      },
    ]);
  }

  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-14 shrink-0 flex-col border-r border-hairline bg-plane/60 p-2 sm:w-56 sm:p-3">
        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as InputTab)}
          orientation="vertical"
          className="w-full"
        >
          <TabsList variant="line" className="h-auto w-full items-stretch gap-1">
            <TabsTrigger
              value="plan"
              aria-label="Plan and housing"
              title="Plan and housing"
              className="min-h-10 px-0 group-data-vertical/tabs:justify-center sm:px-3 sm:group-data-vertical/tabs:justify-start"
            >
              <WalletCards /> <span className="hidden sm:inline">Plan &amp; housing</span>
            </TabsTrigger>
            <TabsTrigger
              value="flock"
              aria-label="Starting flock"
              title="Starting flock"
              className="min-h-10 px-0 group-data-vertical/tabs:justify-center sm:px-3 sm:group-data-vertical/tabs:justify-start"
            >
              <PiggyBank /> <span className="hidden sm:inline">Starting flock</span>
            </TabsTrigger>
            <TabsTrigger
              value="breeding"
              aria-label="Breeding"
              title="Breeding"
              className="min-h-10 px-0 group-data-vertical/tabs:justify-center sm:px-3 sm:group-data-vertical/tabs:justify-start"
            >
              <Landmark /> <span className="hidden sm:inline">Breeding</span>
            </TabsTrigger>
            <TabsTrigger
              value="growth"
              aria-label="Growth and feed"
              title="Growth and feed"
              className="min-h-10 px-0 group-data-vertical/tabs:justify-center sm:px-3 sm:group-data-vertical/tabs:justify-start"
            >
              <Wheat /> <span className="hidden sm:inline">Growth &amp; feed</span>
            </TabsTrigger>
            <TabsTrigger
              value="costs"
              aria-label="Health and costs"
              title="Health and costs"
              className="min-h-10 px-0 group-data-vertical/tabs:justify-center sm:px-3 sm:group-data-vertical/tabs:justify-start"
            >
              <Syringe /> <span className="hidden sm:inline">Health &amp; costs</span>
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="mt-auto hidden rounded-lg border border-hairline bg-surface p-3 text-xs leading-5 text-ink-muted sm:block">
          <span className="block font-medium text-ink">Expected performance</span>
          <span className="mt-1 block">
            {number(metrics.littersPerSowYear, 2)} litters/sow/year
          </span>
          <span className="block">
            {number(metrics.pigsWeanedPerSowYear, 1)} pigs weaned/sow/year
          </span>
        </div>
      </aside>

      <div className="min-w-0 flex-1 space-y-5 overflow-y-auto p-4 sm:p-5">
        <div className="rounded-lg border border-hairline bg-surface px-4 py-3 text-xs text-ink-muted sm:hidden">
          <span className="font-medium text-ink">Expected:</span>{" "}
          {number(metrics.littersPerSowYear, 2)} litters/sow/year ·{" "}
          {number(metrics.pigsWeanedPerSowYear, 1)} pigs weaned/sow/year
        </div>

      <SectionCard
        className={cardClass("plan")}
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
            max={240}
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
          <SelectField
            label="How the plan comes out"
            value={config.project.variation}
            onChange={(v) => update("project", "variation", v)}
            options={[
              { value: "chance", label: "Chance — one plausible year" },
              { value: "settled", label: "Settled — exactly the planned rates" },
            ]}
            hint={
              config.project.variation === "settled"
                ? "Nothing is drawn. A rate that does not come to a whole animal carries its remainder to the next one until it does, so a herd at 12.4 born alive farrows 12, 12, 13, 12, 13. The plan has one answer, and two plans can be read off side by side."
                : "Litter size, conception, gestation and growth are drawn from the seed, so this is one plausible farm rather than the average of many. Two plans compared on one seed can differ by luck as much as by what you changed."
            }
          />
          <SelectField
            label="Simulation engine"
            value={config.project.engine}
            onChange={(v) => update("project", "engine", v)}
            options={[
              { value: "1.x", label: "1.x — the established model" },
              { value: "2.0", label: "2.0 — stores, heats and events simulated" },
            ]}
            hint={
              config.project.engine === "2.0"
                ? "Housing occupancy is recorded but does not currently block animal movement. Stores can run dry, heats can be missed, and feed bought on terms is owed for. Every page reads the same run — the cashflow, the simulator, the timeline and the exported log."
                : "One daily procedure, every input a rate, housing and stores reported rather than simulated. This is the model the product has always run on and what a 2.0 plan is read against."
            }
          />
          <Field
            label="Scenario seed"
            value={config.project.seed}
            onChange={(v) => update("project", "seed", Math.round(v))}
            min={1}
            max={1000000}
            step={1}
            disabled={config.project.variation === "settled"}
            hint={
              config.project.variation === "settled"
                ? "Not used: a settled plan draws nothing, so it comes out the same whatever this says."
                : "Change the seed to replay the same plan with a different year's luck. Mortality is not drawn either way — the losses a stage owes are placed, so those percentages come back as you set them."
            }
          />
        </div>
      </SectionCard>

      <StartingStock
        config={config}
        entries={startingStock}
        onAdd={addStartingStock}
        onChangeType={changeStartingStockType}
        onPatch={patchStartingStock}
        onRemove={removeStartingStock}
        optionalNumber={optionalNumber}
        className={cardClass("flock")}
      />

      <SectionCard
        className={cardClass("plan")}
        title="Housing capacity"
        description="Enter usable animal places, not the number of pens. These values drive the dashboard capacity lines."
        icon={Rows3}
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <Field
            label="Sow places"
            value={config.herd.maxSows}
            onChange={(v) => update("herd", "maxSows", Math.round(v))}
            suffix="places"
            min={1}
            max={5000}
            step={1}
            hint="The breeding herd grows towards this limit and never past it."
          />
          <Field
            label="Farrowing places"
            value={config.housing.farrowingPlaces}
            onChange={(v) => update("housing", "farrowingPlaces", Math.round(v))}
            suffix="places"
            min={1}
            max={100000}
            step={1}
            hint="Usable crates or pens available at the same time."
          />
          <Field
            label="Weaner places"
            value={config.housing.weanerPlaces}
            onChange={(v) => update("housing", "weanerPlaces", Math.round(v))}
            suffix="places"
            min={1}
            max={100000}
            step={1}
          />
          <Field
            label="Grower places"
            value={config.housing.growerPlaces}
            onChange={(v) => update("housing", "growerPlaces", Math.round(v))}
            suffix="places"
            min={1}
            max={100000}
            step={1}
          />
          <Field
            label="Bedding per head"
            value={config.housing.beddingKgPerHeadDay}
            onChange={(v) => update("housing", "beddingKgPerHeadDay", v)}
            suffix="kg/head/day"
            step={0.01}
            hint="Straw or shavings under every animal housed. It used to be a flat monthly figure, which did not move with the herd at all."
          />
          <Field
            label="Bedding price"
            value={config.housing.beddingCostPerKg}
            onChange={(v) => update("housing", "beddingCostPerKg", v)}
            suffix={`${config.project.currency}/kg`}
            step={0.01}
          />
          <Field
            label="Bedding load"
            value={config.housing.beddingLoadKg}
            onChange={(v) => update("housing", "beddingLoadKg", v)}
            suffix="kg a load brings"
            min={10}
            step={100}
          />
          <Field
            label="Bedding delivery"
            value={config.housing.beddingDeliveryCost}
            onChange={(v) => update("housing", "beddingDeliveryCost", v)}
            suffix={`${config.project.currency}/trip`}
            step={5}
          />
          <Field
            label="Finisher places"
            value={config.housing.finisherPlaces}
            onChange={(v) => update("housing", "finisherPlaces", Math.round(v))}
            suffix="places"
            min={1}
            max={100000}
            step={1}
          />
        </div>
      </SectionCard>

      <SectionCard
        className={cardClass("breeding")}
        title="Gilt and breeding policy"
        description="How the herd starts, when breeding animals leave, and how replacements are found."
        icon={Landmark}
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
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
            label="Gilt puberty age"
            value={config.herd.giltPubertyAgeDays}
            onChange={(v) => update("herd", "giltPubertyAgeDays", Math.round(v))}
            suffix="days"
            min={140}
            max={280}
            step={5}
            hint="When she first stands. She is not bred on that heat — it starts the clock the plan counts cycles from."
          />
          <Field
            label="Gilt puberty weight"
            value={config.herd.giltPubertyWeightKg}
            onChange={(v) => update("herd", "giltPubertyWeightKg", v)}
            suffix="kg"
            min={60}
            max={140}
            hint="A gilt that has not grown does not cycle, whatever her age. Both have to be met before her first heat is recorded."
          />
          <Field
            label="Serve on heat number"
            value={config.herd.giltServeAtHeat}
            onChange={(v) => update("herd", "giltServeAtHeat", Math.round(v))}
            suffix="standing heat"
            min={1}
            max={5}
            step={1}
            hint={
              "Breeding on the second or third heat puts more pigs in her first litter and keeps her in the herd longer. On this plan that is service at about " +
              expectedGiltServiceAgeDays(config) +
              " days."
            }
          />
          <Field
            label="Gilt service weight"
            value={config.herd.giltServiceWeightKg}
            onChange={(v) => update("herd", "giltServiceWeightKg", v)}
            suffix="kg"
            min={90}
            max={180}
            hint="A floor, not a target: 135–150 kg is the usual aim. Short of it on her heat, she waits for the next one."
          />
          <Field
            label="Gilt service age"
            value={config.herd.giltServiceAgeDays}
            onChange={(v) => update("herd", "giltServiceAgeDays", v)}
            suffix="days"
            min={180}
            max={400}
            step={5}
            hint="The other floor. Raise it above the heat she would otherwise be served on and she is held to the first heat past it."
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
            hint="Boars are rotated off at this point. No female is served by her own sire or her maternal grandsire, so the farm stands a second boar once home-bred gilts come to service — or buys semen instead, if AI is on."
          />
          <Field
            label="Boar value at rotation"
            value={config.herd.boarResidualValue}
            onChange={(v) => update("herd", "boarResidualValue", v)}
            suffix={config.project.currency}
            step={10}
            hint="What he is expected to be worth by the end of his working life. Only the experimental inventory-adjusted books read it: they write him down from what he cost to this over the months he stands. What he actually sells for is still the cull value."
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
        className={cardClass("breeding")}
        title="Service & artificial insemination"
        description="How sows are served. AI stands no boar and is related to nothing on the farm, so it covers the matings a closed herd would otherwise need another boar for."
        icon={TestTubes}
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Toggle
            label="Use artificial insemination"
            checked={config.service.useAi}
            onChange={(value) => update("service", "useAi", value)}
            hint="Semen can be bought whenever the boar team is fully worked for the week, or when every boar standing is one of the female's own sires."
          />
          <Field
            label="Share of services by AI"
            value={config.service.aiSharePct}
            onChange={(v) => update("service", "aiSharePct", v)}
            suffix="% of services"
            max={100}
            step={5}
            disabled={!config.service.useAi}
            hint="A floor, not a ceiling: services the boars cannot cover go to AI on top of this."
          />
          <Field
            label="AI cost per service"
            value={config.service.aiCostPerService}
            onChange={(v) => update("service", "aiCostPerService", v)}
            suffix={`${config.project.currency}/service`}
            step={5}
            disabled={!config.service.useAi}
            hint="Semen and technician, charged every time a sow is served. A service that does not hold is charged again three weeks later."
          />
          <Field
            label="AI conception difference"
            value={config.service.aiConceptionDeltaPct}
            onChange={(v) => update("service", "aiConceptionDeltaPct", v)}
            suffix="percentage points"
            min={-30}
            max={30}
            step={1}
            disabled={!config.service.useAi}
            hint="Added to the conception rate when the service is AI. Negative where heat detection is weak, since a dose put in on the wrong day is a dose wasted."
          />
          <Field
            label="Stud lines on the panel"
            value={config.service.aiStudPanelSize}
            onChange={(v) => update("service", "aiStudPanelSize", Math.round(v))}
            suffix="studs"
            min={1}
            max={20}
            step={1}
            disabled={!config.service.useAi}
            hint="Semen is rotated across the panel and barred from a female for the same generations a boar is, so a narrow panel can hold services up the way a single boar does."
          />
        </div>
      </SectionCard>

      <SectionCard
        className={cardClass("breeding")}
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
            label="Late returns"
            value={config.reproduction.irregularReturnSharePct}
            onChange={(v) => update("reproduction", "irregularReturnSharePct", v)}
            suffix="% of returns"
            max={100}
            step={5}
            hint="Of the services that do not hold, the share that come back past the next cycle rather than on it — an embryo lost rather than a service that never took."
          />
          <Field
            label="Pregnancy scan"
            value={config.reproduction.pregnancyScanDays}
            onChange={(v) => update("reproduction", "pregnancyScanDays", Math.round(v))}
            suffix="days after service"
            min={21}
            max={45}
            step={1}
            hint="Commonly 26–30 days. Earlier reads too many false empties; later wastes the days an empty sow could spend getting back in pig."
          />
          <Field
            label="Scan cost"
            value={config.reproduction.pregnancyScanCost}
            onChange={(v) => update("reproduction", "pregnancyScanCost", v)}
            suffix={`${config.project.currency}/sow`}
            step={0.5}
            hint="Charged on every scan, whatever it finds. Set it to 0 for a herd that does not scan."
          />
          <Field
            label="Post-scan pregnancy loss"
            value={config.reproduction.pregnancyLossPct}
            onChange={(v) => update("reproduction", "pregnancyLossPct", v)}
            suffix="% of confirmed pregnancies"
            max={100}
            step={0.5}
            hint="Abortions and other late failures after a positive scan. Affected sows recover, return to service and produce no litter."
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
            label="Stillborn"
            value={config.reproduction.stillbornPct}
            onChange={(v) => update("reproduction", "stillbornPct", v)}
            suffix="% of total born"
            max={100}
            step={0.5}
          />
          <Field
            label="Mummified"
            value={config.reproduction.mummifiedPct}
            onChange={(v) => update("reproduction", "mummifiedPct", v)}
            suffix="% of total born"
            max={100}
            step={0.5}
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
        className={cardClass("growth")}
        title="Weights, growth and feed conversion"
        description={
          "Feed conversion is worked out here rather than typed in. A pig eats for upkeep before it eats to grow, and both get dearer as it fills out, so the ratio moves with weight on its own: " +
          number(metrics.feedConversion.weanerFcr, 2) +
          " feed to gain in the weaner house, " +
          number(metrics.feedConversion.growerFcr, 2) +
          " in the grower house and " +
          number(metrics.feedConversion.finisherFcr, 2) +
          " in the finishing house — " +
          number(metrics.feedConversion.growoutFcr, 2) +
          " across the whole growout."
        }
        icon={Gauge}
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Field
            label="Weaning weight"
            value={config.growth.referenceWeaningWeightKg}
            onChange={(v) => update("growth", "referenceWeaningWeightKg", v)}
            suffix="kg expected"
            hint="What a well-fed piglet is expected to leave the sow at. It sets what the litter tries to grow, and its dam is offered the feed to milk it — so a heavier weaner here is a bigger sow ration and a bigger feed bill, not free liveweight. What the piglets actually weigh is whatever the feed paid for."
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
            hint="Litter mates go as one cohort, on the day the batch averages this — so some go a little under it and some over."
          />
          <Field
            label="Mature weight"
            value={config.growth.matureWeightKg}
            onChange={(v) => update("growth", "matureWeightKg", v)}
            suffix="kg liveweight"
            hint="The size this genotype finishes at. It does nothing to a pig sold on time — it decides what happens to one that is not, which stops growing as it reaches this rather than gaining at its finisher rate for ever. 0 removes the ceiling. 2.0 engine only."
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
            label="Upkeep feed at 100 kg"
            value={config.growth.upkeepFeedKgAt100Kg}
            onChange={(v) => update("growth", "upkeepFeedKgAt100Kg", v)}
            suffix="kg/day"
            step={0.05}
            hint="What a 100 kg pig eats before it grows at all. Lighter pigs need less of it, by metabolic weight rather than in proportion."
          />
          <Field
            label="Feed per kg gain at 20 kg"
            value={config.growth.gainFeedKgAt20Kg}
            onChange={(v) => update("growth", "gainFeedKgAt20Kg", v)}
            suffix="kg feed"
            step={0.05}
            hint="Gain in a weaner is lean and largely water, so it comes cheap."
          />
          <Field
            label="Feed per kg gain at 100 kg"
            value={config.growth.gainFeedKgAt100Kg}
            onChange={(v) => update("growth", "gainFeedKgAt100Kg", v)}
            suffix="kg feed"
            step={0.05}
            hint="By finishing, more of each kilogram is fat, which costs several times as much to lay down. Between the two weights the price is read off the straight line."
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
        className={cardClass("growth")}
        title="Feed consumption and prices"
        description="Sows eat by daily intake, scaled to their weight. Growing pigs eat their upkeep plus what the day's gain costs at the weight they are, with appetite scaled by sex. Stage decides which bin the feed comes out of and what it costs."
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
        className={cardClass("growth")}
        title="Getting it here"
        description="A journey costs what it costs whatever is on the deck, so the lorry only goes out when something on the farm is actually running low — and when it does, it leaves full. Every store queues for the space by how soon it runs out, so the gas bottle that sent for the vehicle travels with the feed the bins had room for, and that is a trip not made next week. Nothing is delivered that is not used, and a journey's cost reaches each pig through what that pig eats. Bedding travels alone, but by the deckload rather than the bale."
        icon={Truck}
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Field
            label="Safety stock"
            value={config.feed.safetyCoverDays}
            onChange={(v) => update("feed", "safetyCoverDays", Math.round(v))}
            suffix="days of forecast demand"
            min={0}
            max={30}
            step={1}
          />
          <Field
            label="Supplier lead time"
            value={config.feed.deliveryLeadDays}
            onChange={(v) => update("feed", "deliveryLeadDays", Math.round(v))}
            suffix="days"
            min={0}
            max={60}
            step={1}
          />
          <Field
            label="Truck capacity"
            value={config.feed.truckCapacityKg}
            onChange={(v) => update("feed", "truckCapacityKg", v)}
            suffix="kg on the deck"
            min={100}
            max={30000}
            step={100}
            hint="Everything the lorry can carry on one journey, feed and gas together. No weight is held back: the bottles queue for space against the feed on how soon the farm runs out of them."
          />
          <Field
            label="Loads a day"
            value={config.feed.maxSupplyTripsPerDay}
            onChange={(v) => update("feed", "maxSupplyTripsPerDay", Math.round(v))}
            suffix="at most"
            min={1}
            max={100}
            step={1}
            hint={`What the mill will send and the yard can take in on one day. Most farms never reach it: a second lorry goes only when the first one left full and a store still cannot be held until the next delivery. A herd eating more than ${number(config.feed.truckCapacityKg, 0)} kg a day cannot be fed on one, so this is what decides whether it goes hungry.`}
          />
          <Field
            label="Feed bag"
            value={config.feed.feedBagKg}
            onChange={(v) => update("feed", "feedBagKg", v)}
            suffix="kg a bag"
            min={0}
            max={1000}
            step={5}
            hint={`Feed is bought by the bag, so an order is a whole number of them and a full deck is ${Math.floor(config.feed.truckCapacityKg / Math.max(config.feed.feedBagKg, 1))} bags. Set it to 0 for bulk feed blown into the bin loose.`}
          />
          <Field
            label="Bin capacity"
            value={config.feed.binCapacityKg}
            onChange={(v) => update("feed", "binCapacityKg", v)}
            suffix="kg a ration"
            min={50}
            max={500000}
            step={100}
            hint="What one ration's bin holds. It is what stops a lorry with space to spare tipping in more than the farm can put away, so it is also what decides how much of the deck the top-up can fill."
          />
          <Field
            label="Cost per delivery"
            value={config.feed.deliveryCostPerTrip}
            onChange={(v) => update("feed", "deliveryCostPerTrip", v)}
            suffix={`${config.project.currency}/load`}
            step={5}
            hint="What one round trip to the mill costs, whatever is on the truck."
          />
          <Field
            label="Feed buffer held"
            value={config.feed.feedBufferDays}
            onChange={(v) => update("feed", "feedBufferDays", v)}
            suffix="days"
            min={1}
            max={120}
            step={1}
            hint="Days of cover at which a store is due. One store falling this low is what sends the lorry; everything else close behind it is loaded onto the same one."
          />
          <Field
            label="Order up to"
            value={config.feed.targetCoverDays}
            onChange={(v) => update("feed", "targetCoverDays", Math.round(v))}
            suffix="days"
            min={2}
            max={240}
            step={1}
            hint="Days of cover an order is sized to bring a store back up to. Whatever deck is left over after that is filled from the same queue, so the figure sets the order and the truck sets the load."
          />
        </div>
      </SectionCard>

      <SectionCard
        className={cardClass("costs")}
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
            label="Clinical cases"
            value={config.health.treatmentAnnualPct}
            onChange={(v) => update("health", "treatmentAnnualPct", v)}
            suffix="% of growing pigs/year"
            max={100}
            step={1}
            hint="Non-fatal respiratory, digestive and injury cases requiring treatment."
          />
          <Field
            label="Treatment cost"
            value={config.health.treatmentCostPerPig}
            onChange={(v) => update("health", "treatmentCostPerPig", v)}
            suffix={`${config.project.currency}/case`}
            step={0.5}
          />
          <Field
            label="Reduced growth"
            value={config.health.treatmentGrowthPenaltyDays}
            onChange={(v) => update("health", "treatmentGrowthPenaltyDays", Math.round(v))}
            suffix="days/case"
            min={0}
            max={60}
            step={1}
          />
          <Field
            label="Growth loss while ill"
            value={config.health.treatmentGrowthPenaltyPct}
            onChange={(v) => update("health", "treatmentGrowthPenaltyPct", v)}
            suffix="% of daily gain"
            max={100}
            step={5}
          />
          <Field
            label="Gas per heater"
            value={config.health.gasKgPerHeaterDay}
            onChange={(v) => update("health", "gasKgPerHeaterDay", v)}
            suffix="kg/night"
            min={0}
            max={50}
            step={0.5}
            hint="What one lamp burns on a night it is lit — the twelve dark hours it is wanted, counted as a day's use. A lamp is alight or it is not, so this is burnt whether the pen under it is full or holds one piglet."
          />
          <Field
            label="Piglets a heater covers"
            value={config.health.pigletsPerHeater}
            onChange={(v) => update("health", "pigletsPerHeater", Math.round(v))}
            suffix="head"
            min={1}
            max={100}
            step={1}
            hint="A suckling litter cannot share a lamp with the crate next door, so every litter lights at least one of its own. Weaned pigs still young enough to want heat are penned together and share what their number needs."
          />
          <Field
            label="Gas price"
            value={config.health.gasCostPerKg}
            onChange={(v) => update("health", "gasCostPerKg", v)}
            suffix={`${config.project.currency}/kg`}
            step={0.05}
          />
          <Field
            label="Gas canister"
            value={config.health.gasCanisterKg}
            onChange={(v) => update("health", "gasCanisterKg", v)}
            suffix="kg a bottle holds"
            min={1}
            max={500}
            step={1}
          />
          <Field
            label="Canisters on the farm"
            value={config.health.gasCanisters}
            onChange={(v) => update("health", "gasCanisters", Math.round(v))}
            suffix="bottles"
            min={1}
            max={20}
            step={1}
            hint={`The farm never holds more than ${config.health.gasCanisterKg * config.health.gasCanisters} kg, so a bottle waits for an empty rather than arriving early — and a yard with room for more bottles is a yard that sends for fewer lorries. Gas is ordered on the same rule as the feed: when it is the first thing due it sends the lorry, and the feed fills the rest of the deck.`}
          />
          <Field
            label="Heated until"
            value={config.health.heatedUntilAgeDays}
            onChange={(v) => update("health", "heatedUntilAgeDays", v)}
            suffix="days of age"
            min={0}
            max={120}
            step={1}
            hint={`A lamp costs ${money(config.health.gasKgPerHeaterDay * config.health.gasCostPerKg, config.project.currency)} a night, which is ${money((config.health.gasKgPerHeaterDay * config.health.gasCostPerKg * config.health.heatedUntilAgeDays) / Math.max(config.health.pigletsPerHeater, 1), config.project.currency)} a piglet over the whole heated period when the pen is full — and more when it is not.`}
          />
          <SelectField
            label="Mortality timing"
            value={config.health.mortalityTiming}
            onChange={(v) => update("health", "mortalityTiming", v)}
            options={[
              { value: "profiled", label: "Follow the risk curve" },
              { value: "even", label: "Spread evenly" },
            ]}
            hint="How the mortality percentages are spread inside each stage. The percentages themselves are set with the herd and growth inputs; this only moves when those losses land."
          />
        </div>

        <div className="mt-4">
          <div className="w-full rounded-lg bg-plane px-3 py-2.5 text-xs text-ink-muted">
            <span className="font-medium text-ink">
              {money(metrics.vaccinationCostPerPig, config.project.currency)}
            </span>{" "}
            of treatment per pig across the schedule below.
          </div>
        </div>

        <div className="mt-5 overflow-hidden rounded-lg border border-hairline">
          <table className="w-full text-sm">
            <thead className="border-b border-hairline bg-plane text-left text-xs text-ink-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Treatment</th>
                <th className="w-32 px-3 py-2 font-medium">Done to</th>
                <th className="w-32 px-3 py-2 text-right font-medium">Age (days)</th>
                <th className="w-36 px-3 py-2 text-right font-medium">
                  Cost ({config.project.currency}/pig)
                </th>
                <th className="w-28 px-3 py-2 text-right font-medium">Doses/pack</th>
                <th className="w-28 px-3 py-2 text-right font-medium">Keeps (days)</th>
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
                      className="w-full rounded-md border border-transparent bg-transparent px-2 py-1.5 text-sm outline-none transition hover:border-hairline focus:border-brand"
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <select
                      value={dose.appliesTo}
                      aria-label={"Treatment " + (index + 1) + " applies to"}
                      onChange={(event) =>
                        updateVaccination(index, {
                          appliesTo: event.target.value as Vaccination["appliesTo"],
                        })
                      }
                      className="w-full rounded-md border border-transparent bg-transparent px-2 py-1.5 text-sm outline-none transition hover:border-hairline focus:border-brand"
                    >
                      <option value="all">Every piglet</option>
                      <option value="males">Males only</option>
                      <option value="females">Females only</option>
                    </select>
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
                      className="w-full rounded-md border border-transparent bg-transparent px-2 py-1.5 text-right text-sm tabular-nums outline-none transition hover:border-hairline focus:border-brand"
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
                      className="w-full rounded-md border border-transparent bg-transparent px-2 py-1.5 text-right text-sm tabular-nums outline-none transition hover:border-hairline focus:border-brand"
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      type="number"
                      min={1}
                      max={500}
                      step={1}
                      value={dose.dosesPerPack}
                      aria-label={"Treatment " + (index + 1) + " doses per pack"}
                      onChange={(event) =>
                        updateVaccination(index, { dosesPerPack: Number(event.target.value) })
                      }
                      className="w-full rounded-md border border-transparent bg-transparent px-2 py-1.5 text-right text-sm tabular-nums outline-none transition hover:border-hairline focus:border-brand"
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      type="number"
                      min={0}
                      max={365}
                      step={1}
                      value={dose.openPackKeepsDays}
                      aria-label={"Treatment " + (index + 1) + " days an open pack keeps"}
                      onChange={(event) =>
                        updateVaccination(index, {
                          openPackKeepsDays: Number(event.target.value),
                        })
                      }
                      className="w-full rounded-md border border-transparent bg-transparent px-2 py-1.5 text-right text-sm tabular-nums outline-none transition hover:border-hairline focus:border-brand"
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
        className={cardClass("costs")}
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
            label="Lorry capacity"
            value={config.finance.marketTruckCapacityPigs}
            onChange={(v) => update("finance", "marketTruckCapacityPigs", v)}
            suffix="pigs per run"
            min={1}
            max={500}
            step={1}
            hint="Sold pigs go to the abattoir alive, on the day they are sold. A cohort too big for one load takes another run."
          />
          <Field
            label="Cost per run"
            value={config.finance.marketTripCost}
            onChange={(v) => update("finance", "marketTripCost", v)}
            suffix={config.project.currency}
            hint="Charged to the pigs on the lorry, so a half-empty run still costs a full trip. What happens past the abattoir is another business."
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
          <Field
            label="Working capital to keep"
            value={config.finance.workingCapitalTarget}
            onChange={(v) => update("finance", "workingCapitalTarget", v)}
            suffix={config.project.currency}
            step={500}
            hint="The cash the business should never drop below. Financial planning tops the balance up to it and leaves it behind when surplus is taken out."
          />
        </div>
      </SectionCard>
      </div>
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

export function CashflowPreview({
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
    // Generated from the ledger rather than listed by hand: a line added to the
    // ledger is a line on the cash statement, and the two cannot drift apart.
    //
    // Every figure below comes off the cash book. This statement answers "when
    // does the money move", which on a plan that buys feed on terms is not the
    // same month as "when was the feed eaten" — that is the profit and loss, and
    // it is reported separately.
    ...INCOME_CATEGORIES.map((category) => ({
      key: category,
      label: CATEGORY_LABELS[category],
      monthValue: (month: MonthlyProjection) => month.cashTotals[category],
      planValue: total((month) => month.cashTotals[category]),
    })),
    {
      key: "total-receipts",
      label: "Total receipts",
      kind: "total" as const,
      monthValue: (month: MonthlyProjection) => month.cashIn,
      planValue: total((month) => month.cashIn),
    },
    { key: "payments-section", label: "Cash payments", kind: "section" },
    ...EXPENSE_CATEGORIES.map((category) => ({
      key: category,
      label: CATEGORY_LABELS[category],
      monthValue: (month: MonthlyProjection) => month.cashTotals[category],
      planValue: total((month) => month.cashTotals[category]),
    })),
    {
      key: "total-payments",
      label: "Total payments",
      kind: "total",
      monthValue: (month) => month.cashOut,
      planValue: total((month) => month.cashOut),
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
                <th className="min-w-32 border-b border-hairline bg-brand-soft px-3 py-3 text-right font-semibold text-brand">
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
                        "whitespace-nowrap border-b border-hairline bg-brand-soft/50 px-3 py-2.5 text-right font-semibold tabular-nums " +
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
  /** The month this view is of, or null for a rolled-up plan year. */
  monthIndex: number | null;
  /** Earned and consumed over the period. */
  totals: CategoryTotals;
  /** Received and paid over it, which on a plan buying on terms is not the same. */
  cashTotals: CategoryTotals;
  revenue: number;
  totalCost: number;
  cashIn: number;
  cashOut: number;
  netCashFlow: number;
  closingCash: number;
  /** Owed to suppliers at the close, which is what the two statements differ by. */
  payables: number;
  /** The same period through the experimental second set of books. */
  accounting: PeriodAccounting;
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
    monthIndex: month.index,
    totals: month.totals,
    cashTotals: month.cashTotals,
    revenue: month.revenue,
    totalCost: month.totalCost,
    cashIn: month.cashIn,
    cashOut: month.cashOut,
    netCashFlow: month.netCashFlow,
    closingCash: month.closingCash,
    payables: month.payables,
    accounting: month.accounting,
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
    monthIndex: null,
    totals: year.totals,
    cashTotals: year.cashTotals,
    revenue: year.revenue,
    totalCost: year.totalCost,
    cashIn: year.cashIn,
    cashOut: year.cashOut,
    netCashFlow: year.netCashFlow,
    closingCash: year.closingCash,
    payables: year.payables,
    accounting: year.accounting,
    bornAlive: year.bornAlive,
    weaned: year.weaned,
    pigsSold: year.pigsSold,
    saleLiveweightKg: covered.reduce((sum, month) => sum + month.saleLiveweightKg, 0),
    saleDeadweightKg: covered.reduce((sum, month) => sum + month.saleDeadweightKg, 0),
    giltsSold: year.giltsSold,
    deaths: covered.reduce((sum, month) => sum + month.deaths, 0),
  };
}

// ------------------------------------------- the experimental second reading

/** One period, under both profit statements, with what separates them. */
type ProfitRow = {
  key: string;
  label: string;
  current: number;
  adjusted: number;
  reconciliation: PnLReconciliation;
  statement: InventoryAdjustedPnL;
};

function profitRows(periods: readonly PeriodView[]): ProfitRow[] {
  return periods.map((period) => {
    const reconciliation = reconcileProfit(period.totals, period.accounting);
    return {
      key: period.key,
      label: period.label,
      current: reconciliation.currentProfit,
      adjusted: reconciliation.inventoryAdjustedProfit,
      reconciliation,
      statement: inventoryAdjustedPnL(period.totals, period.accounting),
    };
  });
}

/**
 * Profit read two ways, and the balance sheet that explains the gap.
 *
 * Income less expenditure is the figure this plan has always shown and the one
 * every other page still reads. It cannot tell a farm that is losing money from
 * a farm that is building a herd: both spend more than they take, and on that
 * statement both read as a loss. So the same run is shown again with the costs
 * that turned into animals held back until those animals leave, and the two are
 * put side by side rather than one being quietly swapped for the other.
 *
 * It is labelled experimental because it is: the model behind it is new, and
 * nothing in the product depends on it.
 */
function ProfitAndWorth({
  config,
  projection,
  periods,
  granularity,
}: {
  config: PlannerConfig;
  projection: ReturnType<typeof calculateProjection>;
  periods: readonly PeriodView[];
  granularity: Granularity;
}) {
  const currency = config.project.currency;
  const rows = useMemo(() => profitRows(periods), [periods]);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const open = rows.find((row) => row.key === openKey) ?? rows.at(-1) ?? null;

  const worth = projection.farmWorth;
  const horizon = useMemo(
    () => reconcileProfit(
      projection.years.reduce((totals, year) => {
        for (const category of LEDGER_CATEGORIES) totals[category.id] += year.totals[category.id];
        return totals;
      }, emptyTotals()),
      projection.accounting,
    ),
    [projection],
  );

  const netWorthSeries = useMemo(
    () =>
      projection.months.map((month) => ({
        label: month.month,
        livestock:
          month.accounting.closing.marketWip + month.accounting.closing.replacementWip,
        breeding: month.accounting.closing.sowAssets + month.accounting.closing.boarAssets,
        cash: month.closingCash,
      })),
    [projection],
  );

  const assetLines = [
    ["Cash", worth.cash],
    ["Feed in the bins", worth.inventory.feed],
    ["Other stores and freight held", worth.inventory.supplies],
    ["Market pigs, at cost", worth.inventory.marketLivestock],
    ["Replacement gilts, at cost", worth.inventory.replacementGilts],
    ["Breeding sows", worth.breedingAssets.sows],
    ["Boars", worth.breedingAssets.boars],
  ] as const;

  return (
    <div className="mt-5 space-y-5">
      <SectionCard
        icon={Scale}
        title="Profit, read both ways"
        description="Experimental. Income less expenditure beside the same run with the costs that turned into unsold animals held back until those animals leave."
      >
        <div className="overflow-hidden rounded-lg border border-hairline">
          <div className="max-h-[420px] overflow-auto">
            <table className="w-full min-w-[520px] border-collapse text-xs">
              <thead className="sticky top-0 border-b border-hairline bg-plane text-left text-ink-muted">
                <tr>
                  {[
                    granularity === "month" ? "Month" : "Plan year",
                    "Current P&L",
                    "Inventory-adjusted",
                    "Difference",
                  ].map((heading, index) => (
                    <th
                      key={heading}
                      className={
                        "whitespace-nowrap px-3.5 py-3 font-medium " +
                        (index > 0 ? "text-right" : "")
                      }
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.key}
                    onClick={() => setOpenKey(row.key)}
                    aria-selected={row.key === open?.key}
                    className={
                      "cursor-pointer border-b border-hairline last:border-0 " +
                      (row.key === open?.key ? "bg-brand-soft" : "hover:bg-plane")
                    }
                  >
                    <td className="whitespace-nowrap px-3.5 py-2.5 font-medium">{row.label}</td>
                    <td
                      className={
                        "whitespace-nowrap px-3.5 py-2.5 text-right tabular-nums " +
                        (row.current < 0 ? "text-critical" : "text-ink-muted")
                      }
                    >
                      {cashflowMoney(row.current, currency)}
                    </td>
                    <td
                      className={
                        "whitespace-nowrap px-3.5 py-2.5 text-right font-medium tabular-nums " +
                        (row.adjusted < 0 ? "text-critical" : "")
                      }
                    >
                      {cashflowMoney(row.adjusted, currency)}
                    </td>
                    <td className="whitespace-nowrap px-3.5 py-2.5 text-right tabular-nums text-ink-faint">
                      {cashflowMoney(row.adjusted - row.current, currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-hairline bg-plane font-medium">
                <tr>
                  <td className="whitespace-nowrap px-3.5 py-2.5">Whole plan</td>
                  <td className="whitespace-nowrap px-3.5 py-2.5 text-right tabular-nums">
                    {cashflowMoney(horizon.currentProfit, currency)}
                  </td>
                  <td className="whitespace-nowrap px-3.5 py-2.5 text-right tabular-nums">
                    {cashflowMoney(horizon.inventoryAdjustedProfit, currency)}
                  </td>
                  <td className="whitespace-nowrap px-3.5 py-2.5 text-right tabular-nums text-ink-faint">
                    {cashflowMoney(horizon.changeInFarmInventory, currency)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {open ? (
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Panel
              title={"Why they differ — " + open.label}
              description="Every line is a cost that moved into or out of something the farm still owns. They add up exactly: no profit is made by moving money between accounts."
            >
              <table className="w-full text-xs">
                <tbody>
                  {(
                    [
                      ["Current profit or loss", open.reconciliation.currentProfit],
                      ["Costs carried into livestock", open.reconciliation.capitalisedIntoLivestock],
                      ["Breeding stock bought in", open.reconciliation.breedingStockBought],
                      ["Freight held in the stores", open.reconciliation.freightHeldInStores],
                      ["Cost of livestock sold", -open.reconciliation.costOfLivestockSold],
                      ["Mortality write-offs", -open.reconciliation.mortalityWriteOffs],
                      ["Breeding stock depreciation", -open.reconciliation.breedingStockDepreciation],
                      [
                        "Carrying value of breeding stock sold",
                        -open.reconciliation.carryingValueOfBreedingStockSold,
                      ],
                    ] as const
                  ).map(([label, value]) => (
                    <tr key={label} className="border-b border-hairline last:border-0">
                      <td className="py-1.5 pr-3 text-ink-muted">{label}</td>
                      <td className="py-1.5 text-right tabular-nums">
                        {cashflowMoney(value, currency)}
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t border-rule font-medium">
                    <td className="pt-2 pr-3">Inventory-adjusted profit or loss</td>
                    <td className="pt-2 text-right tabular-nums">
                      {cashflowMoney(open.reconciliation.inventoryAdjustedProfit, currency)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </Panel>

            <Panel
              title={"Trading statement — " + open.label}
              description="The same period built from accounting movements rather than as one adjustment to the cash result."
            >
              <table className="w-full text-xs">
                <tbody>
                  {(
                    [
                      ["Sales revenue", open.statement.revenue.total, false],
                      ["Cost of livestock sold", -open.statement.costOfSales.total, false],
                      ["Gross profit", open.statement.grossProfit, true],
                      ["Breeding herd keep", -open.statement.operatingExpenses.breedingHerd, false],
                      ["Labour", -open.statement.operatingExpenses.labour, false],
                      ["Overheads", -open.statement.operatingExpenses.overheads, false],
                      [
                        "Breeding stock depreciation",
                        -open.statement.operatingExpenses.depreciation,
                        false,
                      ],
                      [
                        "Mortality and write-offs",
                        -open.statement.operatingExpenses.mortalityLosses,
                        false,
                      ],
                      ["Other running costs", -open.statement.operatingExpenses.other, false],
                      ["Inventory-adjusted operating profit", open.statement.operatingProfit, true],
                    ] as const
                  ).map(([label, value, strong]) => (
                    <tr
                      key={label}
                      className={
                        strong
                          ? "border-t border-rule font-medium"
                          : "border-b border-hairline"
                      }
                    >
                      <td className={(strong ? "pt-2 " : "py-1.5 ") + "pr-3 text-ink-muted"}>
                        {label}
                      </td>
                      <td
                        className={(strong ? "pt-2 " : "py-1.5 ") + "text-right tabular-nums"}
                      >
                        {cashflowMoney(value, currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          </div>
        ) : null}
      </SectionCard>

      <SectionCard
        icon={Landmark}
        title="Farm worth"
        description="Experimental. What the place is worth at the end of the plan, valued at what everything on it cost rather than at what it might fetch."
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <table className="w-full text-xs">
            <tbody>
              {assetLines.map(([label, value]) => (
                <tr key={label} className="border-b border-hairline">
                  <td className="py-1.5 pr-3 text-ink-muted">{label}</td>
                  <td
                    className={
                      "py-1.5 text-right tabular-nums " + (value < 0 ? "text-critical" : "")
                    }
                  >
                    {cashflowMoney(value, currency)}
                  </td>
                </tr>
              ))}
              <tr className="border-b border-rule font-medium">
                <td className="py-1.5 pr-3">Gross assets</td>
                <td className="py-1.5 text-right tabular-nums">
                  {cashflowMoney(worth.totalAssets, currency)}
                </td>
              </tr>
              <tr className="border-b border-hairline">
                <td className="py-1.5 pr-3 text-ink-muted">Owed to suppliers</td>
                <td className="py-1.5 text-right tabular-nums">
                  {cashflowMoney(-worth.liabilities.payables, currency)}
                </td>
              </tr>
              {worth.liabilities.overdraft > 0 ? (
                <tr className="border-b border-hairline">
                  <td className="py-1.5 pr-3 text-ink-muted">Bank overdraft</td>
                  <td className="py-1.5 text-right tabular-nums text-critical">
                    {cashflowMoney(-worth.liabilities.overdraft, currency)}
                  </td>
                </tr>
              ) : null}
              <tr className="font-medium">
                <td className="pt-2 pr-3">Farm net worth</td>
                <td
                  className={
                    "pt-2 text-right tabular-nums " +
                    (worth.netWorth < 0 ? "text-critical" : "text-good")
                  }
                >
                  {cashflowMoney(worth.netWorth, currency)}
                </td>
              </tr>
            </tbody>
          </table>

          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={netWorthSeries}
                margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
              >
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
                  width={52}
                />
                <ReferenceLine y={0} stroke={CHART.baseline} />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  formatter={(value) => money(Number(value ?? 0), currency)}
                />
                <Legend
                  iconType="circle"
                  iconSize={8}
                  height={30}
                  wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
                />
                <Area
                  type="monotone"
                  dataKey="cash"
                  name="Cash"
                  stackId="worth"
                  stroke="var(--color-surface)"
                  strokeWidth={2}
                  fill={CHART.cash}
                  isAnimationActive={false}
                />
                <Area
                  type="monotone"
                  dataKey="livestock"
                  name="Livestock at cost"
                  stackId="worth"
                  stroke="var(--color-surface)"
                  strokeWidth={2}
                  fill={CHART.stage.finishers}
                  isAnimationActive={false}
                />
                <Area
                  type="monotone"
                  dataKey="breeding"
                  name="Breeding stock"
                  stackId="worth"
                  stroke="var(--color-surface)"
                  strokeWidth={2}
                  fill={CHART.stage.sows}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
        <p className="mt-3 text-xs leading-5 text-ink-faint">
          Book value, not market value. An unsold pig is carried at what has been spent rearing
          it, never at what the abattoir would pay — writing the sale price onto it would book
          the profit before the lorry came.
        </p>
      </SectionCard>
    </div>
  );
}

/**
 * The two funding decisions a plan needs once the farming is settled: how much
 * money has to go in to keep the business solvent, and how much can come back
 * out once it is. Both are worked out month by month against the working capital
 * the plan says to keep, and both write rows you can then read and edit like any
 * other — they are simply written for you rather than typed.
 */
function FundingControls({
  config,
  projection,
  update,
}: {
  /** The inputs as they stand: these controls read them and write them. */
  config: PlannerConfig;
  projection: ReturnType<typeof calculateProjection>;
  update: <S extends PlannerSection, K extends keyof PlannerConfig[S]>(
    section: S,
    key: K,
    value: PlannerConfig[S][K],
  ) => void;
}) {
  const currency = config.project.currency;
  const movements = config.finance.cashMovements;
  const target = config.finance.workingCapitalTarget;
  const [planning, setPlanning] = useState<CashMovement["kind"] | null>(null);

  const injected = generatedTotal(movements, "in");
  const withdrawn = generatedTotal(movements, "out");

  /**
   * Each side is planned against the farm as it stands without that side's own
   * rows, so pressing a button twice gives the same answer as pressing it once,
   * and the two compose: money put in is there to be left alone when the surplus
   * is taken out.
   *
   * Which means a farm run, of a config that is not the open plan, and one that
   * the plan on screen cannot answer for. It goes to a worker of its own —
   * pressing this used to take the page away for as long as the run, which on a
   * large herd is seconds.
   */
  async function replace(kind: CashMovement["kind"], plan: typeof planCashInjections) {
    if (planning) return;
    setPlanning(kind);
    const kept = movements.filter((movement) => !isGenerated(movement, kind));
    const base = {
      ...config,
      finance: { ...config.finance, cashMovements: kept },
    };
    try {
      const { runSimulationJob } = await import("@/workers/simulation-client");
      const answer = await runSimulationJob({ type: "project", config: base });
      if (answer.type !== "projection") throw new Error("The farm answered the wrong question.");
      update("finance", "cashMovements", [...kept, ...plan(base, answer.projection)]);
    } catch (error) {
      console.error(error);
      window.alert("The funding plan could not be worked out. Please try again.");
    } finally {
      setPlanning(null);
    }
  }

  function clear(kind: CashMovement["kind"]) {
    update(
      "finance",
      "cashMovements",
      movements.filter((movement) => !isGenerated(movement, kind)),
    );
  }

  return (
    <div className="mt-5 grid gap-4 md:grid-cols-2">
      <Card size="sm">
        <CardContent>
          <p className="text-sm font-semibold text-ink">Cash injections</p>
          <p className="mt-1 text-xs leading-5 text-ink-faint">
            Puts money in month by month, exactly enough to cancel out the months that spend more
            than they take, so the balance never closes below{" "}
            {money(target, currency)}.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={planning !== null}
              onClick={() => void replace("in", planCashInjections)}
            >
              <Plus size={14} />
              {planning === "in" ? "Working it out…" : "Add cash injections"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={injected === 0 || planning !== null}
              onClick={() => clear("in")}
            >
              Remove cash injections
            </Button>
          </div>
          <div className="mt-4 flex items-baseline justify-between border-t border-hairline pt-3">
            <span className="text-xs text-ink-faint">Total cash injections</span>
            <span className="text-lg font-semibold tracking-tight tabular-nums text-good">
              {money(injected, currency)}
            </span>
          </div>
          <p className="mt-1.5 text-xs text-ink-faint">
            Lowest the plan gets as it stands:{" "}
            <span className={projection.summary.lowestCash < target ? "text-critical" : ""}>
              {money(projection.summary.lowestCash, currency)}
            </span>
            .
          </p>
        </CardContent>
      </Card>

      <Card size="sm">
        <CardContent>
          <p className="text-sm font-semibold text-ink">Cash withdrawals</p>
          <p className="mt-1 text-xs leading-5 text-ink-faint">
            Takes the surplus out as it builds, leaving {money(target, currency)} of working
            capital behind — and never more than the leanest month still to come can spare.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={planning !== null}
              onClick={() => void replace("out", planCashWithdrawals)}
            >
              <Minus size={14} />
              {planning === "out" ? "Working it out…" : "Withdraw excess"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={withdrawn === 0 || planning !== null}
              onClick={() => clear("out")}
            >
              Remove withdrawals
            </Button>
          </div>
          <div className="mt-4 flex items-baseline justify-between border-t border-hairline pt-3">
            <span className="text-xs text-ink-faint">Total cash withdrawn</span>
            <span className="text-lg font-semibold tracking-tight tabular-nums">
              {money(withdrawn, currency)}
            </span>
          </div>
          <p className="mt-1.5 text-xs text-ink-faint">
            Cash left at the end of the plan:{" "}
            <span className={projection.summary.closingCash < 0 ? "text-critical" : ""}>
              {money(projection.summary.closingCash, currency)}
            </span>
            .
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

export function Money({
  config,
  projection,
  editing,
  update,
}: {
  /** The config the projection beside it was worked out from. */
  config: PlannerConfig;
  projection: ReturnType<typeof calculateProjection>;
  /**
   * The inputs as they now stand, which is not always the same thing while a
   * farm is running. The funding controls want this one: the rows they write
   * have to show up under them the moment they are written, rather than when
   * the next run comes back.
   */
  editing: PlannerConfig;
  update: <S extends PlannerSection, K extends keyof PlannerConfig[S]>(
    section: S,
    key: K,
    value: PlannerConfig[S][K],
  ) => void;
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

  const selected = periods.find((period) => period.key === selectedKey) ?? null;
  const [panelOpen, setPanelOpen] = useState(false);

  function openPeriod(key: string) {
    setSelectedKey(key);
    setPanelOpen(true);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-ink">Financial planning</h2>
          <p className="mt-1.5 max-w-2xl text-sm leading-6 text-ink-muted">
            What the farm earns and spends, month by month or zoomed out to plan years — and the
            money you put in or take out to carry it between the two.
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
                  ? "bg-brand-soft text-brand"
                  : "text-ink-muted hover:text-ink")
              }
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div>
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
                      onClick={() => openPeriod(period.key)}
                      aria-selected={active}
                      className={
                        "cursor-pointer border-b border-hairline last:border-0 " +
                        (active ? "bg-brand-soft" : "hover:bg-plane")
                      }
                    >
                      <td className="whitespace-nowrap px-3.5 py-2.5 font-medium">
                        {period.label}
                      </td>
                      <td className="whitespace-nowrap px-3.5 py-2.5 text-right tabular-nums text-ink-muted">
                        {money(period.cashIn, currency)}
                      </td>
                      <td className="whitespace-nowrap px-3.5 py-2.5 text-right tabular-nums text-ink-muted">
                        {money(period.cashOut, currency)}
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
            <span>
              Pick a {granularity === "month" ? "month" : "plan year"} to break it down and add
              money in or out.
            </span>
            <span>
              {periods.length} {granularity === "month" ? "months" : "plan years"} simulated
            </span>
          </div>
        </div>

        <FundingControls config={editing} projection={projection} update={update} />

        <ProfitAndWorth
          config={config}
          projection={projection}
          periods={periods}
          granularity={granularity}
        />
      </div>

      <PeriodPanel
        open={panelOpen}
        onOpenChange={setPanelOpen}
        period={selected}
        config={config}
        update={update}
      />
    </div>
  );
}

/**
 * A period opened from the table: what it is expected to receive and spend,
 * and — on a month — the rows you add yourself. Those post to the farm's own
 * general lines, other income and fixed overheads, so they read the same way in
 * the cashflow and the workbook as everything else. Here they are itemised, with
 * the line they belong to shown net of them so the statement still adds up.
 */
function ownTotal(rows: { movement: CashMovement }[], kind: CashMovement["kind"]): number {
  return rows.reduce(
    (sum, row) => (row.movement.kind === kind ? sum + row.movement.amount : sum),
    0,
  );
}

function PeriodPanel({
  open,
  onOpenChange,
  period,
  config,
  update,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  period: PeriodView | null;
  config: PlannerConfig;
  update: <S extends PlannerSection, K extends keyof PlannerConfig[S]>(
    section: S,
    key: K,
    value: PlannerConfig[S][K],
  ) => void;
}) {
  const currency = config.project.currency;
  const movements = config.finance.cashMovements;
  const monthIndex = period?.monthIndex ?? null;
  // A plan year is not a month, so there is no single month to book a row into.
  const editable = monthIndex !== null;

  const mine = movements
    .map((movement, index) => ({ movement, index }))
    .filter((row) => row.movement.monthIndex === monthIndex);

  function write(next: CashMovement[]) {
    update("finance", "cashMovements", next);
  }

  function addRow(kind: CashMovement["kind"]) {
    if (monthIndex === null) return;
    write([
      ...movements,
      { id: `cash-${Date.now()}`, monthIndex, kind, amount: 0, note: "", auto: false },
    ]);
  }

  function change(index: number, patch: Partial<CashMovement>) {
    write(movements.map((row, position) => (position === index ? { ...row, ...patch } : row)));
  }

  function remove(index: number) {
    write(movements.filter((_, position) => position !== index));
  }

  if (!period) return null;

  // The owner's rows post to other income and to fixed overheads. Itemising
  // them here means taking them back out of the line they were added to, or the
  // same money would be shown twice.
  const netOff: Partial<Record<LedgerCategory, number>> = editable
    ? { "other-income": ownTotal(mine, "in"), overheads: ownTotal(mine, "out") }
    : {};
  // This panel is headed "expected to receive and spend", so it reads the cash
  // book: what the month's bank account does, not what it earned and consumed.
  const lines = (categories: readonly LedgerCategory[]) =>
    categories
      .map((category) => ({
        category,
        amount: period.cashTotals[category] - (netOff[category] ?? 0),
      }))
      .filter((line) => line.amount !== 0)
      .sort((a, b) => b.amount - a.amount);

  const income = lines(INCOME_CATEGORIES);
  const spend = lines(EXPENSE_CATEGORIES);

  const ownRows = (kind: CashMovement["kind"]) =>
    mine
      .filter((row) => row.movement.kind === kind)
      .map(({ movement, index }) => (
        <tr key={movement.id} className="border-b border-hairline">
          <td className="py-1.5 pr-2">
            <Input
              value={movement.note}
              placeholder={kind === "in" ? "What the money is for" : "What the cost is for"}
              onChange={(event) => change(index, { note: event.target.value.slice(0, 80) })}
              className="h-8"
            />
          </td>
          <td className="py-1.5">
            <div className="flex items-center justify-end gap-1">
              <Input
                type="number"
                min={0}
                step={100}
                value={movement.amount}
                onChange={(event) => change(index, { amount: Math.max(0, Number(event.target.value)) })}
                className="h-8 w-28 text-right tabular-nums"
              />
              <Button
                variant="ghost"
                size="icon"
                aria-label="Remove this row"
                onClick={() => remove(index)}
              >
                <Trash2 size={15} />
              </Button>
            </div>
          </td>
        </tr>
      ));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 sm:max-w-xl">
        <SheetHeader className="shrink-0 border-b border-hairline">
          <p className="text-xs font-medium text-brand">{period.sublabel}</p>
          <SheetTitle>Expected to receive and spend</SheetTitle>
          <SheetDescription>
            {editable
              ? "Add a row under either heading for money in or out this month. Income joins other income; costs join fixed overheads."
              : "A plan year rolls its months up; open a single month to add money in or out."}
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-6 px-4 py-5">
            <section>
              <div className="flex items-center justify-between gap-3">
                <h4 className="text-sm font-semibold text-ink">Income</h4>
                {editable ? (
                  <Button variant="outline" size="sm" onClick={() => addRow("in")}>
                    <Plus size={14} />
                    Add a row
                  </Button>
                ) : null}
              </div>
              <table className="mt-2 w-full text-sm">
                <tbody>
                  {income.map((line) => (
                    <tr key={line.category} className="border-b border-hairline">
                      <td className="py-1.5 text-ink-muted">{CATEGORY_LABELS[line.category]}</td>
                      <td className="py-1.5 text-right tabular-nums">
                        {money(line.amount, currency)}
                      </td>
                    </tr>
                  ))}
                  {ownRows("in")}
                  {income.length === 0 && mine.every((row) => row.movement.kind === "out") ? (
                    <tr className="border-b border-hairline">
                      <td className="py-1.5 text-ink-faint">Nothing sold in this period</td>
                      <td className="py-1.5 text-right tabular-nums text-ink-faint">
                        {money(0, currency)}
                      </td>
                    </tr>
                  ) : null}
                  <tr>
                    <td className="py-2 font-medium">Total received</td>
                    <td className="py-2 pr-10 text-right font-medium tabular-nums">
                      {money(period.cashIn, currency)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </section>

            <section>
              <div className="flex items-center justify-between gap-3">
                <h4 className="text-sm font-semibold text-ink">Expenditure</h4>
                {editable ? (
                  <Button variant="outline" size="sm" onClick={() => addRow("out")}>
                    <Plus size={14} />
                    Add a row
                  </Button>
                ) : null}
              </div>
              <table className="mt-2 w-full text-sm">
                <tbody>
                  {spend.map((line) => (
                    <tr key={line.category} className="border-b border-hairline">
                      <td className="py-1.5 text-ink-muted">{CATEGORY_LABELS[line.category]}</td>
                      <td className="py-1.5 text-right tabular-nums">
                        {money(line.amount, currency)}
                      </td>
                    </tr>
                  ))}
                  {ownRows("out")}
                  <tr>
                    <td className="py-2 font-medium">Total spent</td>
                    <td className="py-2 pr-10 text-right font-medium tabular-nums">
                      {money(period.cashOut, currency)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </section>

            <div className="space-y-1.5 rounded-lg bg-plane p-3.5 text-sm">
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

            <section>
              <h4 className="text-sm font-semibold text-ink">What drove it</h4>
              <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
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
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

// --------------------------------------------------------------------- method

export function Methodology({
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
      "upkeep at (weight ÷ 100 kg)^0.75 + daily gain × what a kilogram costs at that weight",
      number(metrics.feedConversion.growoutFcr, 2) + " feed to gain over the growout",
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
      "Sale batches",
      "pigs born on one day are one cohort, sold together the day the cohort's average reaches sale weight",
      "One cohort, one sale day",
    ],
    [
      "Haulage to abattoir",
      "pigs sold ÷ lorry capacity, rounded up to whole runs, on the day they are sold",
      config.finance.marketTruckCapacityPigs +
      " pigs per run × " +
      money(config.finance.marketTripCost, config.project.currency),
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
    [
      "Inventory-adjusted profit (experimental)",
      "costs that turned into an unsold animal stay with it, and become an expense when it is sold, dies or is written off",
      "Shown beside the ordinary profit, never instead of it",
    ],
    [
      "Breeding stock depreciation (experimental)",
      "a sow is written down from what she cost to rear, to her cull price, over the litters she is kept for; a boar by the month over his working life",
      config.herd.cullAfterParity +
      " parities per sow · " +
      config.herd.boarWorkingLifeMonths +
      " months per boar",
    ],
    [
      "Farm net worth (experimental)",
      "cash + feed and stores + livestock at accumulated cost + breeding stock at carrying value − what is owed to suppliers",
      "Book value, not market value",
    ],
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
            {BENCHMARK_SOURCES.map((source) => {
              const body = (
                <div>
                  <p className="text-[13px] font-medium text-ink">{source.title}</p>
                  <p className="mt-1 text-xs leading-5 text-ink-faint">{source.note}</p>
                </div>
              );
              // A source held as a document has nowhere to send you, so it is
              // listed without the chevron that promises somewhere to go.
              return source.url ? (
                <a
                  key={source.title}
                  href={source.url}
                  target="_blank"
                  rel="noreferrer"
                  className="group flex items-start justify-between gap-4 rounded-lg border border-hairline p-3.5 transition hover:border-brand hover:bg-brand-soft"
                >
                  {body}
                  <ChevronRight size={15} className="mt-0.5 shrink-0 text-ink-faint" />
                </a>
              ) : (
                <div
                  key={source.title}
                  className="rounded-lg border border-hairline border-dashed p-3.5"
                >
                  {body}
                </div>
              );
            })}
          </div>
        </SectionCard>

        <SectionCard
          title="What this version still does not model"
          description="Explicit limits protect the model from creating false precision."
          icon={ShieldCheck}
        >
          <ul className="space-y-2.5 text-sm leading-6 text-ink-muted">
            {[
              config.project.variation === "settled"
                ? "Settled mode gives one comparison answer but does not show the downside of a bad biological year."
                : "Chance mode is one plausible farm per seed; compare matched seed bands rather than isolated runs.",
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
          <div className="mt-3 flex gap-3 rounded-lg border border-hairline bg-plane p-3.5">
            <Info size={16} className="mt-0.5 shrink-0 text-ink-faint" />
            <p className="text-xs leading-5 text-ink-muted">
              <strong className="font-medium text-ink">Mortality-profile assumption:</strong>{" "}
              profiled timing assigns 55% / 20% / 25% of pre-weaning deaths to days 0–3,
              4–7 and the remainder, and 45% / 25% / 30% of weaner deaths to days 0–7,
              8–14 and the remainder. These are transparent planning assumptions, not values
              established by the benchmark sources above; replace them with herd-specific evidence
              before using timing-sensitive cost results operationally.
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
