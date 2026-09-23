import type { PlannerConfig } from "../config";
import type { PigStage } from "../sim/animals";
import { planTotals } from "../housing/physical/model";

/**
 * Housing as a resource rather than a read-out.
 *
 * The farm has four kinds of room and a fixed number of places in each. A batch
 * that has outgrown its room cannot simply appear in the next one: it has to be
 * given a place, and when there is none it stays where it is. That is the whole
 * of the mechanism, and everything the farm feels from it follows on — the room
 * it stayed in is now over its places, the pigs in it grow more slowly and die a
 * little more often, they reach sale weight later, and the room behind that one
 * fills up in its turn.
 *
 * Gilts and the breeding herd are not housed here. They live in breeding
 * accommodation, which this model bounds by sow places rather than by floor
 * area, so a selected gilt leaving the finishing house frees a place and takes
 * none.
 */
export type RoomId = "farrowing" | "weaner" | "grower" | "finisher";

export const ROOM_IDS: readonly RoomId[] = ["farrowing", "weaner", "grower", "finisher"];

export const ROOM_LABELS: Record<RoomId, string> = {
  farrowing: "Farrowing house",
  weaner: "Weaner house",
  grower: "Grower house",
  finisher: "Finisher house",
};

/** What each room's places are counted in, which is not the same unit in each. */
export const ROOM_UNITS: Record<RoomId, string> = {
  farrowing: "crates",
  weaner: "places",
  grower: "places",
  finisher: "places",
};

/**
 * Where a growing pig of this stage is housed. A suckler is in its dam's crate
 * rather than a place of its own, so the farrowing house is counted in sows and
 * `farrowing` is returned here only to say which room the piglet is standing in.
 * A selected gilt has left the growing houses for breeding accommodation.
 */
export function roomForStage(stage: PigStage): RoomId | null {
  switch (stage) {
    case "piglet":
      return "farrowing";
    case "weaner":
      return "weaner";
    case "grower":
      return "grower";
    case "finisher":
      return "finisher";
    case "gilt":
      return null;
  }
}

/**
 * The places each room has, from the physical housing where there is any.
 *
 * One source of truth, and this is where the two of them are reconciled. A plan
 * that has been through the housing generator has actual pens with actual head
 * capacities, and those are what the farm is run against; the aggregate places
 * typed into the old panel are what a plan has until then. Nothing adds the two
 * together and nothing prefers the typed figure to the built one — a farm with
 * eleven farrowing pens has eleven farrowing places whatever the old box says.
 *
 * Design capacity is used rather than capacity commissioned so far, because
 * these places are a proxy for stocking pressure and not a gate on movement:
 * housing does not yet reschedule the biology, and phasing a room in mid-run
 * would change how fast pigs grow rather than when they move. That is the next
 * phase, deliberately.
 */
export function placesOf(config: PlannerConfig): Record<RoomId, number> {
  const physical = config.housing.physical;
  if (physical !== undefined && physical.buildings.length > 0) {
    const capacity = planTotals(physical).headCapacityByType;
    return {
      farrowing: Math.max(1, capacity.farrowing ?? 0),
      weaner: Math.max(1, capacity.weaner ?? 0),
      grower: Math.max(1, capacity.grower ?? 0),
      finisher: Math.max(1, capacity.finisher ?? 0),
    };
  }
  return {
    farrowing: config.housing.farrowingPlaces,
    weaner: config.housing.weanerPlaces,
    grower: config.housing.growerPlaces,
    finisher: config.housing.finisherPlaces,
  };
}

function zeroRooms(): Record<RoomId, number> {
  return { farrowing: 0, weaner: 0, grower: 0, finisher: 0 };
}

/** The floor a crowding penalty will not take daily gain below. */
const MIN_GAIN_FACTOR = 0.2;

