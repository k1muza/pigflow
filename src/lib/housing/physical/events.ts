import { HOUSING_LABELS, type HousingType } from "../rules";
import type { FarmPeriodEvent, PigStage } from "../../sim";
import type {
  HousingConflict,
  HousingMovementEvent,
  MovementReason,
  PenStatusEvent,
  RoomCommissionedEvent,
} from "./history";
import { allPens, type PhysicalFarmPlan } from "./model";
import type { HousingSimulationResult } from "./result";

/**
 * What the housing did, in the words a day's work list is written in.
 *
 * The movement records are the farm's own account of itself and they are written
 * for a machine: one line an occupant, with pen ids on both ends. A person
 * reading a Tuesday does not want thirty of those, they want "move 21 head into
 * the weaner house" — so this is the roll-up, and it is deliberately the same
 * shape as every other thing the calendar says happened on a day.
 *
 * Asked over a range rather than a day, because a month of the timeline is the
 * same question asked of thirty days and the answer has to be one line rather
 * than thirty. Nothing here is stored: the lines are folded out of the record
 * when a timeline is built, the same way every other day's activities are.
 */

/**
 * One line of what the housing did. Shaped to drop straight into the calendar's
 * own event list — see `FarmPeriodEvent` — so a housing line and a farrowing
 * line are read, marked and counted the same way.
 */
export type HousingPeriodEvent = {
  type: "housing" | "housing-pens" | "housing-shortage";
  label: string;
  count: number;
  /**
   * Plain lines this one says better, by their own key.
   *
   * "3 weaners become growers" and "move 3 head into the grower house,
   * GROW-01-R01: P02" are the same fact, and only one of them says which pen.
   * So the housing line carries the name of the line it supersedes, and
   * whatever merges the two drops it — rather than the merge holding a list of
   * what looks like what, which is a list that goes out of date silently.
   */
  replaces?: readonly ("moved-to-grower" | "moved-to-finisher")[];
};

/** The house an occupant is moving into, as a sentence names it. */
const HOUSE_PHRASE: Record<HousingType, string> = {
  boar: "the boar pens",
  service_sow: "the service house",
  gestation: "the gestation house",
  farrowing: "the farrowing house",
  gilt: "the gilt pens",
  weaner: "the weaner house",
  grower: "the grower house",
  finisher: "the finisher house",
};

/**
 * The verb a move is done under.
 *
 * A move has a cause, and the cause is what a stockperson would call it by: a
 * sow is not "moved" a week before she is due, she is set down to farrow.
 */
const VERB: Record<MovementReason, string> = {
  INITIAL_PLACEMENT: "House",
  SERVICE: "Move",
  GESTATION: "Move",
  PRE_FARROW: "Move",
  WEANING: "Move",
  STAGE_TRANSITION: "Move",
  SALE: "Take out",
  CULL: "Take out",
  MORTALITY: "Take out",
  MANUAL: "Move",
};

/** How the line ends, where the reason is worth saying out loud. */
const BECAUSE: Partial<Record<MovementReason, string>> = {
  PRE_FARROW: " to farrow",
  WEANING: " at weaning",
  SERVICE: " to be served",
};

function head(count: number): string {
  return count === 1 ? "1 head" : `${count} head`;
}

/** The plain line a move into this house says better than the farm's own does. */
const SUPERSEDES: Partial<Record<HousingType, HousingPeriodEvent["replaces"]>> = {
  grower: ["moved-to-grower"],
  finisher: ["moved-to-finisher"],
};

/** The most pens a line names before it stops naming them and counts them. */
const PENS_NAMED = 6;

/** The most animals and batches a line names before it counts the rest. */
const OCCUPANTS_NAMED = 4;

/**
 * Who moved, by name.
 *
 * A farm knows its animals by the number on the ear and its growing pigs by the
 * batch they came up in, so that is what a work list says: "set down SOW-014",
 * not "set down 1 head". A batch carries the head that moved with it, because a
 * batch is a number of pigs and the name alone does not say how many.
 */
function occupantsPhrase(occupants: ReadonlyMap<string, { head: number; named: boolean }>): string {
  const written: string[] = [];
  let extraHead = 0;
  for (const [name, entry] of occupants) {
    if (written.length >= OCCUPANTS_NAMED) {
      extraHead += entry.head;
      continue;
    }
    // A sow is herself; a batch is a number of pigs travelling under one name.
    written.push(entry.named ? name : `${name} (${plural(entry.head, "pig")})`);
  }
  if (written.length === 0) return "";
  return written.join(", ") + (extraHead > 0 ? ` and ${head(extraHead)} more` : "");
}

