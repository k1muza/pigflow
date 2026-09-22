import type { HousingType } from "../rules";
import { allPens, type PhysicalFarmPlan, type PhysicalLocation } from "./model";
import {
  deriveFromPens,
  emptyFarmState,
  type PenOccupant,
  type PenHousingState,
  type PenStatus,
  type PhysicalFarmState,
} from "./state";

/**
 * What happened to the housing, and how to read a day back out of it.
 *
 * The farm is not photographed every morning. A five-year plan is eighteen
 * hundred mornings, and a deep copy of every pen on every one of them is tens of
 * megabytes to say, over and over, that nothing moved. What actually happened is
 * a few thousand movements, a few thousand status changes and a handful of
 * commissioning dates — so that is what is kept, and any morning of the plan is
 * a fold of the events up to it.
 *
 * Two questions are the whole point of this file, and they are the two the
 * milestone is defined by: where was this animal on that day, and what was
 * standing in that pen. Both are answered here, off the events, without running
 * the farm again.
 */

/** Why an occupant moved. Never "because the packing would be tidier". */
export type MovementReason =
  | "INITIAL_PLACEMENT"
  | "SERVICE"
  | "GESTATION"
  | "PRE_FARROW"
  | "WEANING"
  | "STAGE_TRANSITION"
  | "SALE"
  | "CULL"
  | "MORTALITY"
  | "MANUAL";

/**
 * One movement.
 *
 * No `from` means the occupant arrived on the farm; no `to` means it left it.
 * Both are present for everything in between, which is most of them.
 *
 * Weaning is the exception worth knowing about. A litter is the group born on a
 * morning and a weaner batch is the group weaned on one, and they are not the
 * same group — two sows' litters go into one weaner pen. So a weaning is two
 * lines of the same day: the litter leaving the farrowing pen, and the batch
 * arriving in the weaner house. A gilt promoted into the breeding herd is the
 * same shape, for the same reason.
 */
export type HousingMovementEvent = {
  day: number;
  occupant: PenOccupant;
  from?: PhysicalLocation;
  to?: PhysicalLocation;
  reason: MovementReason;
  /** The house the move was into, or out of where there is nowhere to go. */
  housingType: HousingType;
};

/** A pen changing state, which is the other half of what a pen does. */
export type PenStatusEvent = {
  day: number;
  penId: string;
  status: PenStatus;
  /** When a cleaning or a reservation is expected to end. */
  untilDay?: number;
};

/** A room coming into service, which is a building phase landing. */
export type RoomCommissionedEvent = {
  day: number;
  buildingId: string;
  roomId: string;
  housingType: HousingType;
  pens: number;
  headCapacity: number;
};

/** What the farm could not do, said out loud rather than absorbed. */
export type HousingConflict = {
  day: number;
  housingType: HousingType;
  requiredHead: number;
  availableHeadCapacity: number;
  occupantId?: string;
  reason:
    | "NO_COMMISSIONED_PEN"
    | "ALL_COMPATIBLE_PENS_FULL"
    | "ALL_COMPATIBLE_PENS_CLEANING"
    | "ALL_COMPATIBLE_PENS_RESERVED"
    | "GROUP_CANNOT_FIT";
};

/** The event stream, which is the record. Everything else is a fold of it. */
export type HousingHistory = {
  movements: HousingMovementEvent[];
  statusChanges: PenStatusEvent[];
  commissionings: RoomCommissionedEvent[];
};

export function emptyHistory(): HousingHistory {
  return { movements: [], statusChanges: [], commissionings: [] };
}

// ----------------------------------------------------------------- reading it

/** The key a cohort's head is counted under in one pen. */
function occupantKey(occupant: PenOccupant): string {
  return occupant.type === "animal" ? "animal:" + occupant.animalId : "cohort:" + occupant.cohortId;
}

/**
 * Where an animal or a cohort was standing at the close of a given day.
 *
 * An animal is in one place or nowhere, so the answer is one location or none.
 * A cohort can be in two pens at once — twenty-eight weaners do not fit in one
 * pen of twenty — so it answers with a place and a head count for each, which
 * is the true answer rather than a tidier one.
 */
export function locationOnDay(
  history: HousingHistory,
  entityId: string,
  day: number,
): { location: PhysicalLocation; head: number }[] {
  const byPen = new Map<string, { location: PhysicalLocation; head: number }>();
  for (const movement of history.movements) {
    if (movement.day > day) break;
    const occupant = movement.occupant;
    const matches =
      occupant.type === "animal" ? occupant.animalId === entityId : occupant.cohortId === entityId;
    if (!matches) continue;
    const head = occupant.type === "animal" ? 1 : occupant.head;
    if (movement.from) {
      const held = byPen.get(movement.from.penId);
      if (held) {
        held.head -= head;
        if (held.head <= 0) byPen.delete(movement.from.penId);
      }
    }
    if (movement.to) {
      const held = byPen.get(movement.to.penId);
      if (held) held.head += head;
      else byPen.set(movement.to.penId, { location: movement.to, head });
    }
  }
  return [...byPen.values()];
}

/** The same question for one animal, which has one answer or none. */
export function animalLocationOnDay(
  history: HousingHistory,
  animalId: string,
  day: number,
): PhysicalLocation | null {
  const places = locationOnDay(history, animalId, day);
  return places.length > 0 ? places[0].location : null;
}

