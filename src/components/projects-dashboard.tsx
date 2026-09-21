"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Copy,
  GitCompareArrows,
  LoaderCircle,
  PiggyBank,
  Plus,
  TriangleAlert,
} from "lucide-react";

import { usePlans } from "@/components/plans-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  COMPARISON_SEEDS,
  buildFutureEnsemble,
  buildPlanEnsemble,
  compareEnsembles,
  diffManyPlanConfigs,
  type Band,
  type EnsembleMetric,
  type FutureEnsemble,
  type PlanEnsemble,
} from "@/lib/comparison";
import { money, number, rate } from "@/lib/format";
import { planHref } from "@/lib/routes";
import { addProject, duplicateProject, projectName, type Project } from "@/lib/workspace";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function BandValue({ value, format }: { value: Band; format: (value: number) => string }) {
  const point = Math.abs(value.p90 - value.p10) < 1e-9;
  return (
    <span
      className="tabular-nums"
      title={point ? "Deterministic result" : "10th percentile · median · 90th percentile"}
    >
      <span className="font-medium text-ink">{format(value.median)}</span>
      {!point ? (
        <span className="ml-1.5 text-ink-faint">
          {format(value.p10)}–{format(value.p90)}
        </span>
      ) : null}
    </span>
  );
}

function sameProjects(left: readonly Project[], right: readonly Project[]): boolean {
  return left.length === right.length && left.every((project, index) => project === right[index]);
}

function scenarioName(project: Project): string {
  return project.config.project.variation === "settled" ? "Settled" : "Chance";
}

function seedsFor(project: Project): readonly number[] {
  return project.config.project.variation === "settled" ? [1] : COMPARISON_SEEDS;
}

const METRICS: {
  key: EnsembleMetric;
  label: string;
  format: (value: number, currency: string) => string;
}[] = [
  { key: "breakEvenPerDeadweightKg", label: "Cost / kg deadweight", format: rate },
  { key: "marginPerDeadweightKg", label: "Margin / kg deadweight", format: rate },
  {
    key: "profitOrLossPerYear",
    label: "Profit or loss / year",
    format: (value, currency) => money(value, currency, true),
  },
  {
    key: "pigsSoldPerYear",
    label: "Pigs sold / year",
    format: (value) => number(value, 1),
  },
  {
    key: "pigsWeanedPerSowYear",
    label: "Pigs weaned / sow / year",
    format: (value) => number(value, 1),
  },
  {
    key: "peakHeadCount",
    label: "Peak head count",
    format: (value) => number(value, 0),
  },
  {
    key: "peakFundingNeed",
    label: "Peak funding need",
    format: (value, currency) => money(value, currency, true),
  },
  {
    key: "inventoryAdjustedProfitPerYear",
    label: "Inventory-adjusted profit / year (experimental)",
    format: (value, currency) => money(value, currency, true),
  },
  {
    key: "livestockInventoryChangePerYear",
    label: "Herd and stores built / year (experimental)",
    format: (value, currency) => money(value, currency, true),
  },
  {
    key: "farmWorthAtEnd",
    label: "Farm net worth at cost, at the end (experimental)",
    format: (value, currency) => money(value, currency, true),
  },
];