function plural(count: number, noun: string): string {
  return count === 1 ? `1 ${noun}` : `${count} ${noun}s`;
}

/** A pen's own number within its room: the "P02" of "GROW-01-R01-P02". */
function penSuffix(roomId: string, penId: string): string {
  return penId.startsWith(roomId + "-") ? penId.slice(roomId.length + 1) : penId;
}

/**
 * Which pens, named, grouped by the room they are in.
 *
 * "GROW-01-R01: P01, P02 · GROW-01-R02: P01" rather than three pen ids written
 * out in full, because the room is the thing a person walks to and the pen is
 * the gate they stop at once they are in it.
 */
function pensPhrase(places: readonly { roomId: string; penId: string }[]): string {
  const rooms = new Map<string, string[]>();
  let named = 0;
  let extra = 0;
  const seen = new Set<string>();
  for (const place of places) {
    if (seen.has(place.penId)) continue;
    seen.add(place.penId);
    if (named >= PENS_NAMED) {
      extra += 1;
      continue;
    }
    named += 1;
    const pens = rooms.get(place.roomId);
    if (pens) pens.push(penSuffix(place.roomId, place.penId));
    else rooms.set(place.roomId, [penSuffix(place.roomId, place.penId)]);
  }
  if (rooms.size === 0) return "";
  const written = [...rooms].map(([room, pens]) => `${room}: ${pens.join(", ")}`).join(" · ");
  return " · " + written + (extra > 0 ? ` and ${extra} more` : "");
}

// ------------------------------------------------- where the work happens

/**
 * The house a plain activity line is about, where the housing can say.
 *
 * The farm's own lines count what was done and do not say who it was done to —
 * "service 1 sow" names no sow — so the pen cannot be known from them. The
 * house can: a sow is served in the service house, scanned in the gestation
 * house and farrows in the farrowing house, whichever sow she is. That is the
 * honest answer to "where do I go for this", and it is as far as a count can be
 * taken.
 *
 * The lines left out are left out because they have no single house. A cull can
 * take a sow out of any of three, a loss can happen anywhere, and a line that
 * guessed would be worse than a line that says nothing.
 */
const WORK_HOUSE: Partial<Record<FarmPeriodEvent["type"], HousingType>> = {
  service: "service_sow",
  scan: "gestation",
  conception: "gestation",
  farrowing: "farrowing",
  weaning: "farrowing",
  sale: "finisher",
};

/** Where an animal of this kind stands, for the lines that name a kind. */
const STAGE_HOUSE: Record<PigStage, HousingType> = {
  piglet: "farrowing",
  weaner: "weaner",
  grower: "grower",
  finisher: "finisher",
  gilt: "gilt",
};

/** The most buildings a line names before the house alone has to do. */
const BUILDINGS_NAMED = 3;

/**
 * Where the work on this line is done, as a clause to put on the end of it.
 *
 * Empty when the farm has no such house — a plan with no gilt pens is not told
 * its gilts are in them — and empty for the lines that have no one house.
 */
export function workplaceClause(
  event: Pick<FarmPeriodEvent, "type" | "stage">,
  plan: PhysicalFarmPlan,
  day: number,
  withBuildings: boolean,
): string {
  const house = event.stage !== undefined ? STAGE_HOUSE[event.stage] : WORK_HOUSE[event.type];
  if (house === undefined) return "";

  // The building and not the room: a room of that house is where the animals
  // this work is about happen to be standing, and a count of jobs does not know
  // which room that is. The building is where the house is, whoever is in it —
  // and it is the thing a person walks to. Rooms not built yet are not where
  // anybody is working this morning.
  const standing: string[] = [];
  for (const building of plan.buildings) {
    const has = building.rooms.some(
      (room) => room.housingType === house && room.commissionedDay <= day,
    );
    if (has) standing.push(building.id);
  }
  if (standing.length === 0) return "";
  const named =
    withBuildings && standing.length <= BUILDINGS_NAMED ? ` (${standing.join(", ")})` : "";
  return ` · in ${HOUSE_PHRASE[house]}${named}`;
}

/** What one stretch of the record comes to, once it has been cut out of it. */
type Slice = {
  movements: readonly HousingMovementEvent[];
  commissionings: readonly RoomCommissionedEvent[];
  statusChanges: readonly PenStatusEvent[];
  conflicts: readonly HousingConflict[];
};

