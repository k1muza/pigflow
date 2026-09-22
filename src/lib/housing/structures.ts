import {
  aspectRatioOf,
  buildingRectangle,
  doubleRowRoom,
  rectangleFor,
  singleRowRoom,
  type Rectangle,
} from "./geometry";
import {
  BUILDING_LABELS,
  BUILDING_MEMBERS,
  BUILDING_OF,
  penAreaOf,
  type BuildingType,
  type HousingPolicy,
  type HousingType,
  type RoomLayout,
  type StageExitWeights,
} from "./rules";

/**
 * Pens into rooms, and rooms into buildings.
 *
 * Once the allocator has said how many pens have to exist, what is left is a
 * packing problem with no biology in it at all, which is exactly why it is done
 * last and kept here. A room is a rectangle of identical pens off one passage; a
 * building is a run of rooms. Nothing is optimised beyond a score anybody can
 * read, and nothing curves, steps or wraps — a plan that proposed an L-shaped
 * weaner house would be proposing something this model has no business having an
 * opinion about.
 */

export type PenGeometry = {
  housingType: HousingType;
  /** Head one pen holds. */
  capacityHead: number;
  /** The floor the animals in it must have, before the box is squared off. */
  requiredAreaM2: number;
  rectangle: Rectangle;
};

/**
 * The box one pen of a housing type is built as.
 *
 * The constraints that come off the manual rather than off arithmetic are
 * applied here: a farrowing pen's width and length are given directly, and a
 * boar pen used for service has both a floor area and a shortest side.
 */
export function penGeometryFor(
  policy: HousingPolicy,
  type: HousingType,
  weights: StageExitWeights,
  capacityHead: number,
): PenGeometry | null {
  const requiredAreaM2 = penAreaOf(policy, type, weights);
  const preferredAspectRatio = policy.structure.preferredPenAspectRatio;

  const rectangle = (() => {
    if (type === "farrowing") {
      return rectangleFor({
        requiredAreaM2,
        preferredAspectRatio,
        minWidthM: policy.farrowing.penMinWidthM,
        maxWidthM: policy.farrowing.penMaxWidthM,
        minLengthM: policy.farrowing.penMinLengthM,
        maxLengthM: policy.farrowing.penMaxLengthM,
      });
    }
    if (type === "boar") {
      return rectangleFor({
        requiredAreaM2,
        preferredAspectRatio,
        minShortSideM: policy.boar.penUsedForService
          ? policy.boar.serviceMinShortSideM
          : undefined,
      });
    }
    if (type === "service_sow") {
      return rectangleFor({
        requiredAreaM2,
        preferredAspectRatio,
        minLengthM: policy.serviceSow.minLengthM,
      });
    }
    return rectangleFor({ requiredAreaM2, preferredAspectRatio });
  })();

  if (rectangle === null) return null;
  return { housingType: type, capacityHead, requiredAreaM2, rectangle };
}

export type RoomPlan = {
  layout: RoomLayout;
  pensPerRoom: number;
  roomCount: number;
  rectangle: Rectangle;
  /** Pens the rooms actually provide, which is never fewer than were asked for. */
  totalPens: number;
  sparePens: number;
  aspectRatio: number;
  score: number;
  /** Whether the shape had to be accepted over the preferred limit. */
  overPreferredAspectRatio: boolean;
};

/** A spare pen is expensive; a room is not free; an awkward room is a nuisance. */
const SPARE_PEN_WEIGHT = 100;
const ROOM_WEIGHT = 5;
const ASPECT_PENALTY = 25;
/** Enough to settle a tie towards the squarer room and never enough to lead. */
const ASPECT_TIE_BREAK = 0.1;

function roomRectangle(
  pen: Rectangle,
  layout: RoomLayout,
  pensPerRoom: number,
  passageM: number,
): Rectangle {
  return layout === "single_row"
    ? singleRowRoom(pen, pensPerRoom, passageM)
    : doubleRowRoom(pen, pensPerRoom, passageM);
}

