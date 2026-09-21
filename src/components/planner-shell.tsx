"use client";

import {
  createContext,
  useContext,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import {
  AlertTriangle,
  BarChart3,
  BookOpen,
  CalendarClock,
  ChevronsUpDown,
  Cloud,
  CloudOff,
  Copy,
  Download,
  GitCompareArrows,
  HeartPulse,
  LoaderCircle,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  PencilLine,
  PiggyBank,
  Plus,
  RefreshCcw,
  Save,
  ServerCrash,
  Settings2,
  TableProperties,
  Trash2,
  WalletCards,
  X,
} from "lucide-react";

import {
  cloneDefaultConfig,
  getModelMetrics,
  plannerSchema,
  type PlannerConfig,
  type PlannerSection,
} from "@/lib/model";
import { usePlanSimulation } from "@/hooks/use-plan-simulation";
import type { PlanSimulationResult } from "@/lib/simulation-result";
import type { SimulationStatus } from "@/lib/simulation-worker";
import { plural } from "@/lib/format";
import { buildInputsJson, inputsJsonFilename } from "@/lib/export-inputs";
import { planHref, tabFromPath, type Tab } from "@/lib/routes";
import {
  activeProject,
  addProject,
  duplicateProject,
  MAX_PROJECTS,
  openProject,
  projectName,
  removeProject,
  renameProject,
  setProjectConfig,
  type Project,
  type Workspace,
} from "@/lib/workspace";
import { type SyncState } from "@/hooks/use-workspace";
import { usePlans } from "@/components/plans-provider";
import { useAuth } from "@/hooks/use-auth";
import { signOutOfPlanner } from "@/lib/auth";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FarmInputs } from "@/components/planner-sections";
import { ThemeToggle } from "@/components/theme-toggle";

const NAV: { id: Tab; label: string; icon: typeof BarChart3 }[] = [
  { id: "overview", label: "Overview", icon: BarChart3 },
  { id: "simulator", label: "Farm simulator", icon: CalendarClock },
  { id: "money", label: "Financial planning", icon: WalletCards },
  { id: "method", label: "Method & sources", icon: BookOpen },
  { id: "cashflow", label: "Cashflow", icon: TableProperties },
];

// ----------------------------------------------------------- what a page sees

/**
 * Everything a page of a plan needs, worked out once by the shell around it.
 *
 * The plan is simulated where the sidebar is, not where the chart is, because
 * the simulation is the expensive part and moving between pages must not start
 * it again. Each page below is then only a way of looking at a result that is
 * already in hand.
 *
 * "Once" now means once for the whole plan rather than once per page: the
 * cashflow's projection, the simulator's calendar and the day panel all come
 * off {@link PlannerPage.simulation}, which is one run of the engine the plan is
 * set to — and that run happens in a worker, so the page below stays drawable
 * while it goes on.
 */
export type PlannerPage = {
  /** The plan being read — the id in the address bar. */
  projectId: string;
  config: PlannerConfig;
  /**
   * The one run of the plan behind every page: the last one that finished,
   * carrying both the projection and the config the farm was actually given.
   *
   * A page that shows a simulated figure must read `simulation.config` and
   * `simulation.projection` together and not touch `config` above, which is what
   * the inputs say now. The two come apart while a run is in flight, and a page
   * that mixes them shows this month's opening balance above last edit's
   * closing ones.
   *
   * It stays on screen while a newer run goes on, and is null before the first
   * one comes back, while the inputs are outside the supported range, and for
   * as long as a newly opened plan has nothing of its own yet.
   */
  simulation: PlanSimulationResult | null;
  /** Where the farm behind this page has got to. */
  simulationStatus: SimulationStatus;
  /** A newer plan is running behind the one on screen. */
  simulationUpdating: boolean;
  /** Why the last run failed, if it did. The plan on screen is the last good one. */
  simulationError: string | null;
  metrics: ReturnType<typeof getModelMetrics>;
  update: <S extends PlannerSection, K extends keyof PlannerConfig[S]>(
    section: S,
    key: K,
    value: PlannerConfig[S][K],
  ) => void;
  exporting: boolean;
  exportExcel: () => void;
  openInputs: () => void;
  /** The address of another page of this same plan. */
  href: (tab: Tab) => string;
};

const PlannerContext = createContext<PlannerPage | null>(null);