/**
 * The lines one slice of the record comes to.
 *
 * Departures are left out on purpose. A pig leaving its pen for the lorry is
 * already on the day as a sale, and one leaving it for the knacker is already on
 * it as a loss; saying it twice in different words would make a quiet day look
 * busy and tell a reader nothing they did not have.
 */
function linesOf(
  slice: Slice,
  types: ReadonlyMap<string, HousingType>,
  rooms: ReadonlyMap<string, string>,
  /**
   * Whether to name the pens.
   *
   * A day names them, because "which pen" is the question a day is opened to
   * answer. A month does not: thirty days of weaner pens is a paragraph of pen
   * ids in place of a line, and nobody reads a month to find a gate.
   */
  withPens: boolean,
  /** Whether this stretch includes the morning the farm opened. */
  opening: boolean,
): HousingPeriodEvent[] {
  const events: HousingPeriodEvent[] = [];

  type Move = {
    count: number;
    places: { roomId: string; penId: string }[];
    /** Who moved, in the order they moved, with a batch counted once. */
    occupants: Map<string, { head: number; named: boolean }>;
  };
  const moves = new Map<string, Move>();
  for (const movement of slice.movements) {
    // Nowhere to go is a shortage, and the conflict says so in its own words.
    if (!movement.to) continue;
    const to = types.get(movement.to.penId) ?? movement.housingType;
    const key = movement.reason + "|" + to;
    const occupant = movement.occupant;
    const named = occupant.type === "animal";
    const who = occupant.type === "animal" ? occupant.animalId : occupant.cohortId;
    const count = occupant.type === "animal" ? 1 : occupant.head;
    const entry: Move = moves.get(key) ?? { count: 0, places: [], occupants: new Map() };
    entry.count += count;
    entry.places.push(movement.to);
    // A batch split between two pens is one batch, so its head is added up
    // rather than written twice under the same name.
    const already = entry.occupants.get(who);
    if (already) already.head += count;
    else entry.occupants.set(who, { head: count, named });
    moves.set(key, entry);
  }
  for (const [key, entry] of moves) {
    const [reason, to] = key.split("|") as [MovementReason, HousingType];
    // Named on a day and counted over a month, for the same reason the pens
    // are: a month of names is a paragraph where a line was wanted.
    const who = withPens ? occupantsPhrase(entry.occupants) : head(entry.count);
    // The only group that appears in a farrowing pen from nowhere is a litter,
    // and it got there by being born. Not on the opening day, though: a plan
    // that starts with sows suckling starts with litters it did not farrow.
    const born = !opening && reason === "INITIAL_PLACEMENT" && to === "farrowing";
    const line: HousingPeriodEvent = {
      type: "housing",
      label:
        (born
          ? `${who} born into ${HOUSE_PHRASE[to]}`
          : `${VERB[reason]} ${who} into ${HOUSE_PHRASE[to]}` + (BECAUSE[reason] ?? "")) +
        (withPens ? pensPhrase(entry.places) : ""),
      count: entry.count,
    };
    // Only a move up a stage stands in for the farm's own line about it: a sow
    // set down to farrow is not what "3 weaners become growers" was saying.
    if (reason === "STAGE_TRANSITION" && SUPERSEDES[to]) line.replaces = SUPERSEDES[to];
    events.push(line);
  }

  // A phase is the unit building work happens in, so a phase is a line. Naming
  // each room separately turns the morning a farm opens — when every room it
  // starts with comes into use at once — into a column of near-identical lines
  // that says less than one line with the count on it.
  if (slice.commissionings.length === 1) {
    const only = slice.commissionings[0];
    events.push({
      type: "housing-pens",
      label:
        `Commission ${only.roomId} in ${HOUSE_PHRASE[only.housingType]} · ` +
        `${only.pens} pens, ${only.headCapacity} places`,
      count: only.pens,
    });
  } else if (slice.commissionings.length > 1) {
    const rooms = slice.commissionings.length;
    const pens = slice.commissionings.reduce((total, entry) => total + entry.pens, 0);
    const places = slice.commissionings.reduce((total, entry) => total + entry.headCapacity, 0);
    events.push({
      type: "housing-pens",
      label: `Commission ${rooms} rooms · ${pens} pens, ${places} places`,
      count: pens,
    });
  }

  const washed = new Map<HousingType, { roomId: string; penId: string }[]>();
  for (const change of slice.statusChanges) {
    if (change.status !== "CLEANING") continue;
    const type = types.get(change.penId);
    const roomId = rooms.get(change.penId);
    if (type === undefined || roomId === undefined) continue;
    const pens = washed.get(type);
    if (pens) pens.push({ roomId, penId: change.penId });
    else washed.set(type, [{ roomId, penId: change.penId }]);
  }
  for (const [type, pens] of washed) {
    events.push({
      type: "housing-pens",
      label:
        `Wash down ${pens.length} ${pens.length === 1 ? "pen" : "pens"} in ${HOUSE_PHRASE[type]}` +
        (withPens ? pensPhrase(pens) : ""),
      count: pens.length,
    });
  }

  const short = new Map<HousingType, { wanted: number; first?: string }>();
  for (const conflict of slice.conflicts) {
    const entry = short.get(conflict.housingType) ?? { wanted: 0, first: conflict.occupantId };
    entry.wanted += conflict.requiredHead;
    short.set(conflict.housingType, entry);
  }
  for (const [type, entry] of short) {
    // One animal turned away is named, because a name is what you would go and
    // look for. Forty are counted, because forty names is not a line.
    const who = entry.wanted === 1 && entry.first !== undefined ? entry.first : head(entry.wanted);
    events.push({
      type: "housing-shortage",
      label: `${who} wanted ${HOUSING_LABELS[type].toLowerCase()} and there were none free`,
      count: entry.wanted,
    });
  }

  // A fixed order, so the same day always reads the same way round.
  return events.sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
}

