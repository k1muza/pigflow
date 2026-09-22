"use client";

import { useMemo } from "react";
import { format, parseISO } from "date-fns";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  farmStateOnDay,
  HOUSING_LABELS,
  type HousingMovementEvent,
  type HousingSimulationResult,
  type PenHousingState,
  type PenStatus,
} from "@/lib/housing";
import { number, plural } from "@/lib/format";

/**
 * What was standing in every pen on one day of the plan, and what moved.
 *
 * The milestone this phase is defined by, put on a screen: pick a day, and the
 * farm can say where every animal was and what was inside every pen. Nothing is
 * recalculated and no farm is run — the day is folded out of the movement
 * records the run already wrote, which is why a day five years in costs the
 * same as the first one.
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

/** Why an occupant moved, in the words a person would use for it. */
const REASON_LABELS: Record<HousingMovementEvent["reason"], string> = {
  INITIAL_PLACEMENT: "Housed",
  SERVICE: "To service",
  GESTATION: "To gestation",
  PRE_FARROW: "Set down to farrow",
  WEANING: "Weaned",
  STAGE_TRANSITION: "Moved up",
  SALE: "Sold",
  CULL: "Culled",
  MORTALITY: "Died",
  MANUAL: "Moved",
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

/** One end of a movement, short enough to read on one line. */
function place(location: { roomId: string; penId: string } | undefined): string {
  return location === undefined ? "—" : location.penId;
}

function occupantName(movement: HousingMovementEvent): string {
  return movement.occupant.type === "animal"
    ? movement.occupant.animalId
    : movement.occupant.cohortId + " (" + movement.occupant.head + ")";
}

/**
 * The whole farm on one day: what moved, and what is standing in every pen.
 *
 * Rendered without a card of its own so that whatever opens it — a dialog
 * today, a page tomorrow — provides its own chrome and its own heading.
 */
export function HousingDay({
  housing,
  day,
}: {
  housing: HousingSimulationResult | null;
  day: number;
}) {
  const state = useMemo(
    () => (housing === null ? null : farmStateOnDay(housing.plan, housing, day)),
    [housing, day],
  );
  const conflicts = useMemo(
    () => (housing === null ? [] : housing.conflicts.filter((entry) => entry.day === day)),
    [housing, day],
  );
  const moves = useMemo(
    () => (housing === null ? [] : housing.movements.filter((entry) => entry.day === day)),
    [housing, day],
  );

  if (housing === null || state === null) {
    return (
      <p className="rounded-lg border border-hairline bg-surface p-4 text-sm leading-6 text-ink-muted">
        This plan has no buildings yet. Generate them in Farm inputs → Housing, and every day of
        the run will say which pen each animal stood in and what moved between them.
      </p>
    );
  }

  const housed = Object.values(state.pens).reduce(
    (total, pen) => total + pen.occupiedHead + pen.sucklingHead,
    0,
  );

  return (
    <div className="space-y-5">
      <p className="text-xs leading-5 text-ink-faint">
        {number(housed, 0)} head housed across {Object.keys(state.pens).length} pens, rebuilt from
        the movement records of the run.
      </p>

      {conflicts.length > 0 ? (
        <div className="rounded-lg border border-warning/40 bg-warning/5 p-3">
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

      <section>
        <h4 className="text-sm font-semibold text-ink">What moved</h4>
        {moves.length > 0 ? (
          <ul className="mt-2 space-y-1">
            {moves.map((movement, index) => (
              <li
                key={index}
                className="flex flex-wrap items-baseline gap-x-2 rounded-lg border border-hairline bg-surface px-3 py-1.5 text-[11px] leading-5 text-ink-faint"
              >
                <span className="font-medium text-ink">{occupantName(movement)}</span>
                <span className="tabular-nums">
                  {place(movement.from)} <span className="text-ink-muted">→</span>{" "}
                  {place(movement.to)}
                </span>
                <span className="ml-auto text-ink-muted">{REASON_LABELS[movement.reason]}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-xs leading-5 text-ink-faint">
            Nothing moved between pens on this day.
          </p>
        )}
      </section>

      <section>
        <h4 className="text-sm font-semibold text-ink">In the pens</h4>
        <div className="mt-2 space-y-4">
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
                          <span className="text-ink-faint">{HOUSING_LABELS[room.housingType]}</span>
                          <span className="ml-2 text-[11px] text-ink-faint">
                            {number(roomState.occupiedHead, 0)} of {roomState.capacityHead}
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
      </section>

      <p className="text-[11px] leading-5 text-ink-faint">
        Day {day} of the plan. Pen names hold still while the housing is not regenerated, so a note
        written against one today still finds it tomorrow.
      </p>
    </div>
  );
}

/** The same thing, opened over whatever the person was looking at. */
export function HousingFarmDialog({
  open,
  onOpenChange,
  housing,
  day,
  date,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  housing: HousingSimulationResult | null;
  day: number;
  date: string;
}) {
  const heading = (() => {
    const moment = parseISO(date);
    return Number.isNaN(moment.getTime()) ? date : format(moment, "EEEE d MMMM yyyy");
  })();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[calc(100dvh-2rem)] max-h-[920px] max-w-[min(1280px,calc(100vw-2rem))] flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b border-hairline px-5 py-4 pr-14">
          <DialogTitle>The whole farm on {heading}</DialogTitle>
          <DialogDescription>
            Every building, room and pen as it stood at the close of the day, and every movement
            between them.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <HousingDay housing={housing} day={day} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