/** Who was standing in one pen at the close of a given day. */
export function penOccupantsOnDay(
  history: HousingHistory,
  penId: string,
  day: number,
): PenOccupant[] {
  const held = new Map<string, PenOccupant>();
  for (const movement of history.movements) {
    if (movement.day > day) break;
    const leaving = movement.from?.penId === penId;
    const arriving = movement.to?.penId === penId;
    if (!leaving && !arriving) continue;
    const key = occupantKey(movement.occupant);
    if (leaving) {
      const current = held.get(key);
      if (current) {
        if (current.type === "cohort" && movement.occupant.type === "cohort") {
          current.head -= movement.occupant.head;
          if (current.head <= 0) held.delete(key);
        } else {
          held.delete(key);
        }
      }
    }
    if (arriving) {
      const current = held.get(key);
      if (current && current.type === "cohort" && movement.occupant.type === "cohort") {
        current.head += movement.occupant.head;
      } else {
        held.set(key, { ...movement.occupant });
      }
    }
  }
  return [...held.values()];
}

/** The status one pen was in at the close of a given day. */
export function penStatusOnDay(
  plan: PhysicalFarmPlan,
  history: HousingHistory,
  penId: string,
  day: number,
): PenStatus {
  let status: PenStatus | null = null;
  for (const event of history.statusChanges) {
    if (event.day > day) break;
    if (event.penId === penId) status = event.status;
  }
  if (status !== null) return status;
  const pen = allPens(plan).find((entry) => entry.id === penId);
  if (!pen) return "OUT_OF_SERVICE";
  return day >= pen.commissionedDay ? "AVAILABLE" : "NOT_COMMISSIONED";
}

/**
 * The whole farm on one day of the plan, rebuilt from the events.
 *
 * This is what a page showing "day 842" reads, and it is the thing the whole
 * event-sourced record exists to make possible: no day was kept, and every day
 * can be produced. Linear in the events up to that day, which on a plan of any
 * size is quicker than a lookup into a table that would not have fitted in
 * memory.
 */
export function farmStateOnDay(
  plan: PhysicalFarmPlan,
  history: HousingHistory,
  day: number,
): PhysicalFarmState {
  const state = emptyFarmState(plan, day);
  const pens = state.pens;

  const heads = new Map<string, Map<string, PenOccupant>>();

  for (const movement of history.movements) {
    if (movement.day > day) break;
    const occupant = movement.occupant;
    const key = occupantKey(occupant);
    const head = occupant.type === "animal" ? 1 : occupant.head;

    if (movement.from) {
      const pen = heads.get(movement.from.penId);
      const current = pen?.get(key);
      if (pen && current) {
        if (current.type === "cohort") {
          current.head -= head;
          if (current.head <= 0) pen.delete(key);
        } else {
          pen.delete(key);
        }
      }
    }
    if (movement.to) {
      let pen = heads.get(movement.to.penId);
      if (!pen) {
        pen = new Map();
        heads.set(movement.to.penId, pen);
      }
      const current = pen.get(key);
      if (current && current.type === "cohort" && occupant.type === "cohort") {
        current.head += head;
      } else {
        pen.set(key, { ...occupant });
      }
    }
  }

  for (const [penId, occupants] of heads) {
    const pen = pens[penId];
    if (!pen) continue;
    // Named animals first and then the groups, each in their own order, so that
    // a rebuilt day reads the same as the day the run itself held — and so that
    // two readings of the same day are the same reading.
    pen.occupants = [...occupants.values()].sort((a, b) => {
      if (a.type !== b.type) return a.type === "animal" ? -1 : 1;
      const left = a.type === "animal" ? a.animalId : a.cohortId;
      const right = b.type === "animal" ? b.animalId : b.cohortId;
      return left < right ? -1 : left > right ? 1 : 0;
    });
    // The only group in a farrowing pen is a litter, and the only place-taking
    // occupant is the sow. Everywhere else, everybody standing in the pen is
    // taking one of its places.
    const suckling =
      pen.housingType === "farrowing"
        ? pen.occupants.reduce(
            (total, occupant) => total + (occupant.type === "cohort" ? occupant.head : 0),
            0,
          )
        : 0;
    pen.sucklingHead = suckling;
    pen.occupiedHead = pen.occupants.reduce(
      (total, occupant) => total + (occupant.type === "animal" ? 1 : occupant.head),
      0,
    );
    pen.occupiedHead = Math.max(0, pen.occupiedHead - suckling);
  }

  for (const event of history.statusChanges) {
    if (event.day > day) break;
    const pen = pens[event.penId];
    if (!pen) continue;
    pen.status = event.status;
    pen.cleaningUntilDay = event.status === "CLEANING" ? event.untilDay : undefined;
    pen.reservedUntilDay = event.status === "RESERVED" ? event.untilDay : undefined;
  }

  const derived = deriveFromPens(plan, pens);
  state.rooms = derived.rooms;
  state.buildings = derived.buildings;
  state.entityLocations = locationsFrom(pens, plan);
  return state;
}

/** Every occupant's location, written out of the pens they are standing in. */
function locationsFrom(
  pens: Record<string, PenHousingState>,
  plan: PhysicalFarmPlan,
): Record<string, PhysicalLocation> {
  const locations: Record<string, PhysicalLocation> = {};
  for (const building of plan.buildings) {
    for (const room of building.rooms) {
      for (const pen of room.pens) {
        const state = pens[pen.id];
        if (!state) continue;
        const location = { buildingId: building.id, roomId: room.id, penId: pen.id };
        for (const occupant of state.occupants) {
          locations[occupant.type === "animal" ? occupant.animalId : occupant.cohortId] = location;
        }
      }
    }
  }
  return locations;
}