/**
 * Every pen's house and room, by id.
 *
 * A status record names a pen and nothing else, and a reader wants the house it
 * is in and the room they would walk to.
 */
function penIndex(plan: PhysicalFarmPlan): {
  types: Map<string, HousingType>;
  rooms: Map<string, string>;
} {
  const types = new Map<string, HousingType>();
  const rooms = new Map<string, string>();
  for (const pen of allPens(plan)) {
    types.set(pen.id, pen.housingType);
    rooms.set(pen.id, pen.roomId);
  }
  return { types, rooms };
}

function inRange<T extends { day: number }>(
  entries: readonly T[],
  fromDay: number,
  throughDay: number,
): T[] {
  return entries.filter((entry) => entry.day >= fromDay && entry.day <= throughDay);
}

/**
 * The housing's account of one stretch of days.
 *
 * Pens are named when the stretch is a single day and counted when it is a
 * month, because "which pen" is what a day is opened to find out and a month is
 * not read to find a gate.
 */
export function housingEventsFor(
  housing: HousingSimulationResult,
  fromDay: number,
  throughDay: number,
): HousingPeriodEvent[] {
  const { types, rooms } = penIndex(housing.plan);
  return linesOf(
    {
      movements: inRange(housing.movements, fromDay, throughDay),
      commissionings: inRange(housing.commissionings, fromDay, throughDay),
      statusChanges: inRange(housing.statusChanges, fromDay, throughDay),
      conflicts: inRange(housing.conflicts, fromDay, throughDay),
    },
    types,
    rooms,
    fromDay === throughDay,
    fromDay <= housing.firstDay,
  );
}

/**
 * The same, day by day, in one pass.
 *
 * Built this way rather than by asking the range question of every day in turn:
 * a five-year plan is eighteen hundred days, and eighteen hundred walks of the
 * whole movement record is the kind of arithmetic that makes a calendar feel
 * slow for no reason anybody can see.
 */
export function housingEventsByDay(
  housing: HousingSimulationResult,
): Map<number, HousingPeriodEvent[]> {
  const slices = new Map<number, Slice & { -readonly [K in keyof Slice]: Slice[K][number][] }>();
  const slice = (day: number) => {
    const existing = slices.get(day);
    if (existing) return existing;
    const fresh = { movements: [], commissionings: [], statusChanges: [], conflicts: [] };
    slices.set(day, fresh);
    return fresh;
  };

  for (const movement of housing.movements) slice(movement.day).movements.push(movement);
  for (const entry of housing.commissionings) slice(entry.day).commissionings.push(entry);
  for (const change of housing.statusChanges) slice(change.day).statusChanges.push(change);
  for (const conflict of housing.conflicts) slice(conflict.day).conflicts.push(conflict);

  const { types, rooms } = penIndex(housing.plan);
  const byDay = new Map<number, HousingPeriodEvent[]>();
  for (const [day, entries] of slices) {
    const events = linesOf(entries, types, rooms, true, day <= housing.firstDay);
    if (events.length > 0) byDay.set(day, events);
  }
  return byDay;
}