/** One room as the farm would find it if it walked through: how full, how hard. */
export type RoomLevel = {
  id: RoomId;
  label: string;
  unit: string;
  places: number;
  occupants: number;
  /** Occupants over places. 1 is full; above it the room is carrying an overflow. */
  stockingRatio: number;
  /** The most it has ever held, and the day it held it. */
  peakOccupants: number;
  peakDay: number | null;
  /** Share of the plan so far the room has spent full or over. */
  utilisation: number;
  /** Animal-days the room has stood over its places since the plan opened. */
  overCapacityDays: number;
  /** Movements refused for want of a place in this room, and the days they cost. */
  movementsBlocked: number;
  blockedAnimalDays: number;
  /** The first day this room was the one that stopped a movement, if it has been. */
  firstLimitingDay: number | null;
};

/**
 * The places, who is standing in them, and what a room being over them does.
 *
 * Occupancy is taken afresh each morning from the herd itself rather than kept
 * up by hand through births, deaths, sales and promotions — one missed decrement
 * in any of those and the farm would be refusing movements into a room that was
 * actually empty. Moves granted during the day are then counted against that
 * census, so a room cannot let in more than it has places for in one morning.
 */
export class Housing {
  readonly places: Record<RoomId, number>;
  readonly enforced: boolean;
  private readonly gainPenalty: number;
  private readonly mortalityPenalty: number;

  /** Head standing in each room today, as counted this morning plus today's moves. */
  private occupants = zeroRooms();
  /** The stocking ratio as it stood this morning, which is what today is judged on. */
  private ratioToday = zeroRooms();

  readonly peakOccupants = zeroRooms();
  readonly peakDay: Record<RoomId, number | null> = {
    farrowing: null,
    weaner: null,
    grower: null,
    finisher: null,
  };
  readonly overCapacityDays = zeroRooms();
  readonly fullDays = zeroRooms();
  readonly occupiedDays = zeroRooms();
  readonly movementsBlocked = zeroRooms();
  readonly blockedAnimalDays = zeroRooms();
  readonly firstLimitingDay: Record<RoomId, number | null> = {
    farrowing: null,
    weaner: null,
    grower: null,
    finisher: null,
  };
  private daysRun = 0;

  constructor(config: PlannerConfig, enforced = config.housing.enforceCapacity) {
    this.places = placesOf(config);
    this.enforced = enforced;
    this.gainPenalty = config.housing.crowdingGainPenaltyPct / 100;
    this.mortalityPenalty = config.housing.crowdingMortalityPenaltyPct / 100;
  }

  /**
   * Opens the day: takes the census, books what the night cost in animal-days
   * over capacity, and fixes the stocking each room's pigs are judged on today.
   */
  openDay(day: number, occupants: Record<RoomId, number>): void {
    this.daysRun += 1;
    for (const room of ROOM_IDS) {
      const head = occupants[room];
      this.occupants[room] = head;
      const places = Math.max(this.places[room], 1);
      this.ratioToday[room] = head / places;
      this.occupiedDays[room] += head;
      if (head > this.peakOccupants[room]) {
        this.peakOccupants[room] = head;
        this.peakDay[room] = day;
      }
      if (head >= places) this.fullDays[room] += 1;
      if (head > places) this.overCapacityDays[room] += head - places;
    }
  }

  /** Head standing in a room right now, this morning's census plus today's moves. */
  occupancy(room: RoomId): number {
    return this.occupants[room];
  }

  /** Places still free in a room right now; negative when it is carrying an overflow. */
  freePlaces(room: RoomId): number {
    return this.places[room] - this.occupants[room];
  }

  /**
   * Asks a room for a place. Granted, the mover is counted into it at once so
   * the next request today sees the room as it now is. Refused, the room is
   * recorded as the one that stopped the movement.
   *
   * With capacity not enforced every request is granted, which is the behaviour
   * the model had before housing was simulated at all.
   */
  request(room: RoomId | null, day: number): boolean {
    if (room === null) return true;
    if (!this.enforced || this.occupants[room] < this.places[room]) {
      this.occupants[room] += 1;
      return true;
    }
    if (this.firstLimitingDay[room] === null) this.firstLimitingDay[room] = day;
    return false;
  }