export function usePlanner(): PlannerPage {
  const page = useContext(PlannerContext);
  if (!page) throw new Error("A plan's page has to be rendered inside the planner shell.");
  return page;
}

// ------------------------------------------------------------------ the chrome

/**
 * Who is signed in, and the way out. It names the account because the plans are
 * shared: when an edit turns up that nobody in the room made, the first useful
 * question is which account is open on this machine.
 */
function SignedInAs() {
  const { user, required } = useAuth();
  if (!required || !user) return null;
  return (
    <div className="flex items-center gap-2 px-1">
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] text-ink-faint">Signed in as</span>
        <span className="block truncate text-xs font-medium text-ink" title={user.email ?? undefined}>
          {user.email ?? "an account with no email"}
        </span>
      </span>
      <button
        type="button"
        onClick={() => void signOutOfPlanner()}
        title="Sign out"
        aria-label="Sign out"
        className="shrink-0 rounded-md p-1.5 text-ink-faint transition hover:bg-raised hover:text-ink"
      >
        <LogOut size={14} strokeWidth={1.75} />
      </button>
    </div>
  );
}

/** Stands in for the planner while the shared plans are on their way. */
function OpeningPlans() {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-hairline bg-raised/50 p-4 text-sm text-ink-muted">
      <Cloud size={16} className="shrink-0 animate-pulse" />
      Opening the shared plans…
    </div>
  );
}

/**
 * What an address naming a plan we do not hold gets.
 *
 * A link to a plan is a link anybody can be sent, so it can outlive the plan it
 * points at. Being told the plan is gone is a better answer than a blank screen,
 * and a far better one than somebody else's numbers under the name you expected.
 */