/**
 * Every room this many pens could be laid out in, scored.
 *
 * The scoring is deliberately not "fewest rooms". Two pens to a room comes out
 * with no pens spare and fifteen rooms to build and manage; six to a room comes
 * out with five rooms and, on the right pen count, also nothing spare. Paying
 * for pens nobody fills is the expensive mistake, so that dominates; the number
 * of rooms is a real cost and counts for something; and a room far off the shape
 * a shed is built in is penalised rather than forbidden, so a plan that has no
 * neat answer still gets an answer with a note on it.
 */
export function roomCandidates(
  pen: Rectangle,
  recommendedPens: number,
  policy: HousingPolicy,
): RoomPlan[] {
  if (recommendedPens <= 0) return [];
  const { pensPerRoomOptions, centralPassageWidthM, preferredRoomMaxAspectRatio } =
    policy.structure;
  const candidates: RoomPlan[] = [];

  for (const pensPerRoom of [...pensPerRoomOptions].sort((a, b) => a - b)) {
    if (pensPerRoom <= 0) continue;
    for (const layout of policy.structure.layouts) {
      // Two rows means two rows: an odd pen count would leave a gap in one of
      // them, which is not a room anybody sets out.
      if (layout === "double_row_central_passage" && pensPerRoom % 2 !== 0) continue;
      const rectangle = roomRectangle(pen, layout, pensPerRoom, centralPassageWidthM);
      const roomCount = Math.ceil(recommendedPens / pensPerRoom);
      const totalPens = roomCount * pensPerRoom;
      const sparePens = totalPens - recommendedPens;
      const aspectRatio = aspectRatioOf(rectangle.widthM, rectangle.lengthM);
      const over = aspectRatio > preferredRoomMaxAspectRatio + 1e-9;
      candidates.push({
        layout,
        pensPerRoom,
        roomCount,
        rectangle,
        totalPens,
        sparePens,
        aspectRatio,
        overPreferredAspectRatio: over,
        score:
          sparePens * SPARE_PEN_WEIGHT +
          roomCount * ROOM_WEIGHT +
          (over ? (aspectRatio - preferredRoomMaxAspectRatio) * ASPECT_PENALTY : 0) +
          aspectRatio * ASPECT_TIE_BREAK,
      });
    }
  }
  return candidates;
}

/**
 * The room template a housing type is built to.
 *
 * Rooms inside the preferred proportions are chosen from first, and only if none
 * of them is feasible is a long thin room accepted — which is the difference
 * between a limit and a preference, and is why it is reported when it happens.
 */
export function chooseRoom(
  pen: Rectangle,
  recommendedPens: number,
  policy: HousingPolicy,
): RoomPlan | null {
  const candidates = roomCandidates(pen, recommendedPens, policy);
  if (candidates.length === 0) return null;
  const within = candidates.filter((candidate) => !candidate.overPreferredAspectRatio);
  const pool = within.length > 0 ? within : candidates;
  return pool.reduce((best, candidate) => (candidate.score < best.score ? candidate : best));
}

/** One housing type's rooms, as a building is told about them. */
export type BuildingSection = {
  housingType: HousingType;
  layout: RoomLayout;
  roomCount: number;
  pensPerRoom: number;
  penCount: number;
  headCapacity: number;
  room: Rectangle;
};

export type HousingBuilding = {
  id: string;
  buildingType: BuildingType;
  /** "Finisher House", or "Finisher House A" when there is more than one. */
  label: string;
  sections: BuildingSection[];
  roomCount: number;
  penCount: number;
  headCapacity: number;
  /** The footprint the site has to reserve. */
  rectangle: Rectangle;
  /** The rooms' own floor, so the gap between them and the footprint is visible. */
  roomAreaM2: number;
};

/** What one housing type contributes to the buildings it shares. */
export type TypeStructure = {
  housingType: HousingType;
  layout: RoomLayout;
  roomCount: number;
  pensPerRoom: number;
  penCapacityHead: number;
  room: Rectangle;
};

const HOUSE_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function houseLabel(type: BuildingType, index: number, total: number): string {
  const name = BUILDING_LABELS[type];
  if (total <= 1) return name;
  const letter = HOUSE_LETTERS[index] ?? String(index + 1);
  return name + " " + letter;
}