  /**
   * Asks a room for places for a whole batch, and grants as many as it has.
   *
   * The answer is a number rather than yes or no because that is the decision a
   * stockman actually faces: a pen of thirty with room for eleven sends eleven,
   * and the batch is split rather than either all of it going or none of it. All
   * or nothing deadlocks — a batch bigger than the room it is headed for would
   * wait for a place that can never exist — and one pig at a time is not a
   * movement anybody made.
   */
  requestMany(room: RoomId | null, wanted: number, day: number): number {
    if (room === null || wanted <= 0) return Math.max(0, wanted);
    if (!this.enforced) {
      this.occupants[room] += wanted;
      return wanted;
    }
    const granted = Math.min(wanted, Math.max(0, this.places[room] - this.occupants[room]));
    this.occupants[room] += granted;
    if (granted < wanted && this.firstLimitingDay[room] === null) {
      this.firstLimitingDay[room] = day;
    }
    return granted;
  }

  /**
   * Puts head into a room whether or not there is a place for it. Some
   * movements cannot be refused: a sow weans when her litter's days are up and
   * the weaners have to go somewhere, and a sow farrowing into a full house
   * still farrows. The room carries the overflow, and pays for it in gain and in
   * losses like any other overcrowded room.
   */
  admit(room: RoomId | null, head = 1): void {
    if (room === null) return;
    this.occupants[room] += head;
  }

  /** A movement refused for the first time, as against a batch still waiting. */
  noteBlocked(room: RoomId | null): void {
    if (room === null) return;
    this.movementsBlocked[room] += 1;
  }

  /** Gives a place back: the animal left the room by dying, being sold or moving on. */
  release(room: RoomId | null): void {
    if (room === null) return;
    this.occupants[room] = Math.max(0, this.occupants[room] - 1);
  }

  /** Another day a batch spent waiting for somewhere to go. */
  noteHeld(room: RoomId | null): void {
    if (room === null) return;
    this.blockedAnimalDays[room] += 1;
  }

  /**
   * How far past its places a room stood this morning. 0 when it is not full —
   * and 0 throughout when capacity is not being enforced, because a farm whose
   * places are a note on a dashboard does not have crowded pens either. Without
   * that guard the default plan, whose rooms are comfortably over their nominal
   * places, would quietly lose gain to a subsystem it had not switched on.
   */
  excess(room: RoomId | null): number {
    if (room === null || !this.enforced) return 0;
    return Math.max(0, this.ratioToday[room] - 1);
  }

  /**
   * What crowding does to a day's gain in this room. A room a fifth over its
   * places loses a fifth of the configured penalty; one at double stocking loses
   * all of it. Nothing is taken off a room inside its places.
   */
  gainFactor(room: RoomId | null): number {
    const excess = this.excess(room);
    if (excess <= 0) return 1;
    return Math.max(MIN_GAIN_FACTOR, 1 - this.gainPenalty * excess);
  }

  /**
   * What crowding does to the risk its occupants carry, as a multiple of the
   * stage's own rate. 1 in a room within its places; 2 at double stocking on the
   * default penalty, which is the ordinary observation that crowded pens are
   * where the enteric and respiratory losses land.
   */
  mortalityFactor(room: RoomId | null): number {
    const excess = this.excess(room);
    if (excess <= 0) return 1;
    return 1 + this.mortalityPenalty * excess;
  }

  /** Whether any room is standing over its places this morning. */
  get underPressure(): boolean {
    return ROOM_IDS.some((room) => this.excess(room) > 0);
  }

  /** Every room as it stands, for the housing panel and the plan's warnings. */
  report(): RoomLevel[] {
    const days = Math.max(this.daysRun, 1);
    return ROOM_IDS.map((room) => {
      const places = Math.max(this.places[room], 1);
      return {
        id: room,
        label: ROOM_LABELS[room],
        unit: ROOM_UNITS[room],
        places: this.places[room],
        occupants: this.occupants[room],
        stockingRatio: this.occupants[room] / places,
        peakOccupants: this.peakOccupants[room],
        peakDay: this.peakDay[room],
        utilisation: this.occupiedDays[room] / (places * days),
        overCapacityDays: this.overCapacityDays[room],
        movementsBlocked: this.movementsBlocked[room],
        blockedAnimalDays: this.blockedAnimalDays[room],
        firstLimitingDay: this.firstLimitingDay[room],
      };
    });
  }
}
