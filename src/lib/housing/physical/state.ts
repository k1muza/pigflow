import type { HousingType } from "../rules";
import type { PhysicalFarmPlan, PhysicalLocation } from "./model";

/**
 * The farm as it stands this morning.
 *
 * A reading rather than a record: it is what the allocator holds while it runs,
 * and what a page is handed for one day of a finished run. The history is the
 * source of truth — see `./history` — and this is the fold of it, which is why
 * every field here can be worked out again from the events and none of them is
 * kept for its own sake.
 *
 * Rooms and buildings carry no capacity of their own. A room is its pens and a
 * building is its rooms, so both are derived here every time rather than
 * maintained alongside the pens: two counts of the same thing eventually
 * disagree, and the one that is wrong is always the one being read.
 */

/** Where a pen is in its life. An empty pen under the hose is not available. */
export type PenStatus =
  | "NOT_COMMISSIONED"
  | "AVAILABLE"
  | "OCCUPIED"
  | "RESERVED"
  | "CLEANING"
  | "OUT_OF_SERVICE";

/**
 * Who is in a pen.
 *
 * A breeding animal is named, because a farm names them: a sow is an individual
 * with a card, a service date and a litter behind her. Growing pigs are a group,
 * because that is how they are handled — they arrive as a batch, move as a batch
 * and leave as a batch, and thirty rows saying the same thing about thirty pigs
 * would be a less useful record of the same fact, not a more precise one.
 */
export type PenOccupant =
  | { type: "animal"; animalId: string }
  | { type: "cohort"; cohortId: string; head: number };

export type PenHousingState = {
  penId: string;
  roomId: string;
  buildingId: string;
  name: string;
  housingType: HousingType;
  status: PenStatus;
  occupants: PenOccupant[];
  /**
   * Head standing in the pen and taking up a place in it.
   *
   * Sucklers are not in this and are in `sucklingHead` instead. A litter stands
   * in its dam's farrowing pen and takes none of the pen's own places — the pen
   * holds one sow — so counting the piglets against its capacity would report
   * every farrowing place in the country as eleven times over its head.
   */
  occupiedHead: number;
  sucklingHead: number;
  maxHead: number;
  reservedUntilDay?: number;
  cleaningUntilDay?: number;
};

/** A room, as its pens leave it. */
export type RoomHousingState = {
  roomId: string;
  buildingId: string;
  name: string;
  housingType: HousingType;
  commissioned: boolean;
  penIds: string[];
  occupiedHead: number;
  sucklingHead: number;
  capacityHead: number;
  pensByStatus: Record<PenStatus, number>;
};

export type BuildingHousingState = {
  buildingId: string;
  name: string;
  commissioned: boolean;
  roomIds: string[];
  occupiedHead: number;
  sucklingHead: number;
  capacityHead: number;
  pensByStatus: Record<PenStatus, number>;
};

/** An animal the farm has nowhere to put. Never a silent state; see conflicts. */
export type UnhousedOccupant = {
  animalId: string;
  housingType: HousingType;
};

export type PhysicalFarmState = {
  day: number;
  buildings: Record<string, BuildingHousingState>;
  rooms: Record<string, RoomHousingState>;
  pens: Record<string, PenHousingState>;
  entityLocations: Record<string, PhysicalLocation>;
  /** Animals with a housing requirement and no pen that could take them. */
  unhoused: UnhousedOccupant[];
};

export function zeroPenCounts(): Record<PenStatus, number> {
  return {
    NOT_COMMISSIONED: 0,
    AVAILABLE: 0,
    OCCUPIED: 0,
    RESERVED: 0,
    CLEANING: 0,
    OUT_OF_SERVICE: 0,
  };
}

/**
 * Rooms and buildings worked out from the pens under them.
 *
 * Called with the pens already settled for the day, and never the other way
 * round: nothing above a pen is ever written to directly.
 */
export function deriveFromPens(
  plan: PhysicalFarmPlan,
  pens: Record<string, PenHousingState>,
): { rooms: Record<string, RoomHousingState>; buildings: Record<string, BuildingHousingState> } {
  const rooms: Record<string, RoomHousingState> = {};
  const buildings: Record<string, BuildingHousingState> = {};

  for (const building of plan.buildings) {
    const buildingState: BuildingHousingState = {
      buildingId: building.id,
      name: building.name,
      commissioned: false,
      roomIds: [],
      occupiedHead: 0,
      sucklingHead: 0,
      capacityHead: 0,
      pensByStatus: zeroPenCounts(),
    };
    for (const room of building.rooms) {
      const roomState: RoomHousingState = {
        roomId: room.id,
        buildingId: building.id,
        name: room.name,
        housingType: room.housingType,
        commissioned: false,
        penIds: [],
        occupiedHead: 0,
        sucklingHead: 0,
        capacityHead: 0,
        pensByStatus: zeroPenCounts(),
      };
      for (const pen of room.pens) {
        const state = pens[pen.id];
        if (!state) continue;
        roomState.penIds.push(pen.id);
        roomState.occupiedHead += state.occupiedHead;
        roomState.sucklingHead += state.sucklingHead;
        roomState.capacityHead += state.maxHead;
        roomState.pensByStatus[state.status] += 1;
        if (state.status !== "NOT_COMMISSIONED") roomState.commissioned = true;
      }
      rooms[room.id] = roomState;
      buildingState.roomIds.push(room.id);
      buildingState.occupiedHead += roomState.occupiedHead;
      buildingState.sucklingHead += roomState.sucklingHead;
      buildingState.capacityHead += roomState.capacityHead;
      for (const status of Object.keys(roomState.pensByStatus) as PenStatus[]) {
        buildingState.pensByStatus[status] += roomState.pensByStatus[status];
      }
      if (roomState.commissioned) buildingState.commissioned = true;
    }
    buildings[building.id] = buildingState;
  }

  return { rooms, buildings };
}

/** An empty farm on a given day: every pen as the plan has it and nobody in it. */
export function emptyFarmState(plan: PhysicalFarmPlan, day: number): PhysicalFarmState {
  const pens: Record<string, PenHousingState> = {};
  for (const building of plan.buildings) {
    for (const room of building.rooms) {
      for (const pen of room.pens) {
        pens[pen.id] = {
          penId: pen.id,
          roomId: room.id,
          buildingId: building.id,
          name: pen.name,
          housingType: pen.housingType,
          status: day >= pen.commissionedDay ? "AVAILABLE" : "NOT_COMMISSIONED",
          occupants: [],
          occupiedHead: 0,
          sucklingHead: 0,
          maxHead: pen.maxHead,
        };
      }
    }
  }
  const { rooms, buildings } = deriveFromPens(plan, pens);
  return { day, buildings, rooms, pens, entityLocations: {}, unhoused: [] };
}