/**
 * Rooms into buildings, as evenly as they will go.
 *
 * Ten rooms with a limit of six to a building is two buildings of five, not one
 * of six and one of four. Nothing is gained by filling the first shed to the
 * brim, and a pair of matching houses is easier to build, staff and extend than
 * a big one and a small one.
 *
 * A building holds rooms of one primary kind. The one exception is the breeding
 * and service house, which takes the boar pens, the service places and the gilt
 * pens together, because that is one room of the farm in every sense but the
 * architectural one.
 */
export function buildingsFor(
  structures: readonly TypeStructure[],
  policy: HousingPolicy,
): HousingBuilding[] {
  const byBuilding = new Map<BuildingType, TypeStructure[]>();
  for (const structure of structures) {
    if (structure.roomCount <= 0) continue;
    const building = BUILDING_OF[structure.housingType];
    const group = byBuilding.get(building);
    if (group) group.push(structure);
    else byBuilding.set(building, [structure]);
  }

  const buildings: HousingBuilding[] = [];
  for (const buildingType of Object.keys(BUILDING_MEMBERS) as BuildingType[]) {
    const group = byBuilding.get(buildingType);
    if (!group || group.length === 0) continue;
    // In the order the members are declared, so a plan reads the same twice.
    const order = BUILDING_MEMBERS[buildingType];
    group.sort((a, b) => order.indexOf(a.housingType) - order.indexOf(b.housingType));

    const totalRooms = group.reduce((total, structure) => total + structure.roomCount, 0);
    const perBuilding = Math.max(1, policy.structure.maxRoomsPerBuilding);
    const buildingCount = Math.max(1, Math.ceil(totalRooms / perBuilding));
    const base = Math.floor(totalRooms / buildingCount);
    const extra = totalRooms % buildingCount;

    // The rooms of the group, one entry a room, in declared order.
    const queue: TypeStructure[] = [];
    for (const structure of group) {
      for (let room = 0; room < structure.roomCount; room += 1) queue.push(structure);
    }

    let cursor = 0;
    for (let index = 0; index < buildingCount; index += 1) {
      const rooms = base + (index < extra ? 1 : 0);
      const mine = queue.slice(cursor, cursor + rooms);
      cursor += rooms;
      buildings.push(assemble(buildingType, index, buildingCount, mine));
    }
  }
  return buildings;
}

function assemble(
  buildingType: BuildingType,
  index: number,
  total: number,
  rooms: readonly TypeStructure[],
): HousingBuilding {
  const sections: BuildingSection[] = [];
  for (const structure of rooms) {
    const last = sections[sections.length - 1];
    if (last && last.housingType === structure.housingType) {
      last.roomCount += 1;
      last.penCount += structure.pensPerRoom;
      last.headCapacity += structure.pensPerRoom * structure.penCapacityHead;
      continue;
    }
    sections.push({
      housingType: structure.housingType,
      layout: structure.layout,
      roomCount: 1,
      pensPerRoom: structure.pensPerRoom,
      penCount: structure.pensPerRoom,
      headCapacity: structure.pensPerRoom * structure.penCapacityHead,
      room: structure.room,
    });
  }

  const rectangle = buildingRectangle(rooms.map((structure) => structure.room));
  // Four places, like every other area here. Rounded to two, a building of nine
  // rooms at 14.625 m² reads as holding 131.63 m² of rooms inside a 131.625 m²
  // footprint, which is a plan disagreeing with itself over a rounding rule.
  const roomAreaM2 =
    Math.round(rooms.reduce((total, structure) => total + structure.room.areaM2, 0) * 10_000) /
    10_000;

  return {
    id: buildingType + "-" + (index + 1),
    buildingType,
    label: houseLabel(buildingType, index, total),
    sections,
    roomCount: rooms.length,
    penCount: sections.reduce((count, section) => count + section.penCount, 0),
    headCapacity: sections.reduce((head, section) => head + section.headCapacity, 0),
    rectangle,
    roomAreaM2,
  };
}
