import { HOUSING_LABELS, type HousingType } from "../rules";
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
  type: "housing" | "housing-shortage";
  label: string;
  count: number;
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
  PRE_FARROW: "Set down",
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
function linesOf(slice: Slice, types: ReadonlyMap<string, HousingType>): HousingPeriodEvent[] {
  const events: HousingPeriodEvent[] = [];

  const moves = new Map<string, number>();
  for (const movement of slice.movements) {
    // Nowhere to go is a shortage, and the conflict says so in its own words.
    if (!movement.to) continue;
    const to = types.get(movement.to.penId) ?? movement.housingType;
    const key = movement.reason + "|" + to;
    const count = movement.occupant.type === "animal" ? 1 : movement.occupant.head;
    moves.set(key, (moves.get(key) ?? 0) + count);
  }
  for (const [key, count] of moves) {
    const [reason, to] = key.split("|") as [MovementReason, HousingType];
    events.push({
      type: "housing",
      label: `${VERB[reason]} ${head(count)} into ${HOUSE_PHRASE[to]}` + (BECAUSE[reason] ?? ""),
      count,
    });
  }

  for (const commissioning of slice.commissionings) {
    events.push({
      type: "housing",
      label:
        `Commission ${commissioning.roomId} in ${HOUSE_PHRASE[commissioning.housingType]} · ` +
        `${commissioning.pens} pens, ${commissioning.headCapacity} places`,
      count: commissioning.pens,
    });
  }

  const washed = new Map<HousingType, number>();
  for (const change of slice.statusChanges) {
    if (change.status !== "CLEANING") continue;
    const type = types.get(change.penId);
    if (type === undefined) continue;
    washed.set(type, (washed.get(type) ?? 0) + 1);
  }
  for (const [type, pens] of washed) {
    events.push({
      type: "housing",
      label: `Wash down ${pens} ${pens === 1 ? "pen" : "pens"} in ${HOUSE_PHRASE[type]}`,
      count: pens,
    });
  }

  const short = new Map<HousingType, number>();
  for (const conflict of slice.conflicts) {
    short.set(conflict.housingType, (short.get(conflict.housingType) ?? 0) + conflict.requiredHead);
  }
  for (const [type, wanted] of short) {
    events.push({
      type: "housing-shortage",
      label: `${head(wanted)} wanted ${HOUSING_LABELS[type].toLowerCase()} and there were none free`,
      count: wanted,
    });
  }

  // A fixed order, so the same day always reads the same way round.
  return events.sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
}

/** Every pen's housing type, by id: a status record names a pen, not a house. */
function penTypes(plan: PhysicalFarmPlan): Map<string, HousingType> {
  return new Map(allPens(plan).map((pen) => [pen.id, pen.housingType]));
}

function inRange<T extends { day: number }>(
  entries: readonly T[],
  fromDay: number,
  throughDay: number,
): T[] {
  return entries.filter((entry) => entry.day >= fromDay && entry.day <= throughDay);
}

/** The housing's account of one stretch of days. */
export function housingEventsFor(
  housing: HousingSimulationResult,
  fromDay: number,
  throughDay: number,
): HousingPeriodEvent[] {
  return linesOf(
    {
      movements: inRange(housing.movements, fromDay, throughDay),
      commissionings: inRange(housing.commissionings, fromDay, throughDay),
      statusChanges: inRange(housing.statusChanges, fromDay, throughDay),
      conflicts: inRange(housing.conflicts, fromDay, throughDay),
    },
    penTypes(housing.plan),
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

  const types = penTypes(housing.plan);
  const byDay = new Map<number, HousingPeriodEvent[]>();
  for (const [day, entries] of slices) {
    const events = linesOf(entries, types);
    if (events.length > 0) byDay.set(day, events);
  }
  return byDay;
}