function EnsembleTable({
  projects,
  ensembles,
  currency,
}: {
  projects: readonly Project[];
  ensembles: readonly PlanEnsemble[];
  currency: string;
}) {
  return (
    <div className="mt-5 overflow-hidden rounded-lg border border-hairline">
      <Table>
        <TableHeader>
          <TableRow className="bg-plane hover:bg-plane">
            <TableHead>Comparison measure</TableHead>
            {projects.map((project) => (
              <TableHead key={project.id}>
                {projectName(project)}
                <span className="ml-1.5 text-[10px] font-normal text-ink-faint">
                  {scenarioName(project)}
                </span>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {METRICS.map((metric) => (
            <TableRow key={metric.key}>
              <TableCell className="font-medium text-ink-muted">{metric.label}</TableCell>
              {ensembles.map((ensemble, index) => (
                <TableCell key={projects[index].id}>
                  <BandValue
                    value={ensemble.bands[metric.key]}
                    format={(value) => metric.format(value, currency)}
                  />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function Verdicts({
  projects,
  ensembles,
}: {
  projects: readonly Project[];
  ensembles: readonly PlanEnsemble[];
}) {
  const baseline = projects[0];
  return (
    <div className="mt-5 grid gap-3 lg:grid-cols-2">
      {projects.slice(1).map((project, offset) => {
        const comparison = compareEnsembles(ensembles[0], ensembles[offset + 1]);
        const favourable = comparison.verdict === "candidate-lower";
        const close = comparison.verdict === "too-close";
        return (
          <div
            key={project.id}
            className={`flex gap-3 rounded-lg border p-4 ${
              close
                ? "border-warning/50 bg-warning-soft"
                : favourable
                  ? "border-good/30 bg-good-soft"
                  : "border-critical/25 bg-critical-soft"
            }`}
          >
            {close ? (
              <TriangleAlert className="mt-0.5 shrink-0 text-warning" size={18} />
            ) : (
              <CheckCircle2
                className={`mt-0.5 shrink-0 ${favourable ? "text-good" : "text-critical"}`}
                size={18}
              />
            )}
            <div>
              <p className="text-sm font-semibold text-ink">
                {close
                  ? `${projectName(project)} is too close to call`
                  : `${projectName(project)} has ${favourable ? "lower" : "higher"} cost/kg`}
              </p>
              <p className="mt-1 text-xs leading-5 text-ink-muted">
                Versus baseline {projectName(baseline)}: {number(comparison.deltaPct.median, 2)}%
                {comparison.mode === "settled" ? (
                  "."
                ) : (
                  <>
                    {" · "}p10–p90 {number(comparison.deltaPct.p10, 2)}% to{" "}
                    {number(comparison.deltaPct.p90, 2)}% · {comparison.seedsFavoringCandidate}/
                    {comparison.runs} runs favour this plan.
                  </>
                )}
              </p>
              {comparison.mode === "mixed" ? (
                <p className="mt-1 text-[11px] leading-4 text-warning">
                  Mixed scenario modes: a settled point is being compared with chance outcomes.
                </p>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ComparisonScorecard({ projects }: { projects: readonly Project[] }) {
  const currencies = new Set(projects.map((project) => project.config.project.currency));
  const sameCurrency = currencies.size === 1;
  const currency = projects[0].config.project.currency;
  const maxProjectionYears = Math.floor(
    (120 - Math.max(...projects.map((project) => project.config.project.months))) / 12,
  );
  const [requestedProjectionYears, setRequestedProjectionYears] = useState(() =>
    Math.max(1, Math.min(5, maxProjectionYears)),
  );
  const projectionYears = Math.max(1, Math.min(requestedProjectionYears, maxProjectionYears));
  const [completed, setCompleted] = useState<{
    projects: readonly Project[];
    ensembles: PlanEnsemble[];
  } | null>(null);
  const [completedFuture, setCompletedFuture] = useState<{
    projects: readonly Project[];
    years: number;
    ensembles: FutureEnsemble[];
  } | null>(null);
  const ensembles =
    completed && sameProjects(completed.projects, projects) ? completed.ensembles : null;
  const future =
    completedFuture &&
    completedFuture.years === projectionYears &&
    sameProjects(completedFuture.projects, projects)
      ? completedFuture.ensembles
      : null;

  useEffect(() => {
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      if (!sameCurrency) return;
      void (async () => {
        const next: PlanEnsemble[] = [];
        for (const project of projects) {
          await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
          if (cancelled) return;
          next.push(buildPlanEnsemble(project.config, seedsFor(project)));
        }
        if (!cancelled) setCompleted({ projects, ensembles: next });
      })();
    }, 20);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [projects, sameCurrency]);

  useEffect(() => {
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      if (!sameCurrency || maxProjectionYears < 1) return;
      void (async () => {
        const next: FutureEnsemble[] = [];
        for (const project of projects) {
          await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
          if (cancelled) return;
          next.push(
            buildFutureEnsemble(project.config, projectionYears, seedsFor(project)),
          );
        }
        if (!cancelled) {
          setCompletedFuture({ projects, years: projectionYears, ensembles: next });
        }
      })();
    }, 100);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [maxProjectionYears, projects, projectionYears, sameCurrency]);

  const differences = useMemo(
    () => diffManyPlanConfigs(projects.map((project) => project.config)),
    [projects],
  );

  if (!sameCurrency) {
    return (
      <section className="rounded-xl border border-warning/50 bg-warning-soft p-5">
        <div className="flex gap-3">
          <TriangleAlert className="mt-0.5 shrink-0 text-warning" size={18} />
          <div>
            <h2 className="text-sm font-semibold">Choose plans in the same currency</h2>
            <p className="mt-1 text-sm leading-6 text-ink-muted">
              PigFlow will not compare financial results without an exchange-rate assumption.
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-hairline bg-surface p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-medium text-brand">
              <GitCompareArrows size={14} /> Multi-plan scorecard
            </div>
            <h2 className="mt-2 text-lg font-semibold tracking-tight">
              {projectName(projects[0])} is the baseline
            </h2>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-ink-muted">
              Every selected plan is shown as a column. Chance plans run seeds{" "}
              {COMPARISON_SEEDS.join(", ")}; settled plans retain one deterministic result. Cost/kg
              verdicts compare each plan with the first selected plan.
            </p>
          </div>
          {!ensembles ? (
            <span className="inline-flex items-center gap-2 rounded-lg bg-raised px-3 py-2 text-xs text-ink-muted">
              <LoaderCircle size={14} className="animate-spin" /> Running selected plans…
            </span>
          ) : null}
        </div>
        {ensembles ? (
          <>
            <Verdicts projects={projects} ensembles={ensembles} />
            <EnsembleTable projects={projects} ensembles={ensembles} currency={currency} />
            {new Set(projects.map((project) => project.config.project.months)).size > 1 ? (
              <p className="mt-3 text-xs leading-5 text-warning">
                These plans use different horizons. Annual production is normalised, but cost/kg
                and funding include different amounts of start-up time.
              </p>
            ) : null}
          </>
        ) : null}
      </section>

      <section className="rounded-xl border border-hairline bg-surface p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-medium text-brand">
              <ArrowRight size={14} /> Continuation projection
            </div>
            <h2 className="mt-2 text-base font-semibold tracking-tight">
              Continue every selected plan from where it ends
            </h2>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-ink-muted">
              Herd state, replacement pipeline and cash carry into projection year 1. Each plan
              keeps its own Chance or Settled scenario, and only the added future period is shown.
            </p>
          </div>
          {maxProjectionYears > 0 ? (
            <label className="text-xs font-medium text-ink-muted">
              Projection years
              <input
                type="number"
                min={1}
                max={maxProjectionYears}
                step={1}
                value={projectionYears}
                onChange={(event) =>
                  setRequestedProjectionYears(
                    Math.max(1, Math.min(maxProjectionYears, Number(event.target.value) || 1)),
                  )
                }
                className="ml-2 w-16 rounded-md border border-hairline bg-surface px-2 py-1.5 text-right tabular-nums text-ink"
              />
            </label>
          ) : null}
        </div>

        {maxProjectionYears < 1 ? (
          <p className="mt-4 rounded-lg bg-warning-soft p-4 text-sm text-ink-muted">
            A selected plan already uses the 120-month maximum. Shorten it to leave room for a
            continuation projection.
          </p>
        ) : !future ? (
          <div className="mt-5 inline-flex items-center gap-2 rounded-lg bg-raised px-3 py-2 text-xs text-ink-muted">
            <LoaderCircle size={14} className="animate-spin" /> Extending selected plans by{" "}
            {projectionYears} year{projectionYears === 1 ? "" : "s"}…
          </div>
        ) : (
          <>
            <div className="mt-5 overflow-hidden rounded-lg border border-hairline">
              <Table>
                <TableHeader>
                  <TableRow className="bg-plane hover:bg-plane">
                    <TableHead>Future measure</TableHead>
                    {projects.map((project) => (
                      <TableHead key={project.id}>
                        {projectName(project)}
                        <span className="ml-1.5 text-[10px] font-normal text-ink-faint">
                          {scenarioName(project)}
                        </span>
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[
                    {
                      label: "Cash carried in from plan end",
                      value: (result: FutureEnsemble) => result.startingCash,
                      format: (value: number) => money(value, currency, true),
                    },
                    {
                      label: "Profit or loss / year",
                      value: (result: FutureEnsemble) => result.profitOrLossPerYear,
                      format: (value: number) => money(value, currency, true),
                    },
                    {
                      label: "Carcass kg sold / projection year",
                      value: (result: FutureEnsemble) => result.deadweightKgPerYear,
                      format: (value: number) => number(value, 0),
                    },
                    {
                      label: "Pigs sold / projection year",
                      value: (result: FutureEnsemble) => result.pigsSoldPerYear,
                      format: (value: number) => number(value, 1),
                    },
                    {
                      label: `Closing cash after ${projectionYears} year${projectionYears === 1 ? "" : "s"}`,
                      value: (result: FutureEnsemble) => result.closingCashAtEnd,
                      format: (value: number) => money(value, currency, true),
                    },
                  ].map((metric) => (
                    <TableRow key={metric.label}>
                      <TableCell className="font-medium text-ink-muted">{metric.label}</TableCell>
                      {future.map((result, index) => (
                        <TableCell key={projects[index].id}>
                          <BandValue value={metric.value(result)} format={metric.format} />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="mt-4 overflow-hidden rounded-lg border border-hairline">
              <Table>
                <TableHeader>
                  <TableRow className="bg-plane hover:bg-plane">
                    <TableHead>Projection year</TableHead>
                    <TableHead>Measure</TableHead>
                    {projects.map((project) => (
                      <TableHead key={project.id}>{projectName(project)}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {future[0].years.flatMap((year, yearIndex) => [
                    <TableRow key={`${year.year}-profit`}>
                      <TableCell className="font-medium">Year {year.year}</TableCell>
                      <TableCell>Profit or loss</TableCell>
                      {future.map((result, index) => (
                        <TableCell key={projects[index].id}>
                          <BandValue
                            value={result.years[yearIndex].profitOrLoss}
                            format={(value) => money(value, currency, true)}
                          />
                        </TableCell>
                      ))}
                    </TableRow>,
                    <TableRow key={`${year.year}-cash`}>
                      <TableCell className="font-medium">Year {year.year}</TableCell>
                      <TableCell>Closing cash</TableCell>
                      {future.map((result, index) => (
                        <TableCell key={projects[index].id}>
                          <BandValue
                            value={result.years[yearIndex].closingCash}
                            format={(value) => money(value, currency, true)}
                          />
                        </TableCell>
                      ))}
                    </TableRow>,
                  ])}
                </TableBody>
              </Table>
            </div>
            <p className="mt-3 text-[11px] leading-5 text-ink-faint">
              Profit or loss is farm income less farm costs; automatic cash injections and owner
              withdrawals are excluded. Closing cash begins with each original plan’s ending balance.
            </p>
          </>
        )}
      </section>

      <section className="rounded-xl border border-hairline bg-surface p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold tracking-tight">What changed</h2>
            <p className="mt-1 text-xs leading-5 text-ink-muted">
              Inputs that differ anywhere across the selected plans. Name and seed are excluded.
            </p>
          </div>
          <span className="rounded-full bg-raised px-2.5 py-1 text-xs text-ink-muted">
            {differences.length} difference{differences.length === 1 ? "" : "s"}
          </span>
        </div>
        {differences.length === 0 ? (
          <p className="mt-4 rounded-lg bg-plane p-4 text-sm text-ink-muted">
            The selected plans have the same comparison inputs.
          </p>
        ) : (
          <div className="mt-4 overflow-hidden rounded-lg border border-hairline">
            <Table>
              <TableHeader>
                <TableRow className="bg-plane hover:bg-plane">
                  <TableHead>Input</TableHead>
                  {projects.map((project) => (
                    <TableHead key={project.id}>{projectName(project)}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {differences.map((difference) => (
                  <TableRow key={difference.path}>
                    <TableCell>
                      <span className="block text-xs font-medium text-ink">{difference.label}</span>
                      <span className="block text-[11px] text-ink-faint">{difference.section}</span>
                    </TableCell>
                    {difference.values.map((value, index) => (
                      <TableCell key={projects[index].id} className="tabular-nums">
                        {value}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}

export default function ProjectsDashboard() {
  const router = useRouter();
  const { workspace, setWorkspace, hydrated, sync } = usePlans();
  const [requestedSelection, setRequestedSelection] = useState<string[] | null>(null);
  const selected = useMemo(() => {
    if (requestedSelection === null) {
      return workspace.projects.slice(0, 2).map((project) => project.id);
    }
    const available = new Set(workspace.projects.map((project) => project.id));
    return requestedSelection.filter((id) => available.has(id));
  }, [requestedSelection, workspace.projects]);
  const chosen = useMemo(
    () =>
      selected
        .map((id) => workspace.projects.find((project) => project.id === id))
        .filter((project): project is Project => Boolean(project)),
    [selected, workspace.projects],
  );

  function toggle(id: string) {
    setRequestedSelection(
      selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id],
    );
  }

  function newPlan() {
    const next = addProject(workspace, `Plan ${workspace.projects.length + 1}`);
    setWorkspace(next);
    router.push(planHref(next.activeId));
  }

  function copyPlan(id: string) {
    const next = duplicateProject(workspace, id);
    setWorkspace(next);
    router.push(planHref(next.activeId));
  }

  if (!hydrated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-plane text-sm text-ink-muted">
        <LoaderCircle className="mr-2 animate-spin" size={16} /> Opening plans…
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-plane text-ink">
      <header className="border-b border-hairline bg-surface">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Link href={planHref(workspace.activeId)} className="flex items-center gap-2.5">
            <span className="flex size-9 items-center justify-center rounded-lg bg-raised">
              <PiggyBank size={19} />
            </span>
            <span>
              <span className="block text-sm font-semibold">PigFlow</span>
              <span className="block text-[11px] text-ink-faint">Plans & comparison</span>
            </span>
          </Link>
          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-ink-faint sm:inline">
              {sync === "local" ? "Stored on this device" : "Shared plans"}
            </span>
            <ThemeToggle />
            <button
              type="button"
              onClick={newPlan}
              className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-3 py-2 text-xs font-medium text-surface"
            >
              <Plus size={14} /> New plan
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1500px] space-y-5 p-4 sm:p-6">
        <div>
          <div className="flex items-center gap-2 text-xs font-medium text-brand">
            <BarChart3 size={14} /> Scenario comparison
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">
            Compare plans without mistaking luck for an improvement.
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-muted">
            Select any number of plans. The first selected plan is the baseline; every other plan
            is compared with it. Settled plans show points and chance plans show matched-seed bands.
          </p>
        </div>

        <section className="rounded-xl border border-hairline bg-surface p-5 sm:p-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold tracking-tight">Plans</h2>
              <p className="mt-1 text-xs text-ink-muted">
                Select at least two. Selection order determines the baseline.
              </p>
            </div>
            <span className="text-xs text-ink-faint">{selected.length} selected</span>
          </div>
          <div className="mt-4 overflow-hidden rounded-lg border border-hairline">
            <Table>
              <TableHeader>
                <TableRow className="bg-plane hover:bg-plane">
                  <TableHead className="w-20">Compare</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Horizon</TableHead>
                  <TableHead>Scenario</TableHead>
                  <TableHead>Sow places</TableHead>
                  <TableHead>Sale weight</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {workspace.projects.map((project) => {
                  const checked = selected.includes(project.id);
                  const baseline = selected[0] === project.id;
                  return (
                    <TableRow key={project.id} data-state={checked ? "selected" : undefined}>
                      <TableCell>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggle(project.id)}
                          aria-label={`Compare ${projectName(project)}`}
                          className="size-4 accent-brand"
                        />
                      </TableCell>
                      <TableCell>
                        <Link href={planHref(project.id)} className="font-medium text-ink hover:text-brand">
                          {projectName(project)}
                        </Link>
                        {baseline ? (
                          <span className="ml-2 rounded-full bg-brand-soft px-2 py-0.5 text-[10px] font-medium text-brand">
                            Baseline
                          </span>
                        ) : null}
                        <span className="ml-2 text-[11px] text-ink-faint">
                          {project.config.project.currency}
                        </span>
                      </TableCell>
                      <TableCell>{project.config.project.months} months</TableCell>
                      <TableCell>{scenarioName(project)}</TableCell>
                      <TableCell>{number(project.config.herd.maxSows, 0)}</TableCell>
                      <TableCell>{number(project.config.growth.saleWeightKg, 0)} kg</TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => copyPlan(project.id)}
                            className="inline-flex items-center gap-1 rounded-md border border-hairline px-2 py-1 text-xs text-ink-muted hover:bg-raised"
                          >
                            <Copy size={12} /> Copy
                          </button>
                          <Link
                            href={planHref(project.id)}
                            className="inline-flex items-center gap-1 rounded-md border border-hairline px-2 py-1 text-xs font-medium text-ink hover:bg-raised"
                          >
                            Open <ArrowRight size={12} />
                          </Link>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </section>

        {chosen.length >= 2 ? (
          <ComparisonScorecard projects={chosen} />
        ) : (
          <section className="rounded-xl border border-dashed border-rule bg-surface p-8 text-center">
            <GitCompareArrows className="mx-auto text-ink-faint" size={24} />
            <p className="mt-3 text-sm font-medium">Select at least two plans to compare.</p>
            <p className="mt-1 text-xs text-ink-muted">
              If you only have one, copy it, change an input, then select both.
            </p>
          </section>
        )}
      </div>
    </main>
  );
}
