"use client";

import { useMemo, useState } from "react";
import { addDays, format, parseISO } from "date-fns";
import { AlertTriangle, Building2, Hammer, Rows3 } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { PlannerConfig, PlannerSection } from "@/lib/config";
import {
  HOUSING_LABELS,
  hasPhysicalHousing,
  housingIsStale,
  planDiff,
  planTotals,
  type HousingType,
  type PhysicalFarmPlan,
} from "@/lib/housing";
import { number } from "@/lib/format";

/**
 * The Housing tab: the farm as a place, and the one button that draws it.
 *
 * Housing used to be four boxes of aggregate places, which asked the farmer to
 * do the one piece of arithmetic the plan is best placed to do for them, and
 * gave the simulator nothing to put an animal in. This replaces them with the
 * thing itself — buildings, rooms and pens, with the dates the work falls due —
 * and the four boxes only appear on a plan that has not generated any yet.
 *
 * Generating is a button and never a side effect. The layout is worked out from
 * a run of the farm, so it would be easy to redraw it on every edit; it is not
 * done, because pens have names, the names are on movement records, and a plan
 * that renamed its farm every time somebody typed in a box would be a plan you
 * could not keep notes against.
 */

type Update = <S extends PlannerSection, K extends keyof PlannerConfig[S]>(
  section: S,
  key: K,
  value: PlannerConfig[S][K],
) => void;

/** Housing types in the order a farm walks them, for the capacity read-out. */
const ORDER: readonly HousingType[] = [
  "boar",
  "service_sow",
  "gestation",
  "farrowing",
  "gilt",
  "weaner",
  "grower",
  "finisher",
];

function dateOf(config: PlannerConfig, day: number): string {
  const start = parseISO(config.project.startDate);
  if (Number.isNaN(start.getTime())) return "day " + day;
  return format(addDays(start, Math.max(0, day)), "d MMM yyyy");
}

export function HousingSettings({
  config,
  update,
  className,
}: {
  config: PlannerConfig;
  update: Update;
  className?: string;
}) {
  const plan = config.housing.physical;
  const built = hasPhysicalHousing(config);
  const stale = housingIsStale(config);
  const totals = useMemo(() => planTotals(plan), [plan]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Draws the farm, then asks before replacing one that is already standing.
   *
   * The confirmation comes after the run rather than before it because the
   * question worth asking is not "are you sure?" but "this is what would
   * change — are you sure?", and the second one cannot be asked until the new
   * layout exists.
   */
  async function generate() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const { runSimulationJob } = await import("@/workers/simulation-client");
      const answer = await runSimulationJob({ type: "generate-housing", config });
      if (answer.type !== "housing") throw new Error("The farm answered the wrong question.");
      if (built && !window.confirm(replacementQuestion(plan, answer.plan))) return;
      update("housing", "physical", answer.plan);
    } catch (cause) {
      console.error(cause);
      setError(
        cause instanceof Error ? cause.message : "The housing could not be generated. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={className}>
      <Card className="[--card-spacing:--spacing(5)]">
        <CardHeader className="grid-cols-[auto_1fr] gap-x-3">
          <span className="row-span-2 flex size-8 items-center justify-center rounded-lg bg-raised text-ink-muted">
            <Building2 size={16} strokeWidth={1.75} />
          </span>
          <CardTitle>Housing</CardTitle>
          <CardDescription>
            The buildings, rooms and pens this plan is run in. Generated from a run of the farm
            against the ARC Pig Housing Manual profile, and never redrawn on its own.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void generate()}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-lg bg-ink px-3 py-2 text-xs font-medium text-surface transition hover:bg-ink-muted disabled:opacity-40"
            >
              <Hammer size={13} />
              {busy
                ? "Working the farm out…"
                : built
                  ? "Regenerate housing"
                  : "Generate housing"}
            </button>
            <span className="text-xs leading-5 text-ink-faint">
              {built ? (
                <>
                  {totals.buildings} buildings · {totals.rooms} rooms · {totals.pens} pens ·{" "}
                  {number(totals.headCapacity, 0)} places
                  {plan?.generatedAt ? " · drawn " + shortDate(plan.generatedAt) : null}
                </>
              ) : (
                "No physical housing yet. Generating runs the plan once and lays out the smallest unit that can hold it."
              )}
            </span>
          </div>

          {error ? (
            <p className="mt-3 flex items-start gap-2 rounded-lg border border-hairline bg-raised/50 p-3 text-xs leading-5 text-critical">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {error}
            </p>
          ) : null}

          {stale ? (
            <p className="mt-3 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/5 p-3 text-xs leading-5 text-ink-muted">
              <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warning" />
              <span>
                Housing may be out of date with the current plan. The herd has changed since these
                buildings were drawn; the farm still runs in them, and regenerating redraws them
                against the plan as it now stands.
              </span>
            </p>
          ) : null}

          {built && plan ? (
            <>
              <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {ORDER.filter((type) => (totals.pensByType[type] ?? 0) > 0).map((type) => (
                  <div key={type} className="rounded-lg border border-hairline bg-surface p-3">
                    <p className="text-xs font-medium text-ink-faint">{HOUSING_LABELS[type]}</p>
                    <p className="mt-1 text-lg font-semibold tabular-nums text-ink">
                      {number(totals.headCapacityByType[type] ?? 0, 0)}
                      <span className="ml-1 text-xs font-normal text-ink-faint">places</span>
                    </p>
                    <p className="text-[11px] text-ink-faint">
                      in {totals.pensByType[type]} pens
                    </p>
                  </div>
                ))}
              </div>

              <Phases config={config} plan={plan} />
              <Hierarchy config={config} plan={plan} />
            </>
          ) : null}
        </CardContent>
      </Card>

      {built ? null : <LegacyHousing config={config} update={update} />}
      <Bedding config={config} update={update} />
    </div>
  );
}