function PlanNotHere({ workspace }: { workspace: Workspace }) {
  return (
    <div className="mx-auto max-w-lg rounded-xl border border-hairline bg-surface p-6 text-sm">
      <div className="flex gap-3">
        <AlertTriangle className="mt-0.5 shrink-0 text-warning" size={18} />
        <div>
          <p className="font-medium text-ink">This plan is not here.</p>
          <p className="mt-1 leading-6 text-ink-muted">
            The link may point at a plan that has since been deleted, or at plans kept somewhere
            other than this planner.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {workspace.projects.slice(0, 4).map((project) => (
              <Link
                key={project.id}
                href={planHref(project.id)}
                className="rounded-lg border border-hairline px-3 py-1.5 text-xs font-medium text-ink-muted transition hover:bg-raised hover:text-ink"
              >
                {projectName(project)}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Says where the plan on screen has got to. Plans are shared, so "saved" is no
 * longer the whole story: someone on a bad line needs to know their edit is
 * held on this device rather than already with everyone else.
 */
function SyncBadge({ sync, savedAt }: { sync: SyncState; savedAt: string | null }) {
  const saved = savedAt ? `Saved ${savedAt}` : "Saved";

  const state = {
    local: {
      icon: Save,
      text: savedAt ? saved + " on this device" : "Stored on this device",
      tone: "text-ink-faint",
    },
    connecting: { icon: Cloud, text: "Connecting…", tone: "text-ink-faint" },
    offline: { icon: CloudOff, text: savedAt ? saved + " on this device" : "Offline", tone: "text-ink-faint" },
    synced: { icon: Cloud, text: savedAt ? saved + " to the cloud" : "Shared plans", tone: "text-ink-faint" },
    error: { icon: ServerCrash, text: "Not syncing", tone: "text-amber-600" },
  }[sync];

  const Icon = state.icon;
  return (
    <span
      title={
        sync === "error"
          ? "The shared copy could not be reached. This plan is still safe in this browser."
          : sync === "offline"
            ? "Working offline. Edits are queued and will sync when the connection returns."
            : undefined
      }
      className={`hidden items-center gap-1.5 text-xs lg:flex ${state.tone}`}
    >
      <Icon size={13} />
      {state.text}
    </span>
  );
}

/**
 * Where the farm behind the page has got to.
 *
 * It sits beside the sync badge because it answers the same kind of question —
 * is what I am looking at the current thing? — and because the answer is worth
 * a line of text rather than a spinner over the whole page. While a new plan
 * runs, the old one stays on screen and this says so; if a run fails, the last
 * good plan stays on screen and this says that too.
 */
function FarmBadge({
  status,
  updating,
  error,
}: {
  status: SimulationStatus;
  updating: boolean;
  error: string | null;
}) {
  if (status === "error") {
    return (
      <span
        title={(error ?? "The simulation failed.") + " The plan shown is the last one that ran."}
        className="hidden items-center gap-1.5 text-xs text-amber-600 lg:flex"
      >
        <ServerCrash size={13} /> Simulation failed
      </span>
    );
  }
  if (!updating && status !== "running") return null;
  return (
    <span
      title="The farm is running. What is on screen is the plan before this edit."
      className="hidden items-center gap-1.5 text-xs text-ink-faint lg:flex"
    >
      <LoaderCircle size={13} className="animate-spin" /> Updating…
    </span>
  );
}

/**
 * What a plan looks like before its first run comes back.
 *
 * The farm now runs beside the page rather than in front of it, which means
 * there is a moment — the first one — when a plan is open and nothing has been
 * worked out about it yet. Saying so beats an empty panel.
 */
function RunningFirstPlan() {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-hairline bg-raised/50 p-4 text-sm text-ink-muted">
      <LoaderCircle size={16} className="shrink-0 animate-spin" />
      Running the farm…
    </div>
  );
}

/** A first run that failed: there is no earlier plan to fall back on. */
function FarmWouldNotRun({ error }: { error: string | null }) {
  return (
    <div className="flex gap-3 rounded-xl border border-critical/30 bg-critical-soft p-4 text-sm">
      <AlertTriangle className="mt-0.5 shrink-0 text-critical" size={16} />
      <div>
        <p className="font-medium text-ink">The farm could not be simulated.</p>
        <p className="mt-1 text-ink-muted">{error ?? "The simulation failed."}</p>
      </div>
    </div>
  );
}

/**
 * Picks which plan is open, and manages the set of them. Plans are scenarios of
 * one farm more often than they are different farms — the same herd with a
 * bigger shed, or feed at next year's price — so the menu leads with the list
 * and keeps duplicating the open plan one click away.
 */
function ProjectSwitcher({
  workspace,
  open,
  shared,
  onOpen,
  onNew,
  onDuplicate,
  onRename,
  onDelete,
  onCompare,
}: {
  workspace: Workspace;
  /** The plan the address names, or null while there is no such plan here. */
  open: Project | null;
  /** Whether these plans are the shared set or only this browser's. */
  shared: boolean;
  onOpen: (id: string) => void;
  onNew: () => void;
  onDuplicate: () => void;
  onRename: () => void;
  onDelete: () => void;
  onCompare: () => void;
}) {
  const full = workspace.projects.length >= MAX_PROJECTS;
  const onlyPlan = workspace.projects.length < 2;

  return (
    <h1 className="flex min-w-0 text-sm font-semibold tracking-tight text-ink sm:text-base">
      <DropdownMenu>
        <DropdownMenuTrigger className="-ml-1.5 flex min-w-0 items-center gap-1.5 rounded-lg px-1.5 py-0.5 outline-none transition hover:bg-raised focus-visible:ring-3 focus-visible:ring-brand/40">
          <span className="truncate">{open ? projectName(open) : "Choose a plan"}</span>
          <ChevronsUpDown size={14} className="shrink-0 text-ink-faint" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-w-80">
          <DropdownMenuLabel>
            {plural(workspace.projects.length, "plan")}
            {shared ? ", shared with everyone" : " on this device"}
          </DropdownMenuLabel>
          <DropdownMenuRadioGroup value={open?.id ?? ""} onValueChange={onOpen}>
            {workspace.projects.map((project) => (
              <DropdownMenuRadioItem key={project.id} value={project.id}>
                <span className="min-w-0">
                  <span className="block truncate font-medium">{projectName(project)}</span>
                  <span className="block truncate text-[11px] font-normal text-ink-faint">
                    {plural(project.config.project.months, "month")} ·{" "}
                    {plural(project.config.herd.maxSows, "sow place")} ·{" "}
                    {project.config.project.currency}
                  </span>
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onCompare}>
            <GitCompareArrows size={14} /> Compare plans
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onNew} disabled={full}>
            <Plus size={14} /> New plan
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onDuplicate} disabled={full || !open}>
            <Copy size={14} /> Duplicate this plan
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onRename} disabled={!open}>
            <PencilLine size={14} /> Rename…
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={onDelete}
            disabled={onlyPlan || !open}
            className="text-critical data-highlighted:bg-critical-soft"
          >
            <Trash2 size={14} /> Delete this plan
          </DropdownMenuItem>
          {full ? (
            <p className="px-2.5 pt-1.5 pb-1 text-[11px] leading-4 text-ink-faint">
              {MAX_PROJECTS} plans is the limit. Delete one to make room for another.
            </p>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </h1>
  );
}

// ------------------------------------------------------------------ container

/**
 * Everything around a plan's pages: the plans themselves, the sidebar, the
 * header, and the one simulation every page below reads from.
 *
 * This is the layout of `/projects/[projectId]`, so it survives the move from
 * one page of a plan to another: the plans are not fetched again and the herd
 * is not simulated again when the cashflow is opened.
 */
export default function PlannerShell({ children }: { children: ReactNode }) {
  const { projectId } = useParams<{ projectId: string }>();
  const pathname = usePathname();
  const router = useRouter();
  const tab = tabFromPath(pathname);

  // The plans live above this layout, because this layout is rebuilt whenever
  // the plan in the address changes and they must not be.
  const { workspace, setWorkspace, hydrated, savedAt, sync, sidebarOpen, toggleSidebar } =
    usePlans();
  const [exporting, setExporting] = useState(false);
  const [inputsOpen, setInputsOpen] = useState(false);

  // The plan the address names. Until the shared plans arrive there is nothing
  // to find, and the starting defaults stand in so the work below still has a
  // config to run on — none of it is shown, because nothing is shown until then.
  const open = workspace.projects.find((project) => project.id === projectId) ?? null;
  const config = (open ?? activeProject(workspace)).config;

  /** Remembers which plan was last open, so that "/" can go back to it. */
  useEffect(() => {
    if (!hydrated) return;
    setWorkspace((current) =>
      current.activeId === projectId || !current.projects.some((plan) => plan.id === projectId)
        ? current
        : openProject(current, projectId),
    );
  }, [hydrated, projectId, setWorkspace]);

  /** Writes inputs back to the plan in the address, leaving the other plans alone. */
  function setConfig(next: PlannerConfig | ((current: PlannerConfig) => PlannerConfig)) {
    setWorkspace((current) => {
      const plan = current.projects.find((project) => project.id === projectId);
      if (!plan) return current;
      return setProjectConfig(
        current,
        projectId,
        typeof next === "function" ? next(plan.config) : next,
      );
    });
  }

  /**
   * The inputs stay on the live config and the farm runs against a deferred
   * copy.
   *
   * Kept after the move into a worker, for a reason that changed rather than
   * went away. It used to be what stopped every keystroke blocking the page for
   * a few hundred milliseconds; the worker does that now.
   *
   * What it still does is its actual job: keep React free to go on painting the
   * charts, the tables and the calendar off the plan already in hand while the
   * inputs are being changed. It is not a debounce and is not relied on as one
   * — it coalesces updates only while React is busy, and somebody typing at a
   * human pace gives it time to settle between every digit. Not running a farm
   * per keystroke is `usePlanSimulation`'s doing; see `SETTLE_MS` there.
   */
  const settledConfig = useDeferredValue(config);
  const validation = useMemo(() => plannerSchema.safeParse(settledConfig), [settledConfig]);
  // One run of the farm per settled plan, in a worker. Every page below reads
  // what comes back: the projection, the simulator's calendar, and whichever
  // day of it is open. Picking another date costs a lookup, not a run.
  /**
   * The plan to hand to the farm, or null for "not yet".
   *
   * Two things hold it back. Nothing runs before the stored plans arrive, since
   * until then `config` is only the starting defaults and simulating those is a
   * whole farm run for a plan nobody asked for. And nothing runs while the
   * deferred copy is still catching up, so that a run is started against inputs
   * React has finished with rather than ones still moving.
   */
  const committed = settledConfig === config;
  const checked = useMemo(
    () => (hydrated && committed && validation.success ? validation.data : null),
    [committed, hydrated, validation],
  );
  const farm = usePlanSimulation(checked, projectId);
  /**
   * The plan on screen: one run, with the config that produced it.
   *
   * Every page that shows a simulated figure reads both halves of this and
   * neither half of `config`. The two are not interchangeable while a run is in
   * flight — `config` is what the inputs now say and `simulation.config` is what
   * the farm was actually given — and mixing them puts a $10,000 opening balance
   * above closing balances worked out from $0.
   */
  const simulation = farm.result;
  /**
   * Whether the plan on screen answers the inputs as they stand.
   *
   * True only when the last run finished and nothing has superseded it: a run
   * in flight means the result is a config behind, and a failed one means the
   * result is the last config that worked. What it gates is the export — a
   * workbook is a thing people send, and it should not have to be read
   * alongside a badge to know which edit it describes.
   */
  const current = farm.status === "ready" && simulation !== null;
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
    if (window.confirm("Reset this plan's inputs to the evidence-based starter assumptions?")) {
      setConfig((current) => {
        const fresh = cloneDefaultConfig();
        // Resetting the numbers is not renaming the plan.
        fresh.project.name = current.project.name;
        return fresh;
      });
    }
  }

  function exportInputsJson() {
    if (!open) return;
    const blob = new Blob([buildInputsJson(config)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = inputsJsonFilename(config);
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function newPlan() {
    const next = addProject(workspace, "Plan " + (workspace.projects.length + 1));
    if (next === workspace) return;
    setWorkspace(next);
    router.push(planHref(next.activeId));
    // A plan you have just started is a plan you are about to describe.
    setInputsOpen(true);
  }

  function duplicatePlan() {
    const next = duplicateProject(workspace, projectId);
    if (next === workspace) return;
    setWorkspace(next);
    // The copy opens on the page you were comparing from.
    router.push(planHref(next.activeId, tab));
  }

  function renamePlan() {
    if (!open) return;
    const name = window.prompt("Name this plan", projectName(open));
    if (name) setWorkspace((current) => renameProject(current, projectId, name));
  }

  function deletePlan() {
    if (!open || workspace.projects.length < 2) return;
    const question = "Delete " + projectName(open) + "? Its inputs and its cashflow go with it.";
    if (!window.confirm(question)) return;
    const next = removeProject(workspace, projectId);
    if (next === workspace) return;
    setWorkspace(next);
    // Replaced rather than pushed: going back to a plan that is gone is no use.
    router.replace(planHref(next.activeId, tab));
  }

  async function exportExcel() {
    // The config and the projection go into the workbook together, so they have
    // to have come out of the same run together.
    if (!current || !simulation || exporting) return;
    setExporting(true);
    try {
      const { buildCashflowWorkbook } = await import("@/lib/export-workbook");
      const output = await buildCashflowWorkbook(simulation.config, simulation.projection);
      const blob = new Blob([output], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${simulation.config.project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-funding-cashflow.xlsx`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (error) {
      console.error(error);
      window.alert("The Excel workbook could not be created. Please try again.");
    } finally {
      setExporting(false);
    }
  }

  const activeLabel = NAV.find((item) => item.id === tab)?.label;
  const page: PlannerPage = {
    projectId,
    config,
    simulation,
    simulationStatus: farm.status,
    simulationUpdating: farm.isUpdating,
    simulationError: farm.error,
    metrics: modelMetrics,
    update,
    exporting,
    exportExcel,
    openInputs: () => setInputsOpen(true),
    href: (to) => planHref(projectId, to),
  };

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
              <Link href={planHref(projectId)} className="flex items-center gap-2.5 text-left">
                <span className="flex size-8 items-center justify-center rounded-lg bg-raised text-ink">
                  <PiggyBank size={18} strokeWidth={1.75} />
                </span>
                <span>
                  <span className="block text-sm font-semibold tracking-tight">PigFlow</span>
                  <span className="block text-[11px] text-ink-faint">Piggery planning model</span>
                </span>
              </Link>
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
                // Nothing is being shown when the address names no plan we hold,
                // so nothing in the sidebar is the page you are on.
                const selected = Boolean(open) && tab === item.id;
                return (
                  <Link
                    key={item.id}
                    href={planHref(projectId, item.id)}
                    onClick={() => {
                      if (window.innerWidth < 1024) toggleSidebar();
                    }}
                    aria-current={selected ? "page" : undefined}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition ${selected
                        ? "bg-brand-soft font-medium text-brand"
                        : "text-ink-muted hover:bg-raised hover:text-ink"
                      }`}
                  >
                    <Icon size={16} strokeWidth={1.75} />
                    {item.label}
                  </Link>
                );
              })}
            </nav>

            <div className="mt-auto space-y-3 p-4">
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
              <SignedInAs />
            </div>
          </aside>
        </>
      ) : null}

      <main className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 border-b border-hairline bg-surface/85 px-4 py-3 backdrop-blur sm:px-6">
          <div className="mx-auto flex max-w-[1500px] items-center gap-3 sm:gap-4">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <button
                type="button"
                onClick={toggleSidebar}
                aria-expanded={sidebarOpen}
                aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
                title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
                className="shrink-0 rounded-lg border border-hairline p-2 text-ink-muted transition hover:bg-raised hover:text-ink"
              >
                {sidebarOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
              </button>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-[11px] text-ink-faint">
                  <span>PigFlow</span>
                  <span>/</span>
                  <span className="text-ink-muted">{activeLabel}</span>
                </div>
                <ProjectSwitcher
                  workspace={workspace}
                  open={open}
                  shared={sync !== "local"}
                  onOpen={(id) => router.push(planHref(id, tab))}
                  onNew={newPlan}
                  onDuplicate={duplicatePlan}
                  onRename={renamePlan}
                  onDelete={deletePlan}
                  onCompare={() => router.push("/projects")}
                />
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <FarmBadge
                status={farm.status}
                updating={farm.isUpdating}
                error={farm.error}
              />
              <SyncBadge sync={sync} savedAt={savedAt} />
              <ThemeToggle />
              <button
                type="button"
                onClick={() => setInputsOpen(true)}
                disabled={!open}
                aria-label="Open farm inputs"
                className="inline-flex items-center gap-2 rounded-lg border border-hairline px-2.5 py-2 text-xs font-medium text-ink-muted transition hover:bg-raised hover:text-ink disabled:opacity-40 sm:px-3"
              >
                <Settings2 size={13} /> <span className="hidden lg:inline">Farm inputs</span>
              </button>
              <button
                onClick={exportExcel}
                disabled={!open || !current || exporting}
                aria-label="Export the cashflow to Excel"
                className="inline-flex items-center gap-2 rounded-lg bg-ink px-2.5 py-2 text-xs font-medium text-surface transition hover:bg-ink-muted disabled:opacity-40 sm:px-3"
              >
                <Download size={13} />
                {/* On a narrow screen the plan's name is worth more room than the word "Excel". */}
                <span className="hidden sm:inline">
                  {exporting ? "Preparing…" : "Export Excel"}
                </span>
                <span className="sm:hidden">{exporting ? "…" : "Export"}</span>
              </button>
            </div>
          </div>
        </header>

        <Dialog open={inputsOpen} onOpenChange={setInputsOpen}>
          <DialogContent className="flex h-[calc(100dvh-2rem)] max-h-[920px] max-w-[min(1280px,calc(100vw-2rem))] flex-col gap-0 overflow-hidden p-0">
            <DialogHeader className="shrink-0 border-b border-hairline px-5 py-4 pr-14">
              <DialogTitle>Farm inputs - {config.project.name}</DialogTitle>
            </DialogHeader>
            <div className="min-h-0 flex-1 overflow-hidden">
              <FarmInputs config={config} update={update} metrics={modelMetrics} />
            </div>
            <DialogFooter className="shrink-0 border-t border-hairline px-5 py-3 sm:justify-start">
              <button
                type="button"
                onClick={exportInputsJson}
                disabled={!open}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-ink px-3 py-2 text-xs font-medium text-surface transition hover:bg-ink-muted disabled:opacity-40"
              >
                <Download size={13} /> Export inputs as JSON
              </button>
              <button
                type="button"
                onClick={resetPlan}
                disabled={!open}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-hairline px-3 py-2 text-xs font-medium text-ink-muted transition hover:bg-raised hover:text-ink disabled:opacity-40"
              >
                <RefreshCcw size={13} /> Reset farm inputs
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <div className="mx-auto max-w-[1500px] p-4 sm:p-6">
          {/*
            Until the shared plans have arrived, what is on screen is only the
            starting defaults. Showing them as though they were a plan would
            invite edits that the first reading is about to replace.
          */}
          {!hydrated ? <OpeningPlans /> : null}

          {hydrated && !open ? <PlanNotHere workspace={workspace} /> : null}

          {hydrated && open && !validation.success ? (
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

          {hydrated && open && validation.success && simulation === null ? (
            farm.status === "error" ? (
              <FarmWouldNotRun error={farm.error} />
            ) : (
              <RunningFirstPlan />
            )
          ) : null}

          {hydrated && open ? (
            <PlannerContext.Provider value={page}>{children}</PlannerContext.Provider>
          ) : null}
        </div>
      </main>
    </div>
  );
}
