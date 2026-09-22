"use client";

import { useMemo } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  farmStateOnDay,
  HOUSING_LABELS,
  type HousingSimulationResult,
  type PenHousingState,
  type PenStatus,
} from "@/lib/housing";
import { number, plural } from "@/lib/format";

/**
 * What was standing in every pen on one day of the plan.
 *
 * The milestone this phase is defined by, put on a screen: pick a day, and the
 * farm can say where every animal was and what was inside every pen. Nothing is
 * recalculated and no farm is run — the day is folded out of the movement
 * records the run already wrote, which is why a day five years in costs the same
 * as the first one.
 *
 * Deliberately a read-out and nothing more. Moving an animal by hand, booking a
 * pen out of service and the rest of daily operations are the next phase; this
 * one is traceability.
 */

const STATUS_LABELS: Record<PenStatus, string> = {
  NOT_COMMISSIONED: "Not built yet",
  AVAILABLE: "Available",
  OCCUPIED: "Occupied",
  RESERVED: "Booked",
  CLEANING: "Cleaning",
  OUT_OF_SERVICE: "Out of service",
};

const STATUS_TONE: Record<PenStatus, string> = {
  NOT_COMMISSIONED: "text-ink-faint",
  AVAILABLE: "text-ink-faint",
  OCCUPIED: "text-ink",
  RESERVED: "text-warning",
  CLEANING: "text-ink-muted",
  OUT_OF_SERVICE: "text-critical",
};

/** Who is in the pen, in the words a stockperson would use walking past it. */
function occupantsText(pen: PenHousingState): string {
  if (pen.occupants.length === 0) return STATUS_LABELS[pen.status];
  const parts = pen.occupants.map((occupant) =>
    occupant.type === "animal"
      ? occupant.animalId
      : pen.housingType === "farrowing"
        ? "litter of " + occupant.head
        : occupant.cohortId + " — " + plural(occupant.head, "pig"),
  );
  return parts.join(" + ");
}

export function HousingDay({
  housing,
  day,
  date,
  className,
}: {
  housing: HousingSimulationResult | null;
  day: number;
  date: string;
  className?: string;
}) {
  const state = useMemo(
    () => (housing === null ? null : farmStateOnDay(housing.plan, housing, day)),
    [housing, day],
  );
  const conflicts = useMemo(
    () => (housing === null ? [] : housing.conflicts.filter((entry) => entry.day === day)),
    [housing, day],
  );

  if (housing === null || state === null) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle>Physical housing</CardTitle>
          <CardDescription>
            This plan has no buildings yet. Generate them in Farm inputs → Housing, and every day of
            the run will say which pen each animal stood in.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const housed = Object.values(state.pens).reduce(
    (total, pen) => total + pen.occupiedHead + pen.sucklingHead,
    0,
  );

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Physical housing</CardTitle>
        <CardDescription>
          Every pen on {date}, rebuilt from the movement records of the run —{" "}
          {number(housed, 0)} head housed across {Object.keys(state.pens).length} pens.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {state.unhoused.length > 0 ? (
          <p className="mb-4 rounded-lg border border-warning/40 bg-warning/5 p-3 text-xs leading-5 text-ink-muted">
            {plural(state.unhoused.length, "animal")} had nowhere to stand at the end of the run.
          </p>
        ) : null}

        {conflicts.length > 0 ? (
          <div className="mb-4 rounded-lg border border-warning/40 bg-warning/5 p-3">
            <p className="text-xs font-medium text-ink">Nowhere to put them on this day</p>
            <ul className="mt-1.5 space-y-1 text-xs leading-5 text-ink-muted">
              {conflicts.map((conflict, index) => (
                <li key={index}>
                  {HOUSING_LABELS[conflict.housingType]}: {plural(conflict.requiredHead, "head")}{" "}
                  wanted a place and {conflict.availableHeadCapacity} were free —{" "}
                  {conflict.reason.toLowerCase().replace(/_/g, " ")}.
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="space-y-4">
          {housing.plan.buildings.map((building) => {
            const buildingState = state.buildings[building.id];
            if (!buildingState?.commissioned) return null;
            return (
              <div key={building.id}>
                <p className="text-[13px] font-medium text-ink">
                  {building.name}
                  <span className="ml-2 text-xs font-normal text-ink-faint">
                    {number(buildingState.occupiedHead, 0)} of {buildingState.capacityHead} places
                    used
                  </span>
                </p>
                <div className="mt-2 space-y-2">
                  {building.rooms.map((room) => {
                    const roomState = state.rooms[room.id];
                    if (!roomState?.commissioned) return null;
                    return (
                      <div
                        key={room.id}
                        className="rounded-lg border border-hairline bg-surface px-3 py-2"
                      >
                        <p className="text-xs text-ink-muted">
                          <span className="font-medium text-ink">{room.name}</span>{" "}
                          <span className="text-ink-faint">
                            {HOUSING_LABELS[room.housingType]}
                          </span>
                        </p>
                        <ul className="mt-1 grid gap-x-4 gap-y-0.5 sm:grid-cols-2 xl:grid-cols-3">
                          {room.pens.map((pen) => {
                            const penState = state.pens[pen.id];
                            return (
                              <li
                                key={pen.id}
                                className={`text-[11px] leading-5 ${STATUS_TONE[penState.status]}`}
                                title={pen.id}
                              >
                                <span className="text-ink-muted">{pen.name}</span> —{" "}
                                {occupantsText(penState)}
                                {penState.status === "CLEANING" &&
                                penState.cleaningUntilDay !== undefined
                                  ? ` (until day ${penState.cleaningUntilDay})`
                                  : null}
                                {penState.status === "RESERVED" &&
                                penState.reservedUntilDay !== undefined
                                  ? ` (due day ${penState.reservedUntilDay})`
                                  : null}
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