/** The question asked before a farm that already exists is redrawn. */
function replacementQuestion(before: PhysicalFarmPlan | undefined, after: PhysicalFarmPlan): string {
  const diff = planDiff(before, after);
  const line = (label: string, change: { from: number; to: number }) =>
    `${label}: ${change.from} → ${change.to}`;
  return [
    "Replace the generated housing?",
    "",
    line("Buildings", diff.buildings),
    line("Rooms", diff.rooms),
    line("Pens", diff.pens),
    line("Places", diff.headCapacity),
    "",
    diff.penIdsRemoved.length > 0
      ? `${diff.penIdsRemoved.length} pen names go and ${diff.penIdsAdded.length} appear. Anything written against an old pen name — notes, movement records from an earlier run — will no longer match.`
      : "No pen names change.",
  ].join("\n");
}

function shortDate(timestamp: string): string {
  const moment = parseISO(timestamp);
  return Number.isNaN(moment.getTime()) ? timestamp : format(moment, "d MMM yyyy");
}

/**
 * The construction programme, read off the rooms rather than stated.
 *
 * Rooms that have to be standing on the same day are one piece of work, which is
 * how a builder would quote it and how the housing needs plan phases it.
 */
function Phases({ config, plan }: { config: PlannerConfig; plan: PhysicalFarmPlan }) {
  const phases = useMemo(() => {
    const byDay = new Map<number, { rooms: number; pens: number; head: number }>();
    for (const building of plan.buildings) {
      for (const room of building.rooms) {
        const phase = byDay.get(room.commissionedDay) ?? { rooms: 0, pens: 0, head: 0 };
        phase.rooms += 1;
        phase.pens += room.pens.length;
        phase.head += room.pens.reduce((total, pen) => total + pen.maxHead, 0);
        byDay.set(room.commissionedDay, phase);
      }
    }
    return [...byDay.entries()].sort((a, b) => a[0] - b[0]);
  }, [plan]);

  if (phases.length === 0) return null;
  return (
    <div className="mt-5">
      <p className="text-[13px] font-medium text-ink-muted">Construction phases</p>
      <ul className="mt-2 space-y-1.5">
        {phases.map(([day, phase], index) => (
          <li
            key={day}
            className="flex flex-wrap items-baseline gap-x-2 rounded-lg border border-hairline bg-surface px-3 py-2 text-xs text-ink-muted"
          >
            <span className="font-medium text-ink">Phase {index + 1}</span>
            <span>standing by {dateOf(config, day)}</span>
            <span className="text-ink-faint">
              · {phase.rooms} rooms, {phase.pens} pens, {number(phase.head, 0)} places
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] leading-5 text-ink-faint">
        A pen cannot hold an animal before its phase lands. The simulator will not put one in
        early; it reports the shortage instead.
      </p>
    </div>
  );
}

/** Building, room, pen — collapsed, because a farm is a long list. */
function Hierarchy({ config, plan }: { config: PlannerConfig; plan: PhysicalFarmPlan }) {
  return (
    <div className="mt-5">
      <p className="text-[13px] font-medium text-ink-muted">The farm</p>
      <div className="mt-2 space-y-2">
        {plan.buildings.map((building) => (
          <details
            key={building.id}
            className="rounded-lg border border-hairline bg-surface px-3 py-2"
          >
            <summary className="cursor-pointer list-none text-[13px] font-medium text-ink marker:hidden">
              <span className="inline-flex items-center gap-2">
                <Building2 size={13} className="text-ink-faint" />
                {building.name}
                <span className="font-normal text-ink-faint">
                  {building.id} · {building.rooms.length} rooms ·{" "}
                  {number(building.widthM, 1)} × {number(building.lengthM, 1)} m
                </span>
              </span>
            </summary>
            <div className="mt-2 space-y-1.5 border-l border-hairline pl-3">
              {building.rooms.map((room) => (
                <details key={room.id}>
                  <summary className="cursor-pointer list-none text-xs text-ink-muted marker:hidden">
                    <span className="inline-flex flex-wrap items-baseline gap-x-2">
                      <span className="font-medium text-ink">{room.name}</span>
                      <span>{HOUSING_LABELS[room.housingType]}</span>
                      <span className="text-ink-faint">
                        {room.pens.length} pens
                        {room.commissionedDay > 0
                          ? " · from " + dateOf(config, room.commissionedDay)
                          : null}
                      </span>
                    </span>
                  </summary>
                  <ul className="mt-1 mb-2 space-y-0.5 border-l border-hairline pl-3">
                    {room.pens.map((pen) => (
                      <li key={pen.id} className="text-[11px] text-ink-faint tabular-nums">
                        <span className="text-ink-muted">{pen.name}</span> · {pen.id} ·{" "}
                        {pen.maxHead} {pen.maxHead === 1 ? "place" : "places"} ·{" "}
                        {number(pen.floorAreaM2, 2)} m²
                      </li>
                    ))}
                  </ul>
                </details>
              ))}
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}

/**
 * The aggregate places, for a plan that has not generated a farm yet.
 *
 * Shown only until there is real housing, and then never again: two sources of
 * truth is what this phase exists to get rid of, and the moment there are pens
 * the pens are what the farm is run against.
 */
function LegacyHousing({ config, update }: { config: PlannerConfig; update: Update }) {
  return (
    <Card className="mt-5 [--card-spacing:--spacing(5)]">
      <CardHeader className="grid-cols-[auto_1fr] gap-x-3">
        <span className="row-span-2 flex size-8 items-center justify-center rounded-lg bg-raised text-ink-muted">
          <Rows3 size={16} strokeWidth={1.75} />
        </span>
        <CardTitle>Legacy housing configuration</CardTitle>
        <CardDescription>
          Aggregate places, as this plan was written before housing was a place. They still drive
          the occupancy lines and the crowding rules — and they stop being read the moment you
          generate housing above.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <PlaceField
            label="Farrowing places"
            value={config.housing.farrowingPlaces}
            onChange={(value) => update("housing", "farrowingPlaces", value)}
          />
          <PlaceField
            label="Weaner places"
            value={config.housing.weanerPlaces}
            onChange={(value) => update("housing", "weanerPlaces", value)}
          />
          <PlaceField
            label="Grower places"
            value={config.housing.growerPlaces}
            onChange={(value) => update("housing", "growerPlaces", value)}
          />
          <PlaceField
            label="Finisher places"
            value={config.housing.finisherPlaces}
            onChange={(value) => update("housing", "finisherPlaces", value)}
          />
        </div>
      </CardContent>
    </Card>
  );
}

/** Straw and shavings: a consumable the animals stand on, not a building. */
function Bedding({ config, update }: { config: PlannerConfig; update: Update }) {
  const currency = config.project.currency;
  return (
    <Card className="mt-5 [--card-spacing:--spacing(5)]">
      <CardHeader className="grid-cols-[auto_1fr] gap-x-3">
        <span className="row-span-2 flex size-8 items-center justify-center rounded-lg bg-raised text-ink-muted">
          <Rows3 size={16} strokeWidth={1.75} />
        </span>
        <CardTitle>Bedding</CardTitle>
        <CardDescription>
          Straw or shavings under every animal housed, bought by the load and held in a store.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <PlaceField
            label="Bedding per head"
            suffix="kg/head/day"
            step={0.01}
            value={config.housing.beddingKgPerHeadDay}
            onChange={(value) => update("housing", "beddingKgPerHeadDay", value)}
            round={false}
          />
          <PlaceField
            label="Bedding price"
            suffix={`${currency}/kg`}
            step={0.01}
            value={config.housing.beddingCostPerKg}
            onChange={(value) => update("housing", "beddingCostPerKg", value)}
            round={false}
          />
          <PlaceField
            label="Bedding load"
            suffix="kg a load brings"
            step={100}
            value={config.housing.beddingLoadKg}
            onChange={(value) => update("housing", "beddingLoadKg", value)}
            round={false}
          />
          <PlaceField
            label="Bedding delivery"
            suffix={`${currency}/trip`}
            step={5}
            value={config.housing.beddingDeliveryCost}
            onChange={(value) => update("housing", "beddingDeliveryCost", value)}
            round={false}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function PlaceField({
  label,
  value,
  onChange,
  suffix = "places",
  step = 1,
  round = true,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  suffix?: string;
  step?: number;
  round?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-medium text-ink-muted">{label}</span>
        <span className="text-[11px] text-ink-faint">{suffix}</span>
      </span>
      <Input
        type="number"
        value={value}
        min={0}
        step={step}
        onChange={(event) => {
          const next = Number(event.target.value);
          onChange(round ? Math.round(next) : next);
        }}
        className="font-medium tabular-nums"
      />
    </label>
  );
}
