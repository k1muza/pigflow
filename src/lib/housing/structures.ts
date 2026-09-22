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
  pensPerRoomChoices,
  type BuildingType,
  type HousingPolicy,
  type HousingType,
  type LayoutCostWeights,
  type RoomLayout,
  type StageExitWeights,
} from "./rules";

/**
 * Pens into rooms, and rooms into buildings.
 *
 * Once the allocator has said how many pens have to exist, what is left is a
 * packing problem with no biology in it at all, which is exactly why it is done
 * last and kept here. A room is a rectangle of identical pens off one passage; a
 * building is a run of rooms. Nothing curves, steps or wraps — a plan that
 * proposed an L-shaped weaner house would be proposing something this model has
 * no business having an opinion about.
 *
 * What it does have an opinion about is which of the rectangular arrangements to
 * build, and that opinion is arrived at by enumerating them and costing them
 * rather than by a rule of thumb. Every feasible module, layout, rotation,
 * ordering and grouping is generated, the ones that break a housing rule are
 * thrown out, and what survives is scored on what it would take to build. The
 * search stays small because only sensible agricultural templates are ever
 * proposed, and it stays checkable because it is a list rather than a solver.
 */

// -------------------------------------------------------------------- one pen

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
 * boar pen used for service has both a floor area and a shortest side. These are
 * hard: nothing downstream may trade one of them away for a cheaper building,
 * and where they cannot all be met at once this returns null rather than
 * rounding one of them off.
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

// ------------------------------------------------------------------ one room

/** The shape of a room layout, as the spec asks for it to be reported. */
export type RoomCandidate = {
  pensPerRoom: number;
  roomCount: number;
  totalPens: number;
  sparePens: number;
  roomWidthM: number;
  roomLengthM: number;
  roomAreaM2: number;
  totalRoomAreaM2: number;
};

export type RoomPlan = RoomCandidate & {
  layout: RoomLayout;
  /** The room as it is placed, which is the rotation of it that was chosen. */
  rectangle: Rectangle;
  /** Whether it is standing across the building rather than along it. */
  rotated: boolean;
  aspectRatio: number;
  /** Running metres of partition inside one room: pen divisions and passage walls. */
  partitionM: number;
  /** Whether the shape had to be accepted over the preferred limit. */
  overPreferredAspectRatio: boolean;
  /**
   * What this layout would come to if the house stood on its own, on the same
   * proxy the whole site is scored on. Used to shortlist, never to decide: a
   * room that is dear on its own can be the cheapest thing to stand next to its
   * neighbours, which is the entire point of doing this jointly.
   */
  estimatedCostM2: number;
  score: number;
};

/** What a room layout is limited by beyond the policy: the herd's own batch. */
export type RoomLimits = {
  /**
   * The most pens one intake ever filled, from the allocator. Zero where the
   * type is not run in batches at all, which lifts the ceiling rather than
   * dropping it to nothing.
   */
  batchPens?: number;
};

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
 * Running metres of partition in one room.
 *
 * The walls between one pen and the next, and the wall between the pen row and
 * the passage it comes off. A double row has two of the second sort, which is
 * part of why it is not simply cheaper than a single row despite sharing its
 * passage. Rotation does not touch this: turning a room round does not change
 * what is inside it.
 */
function partitionMetresOf(pen: Rectangle, layout: RoomLayout, pensPerRoom: number): number {
  if (layout === "single_row") {
    return (pensPerRoom - 1) * pen.lengthM + pensPerRoom * pen.widthM;
  }
  return Math.max(0, pensPerRoom - 2) * pen.lengthM + pensPerRoom * pen.widthM;
}

/**
 * Every room this many pens could be laid out in, costed.
 *
 * The scoring is neither "fewest rooms" nor "fewest spare pens", and the old
 * version's mistake was to be the second of those. Made to hate a spare pen
 * above all else, a generator answers thirty-eight finishing pens with nineteen
 * rooms of two — nothing spare, and nineteen sets of partitions, doors, drains
 * and fans, spread over four buildings, to save two pens. Two spare pens can be
 * a great deal cheaper than nine extra rooms, and only a cost proxy can say so.
 *
 * The shape is kept out of the money. A room far off the proportions a shed is
 * built in is penalised rather than forbidden, so a house with no neat answer
 * still gets an answer with a note on it.
 */
export function roomCandidates(
  pen: Rectangle,
  recommendedPens: number,
  policy: HousingPolicy,
  limits: RoomLimits = {},
): RoomPlan[] {
  if (recommendedPens <= 0) return [];
  const {
    centralPassageWidthM,
    preferredRoomMaxAspectRatio,
    allowRoomRotation,
    costWeights,
  } = policy.structure;
  const candidates: RoomPlan[] = [];

  for (const pensPerRoom of pensPerRoomChoices(policy, limits.batchPens ?? 0)) {
    for (const layout of policy.structure.layouts) {
      // Two rows means two rows: an odd pen count would leave a gap in one of
      // them, which is not a room anybody sets out.
      if (layout === "double_row_central_passage" && pensPerRoom % 2 !== 0) continue;
      const upright = roomRectangle(pen, layout, pensPerRoom, centralPassageWidthM);
      const roomCount = Math.ceil(recommendedPens / pensPerRoom);
      const totalPens = roomCount * pensPerRoom;
      const sparePens = totalPens - recommendedPens;
      const aspectRatio = aspectRatioOf(upright.widthM, upright.lengthM);
      const over = aspectRatio > preferredRoomMaxAspectRatio + 1e-9;
      const partitionM = partitionMetresOf(pen, layout, pensPerRoom);

      // The same room, and the two ways round it can stand. Which way it is
      // turned changes nothing inside it and everything about how it packs.
      const placements: { rectangle: Rectangle; rotated: boolean }[] = [
        { rectangle: upright, rotated: false },
      ];
      if (allowRoomRotation && Math.abs(upright.widthM - upright.lengthM) > 1e-9) {
        placements.push({
          rectangle: {
            widthM: upright.lengthM,
            lengthM: upright.widthM,
            areaM2: upright.areaM2,
          },
          rotated: true,
        });
      }

      for (const placement of placements) {
        const standalone = standaloneCostOf(
          { rectangle: placement.rectangle, roomCount, partitionM, sparePens },
          pen,
          policy,
        );
        candidates.push({
          layout,
          pensPerRoom,
          roomCount,
          totalPens,
          sparePens,
          rectangle: placement.rectangle,
          rotated: placement.rotated,
          roomWidthM: placement.rectangle.widthM,
          roomLengthM: placement.rectangle.lengthM,
          roomAreaM2: placement.rectangle.areaM2,
          totalRoomAreaM2: round4(roomCount * placement.rectangle.areaM2),
          aspectRatio,
          partitionM: round2(partitionM),
          overPreferredAspectRatio: over,
          estimatedCostM2: standalone,
          score:
            standalone +
            (over ? (aspectRatio - preferredRoomMaxAspectRatio) * costWeights.aspectRatio : 0),
        });
      }
    }
  }
  return candidates;
}

/** What one type's rooms would cost standing on their own, for shortlisting. */
function standaloneCostOf(
  room: { rectangle: Rectangle; roomCount: number; partitionM: number; sparePens: number },
  pen: Rectangle,
  policy: HousingPolicy,
): number {
  const { costWeights, maxRoomsPerBuilding, roofPitchFactor } = policy.structure;
  const buildings = Math.max(1, Math.ceil(room.roomCount / Math.max(1, maxRoomsPerBuilding)));
  const perBuilding = Math.ceil(room.roomCount / buildings);
  const footprint =
    buildings * room.rectangle.widthM * (perBuilding * room.rectangle.lengthM);
  const wall = buildings * 2 * (room.rectangle.widthM + perBuilding * room.rectangle.lengthM);
  const partitions =
    room.roomCount * room.partitionM + (room.roomCount - buildings) * room.rectangle.widthM;
  return (
    footprint * costWeights.floorAreaM2 +
    footprint * roofPitchFactor * costWeights.roofAreaM2 +
    wall * costWeights.externalWallM +
    partitions * costWeights.internalPartitionM +
    buildings * costWeights.building +
    room.roomCount * costWeights.room +
    room.sparePens * pen.areaM2 * costWeights.sparePenAreaM2
  );
}

/**
 * The room template a housing type is built to, on its own.
 *
 * Rooms inside the preferred proportions are chosen from first, and only if none
 * of them is feasible is a long thin room accepted — which is the difference
 * between a limit and a preference, and is why it is reported when it happens.
 *
 * A type that shares a building goes through {@link planStructures} instead,
 * which chooses for all of its housemates at once.
 */
export function chooseRoom(
  pen: Rectangle,
  recommendedPens: number,
  policy: HousingPolicy,
  limits: RoomLimits = {},
): RoomPlan | null {
  return bestOf(roomCandidates(pen, recommendedPens, policy, limits));
}

/** Preferred shapes first; the whole field only when none of them is feasible. */
function bestOf(candidates: readonly RoomPlan[]): RoomPlan | null {
  if (candidates.length === 0) return null;
  const pool = feasible(candidates);
  return pool.reduce((best, candidate) => (candidate.score < best.score ? candidate : best));
}

function feasible(candidates: readonly RoomPlan[]): readonly RoomPlan[] {
  const within = candidates.filter((candidate) => !candidate.overPreferredAspectRatio);
  return within.length > 0 ? within : candidates;
}

// ------------------------------------------------------------------ buildings

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
  /** Footprint that is inside the building and inside no room. */
  unusedAreaM2: number;
  /** Room floor as a percentage of footprint: how well the rectangle was used. */
  layoutEfficiencyPct: number;
  /** The perimeter: what has to be built as external wall. */
  externalWallM: number;
  /** Everything inside it that is a wall and not an external one. */
  internalPartitionM: number;
  /**
   * Whether another room of the same module can be added without disturbing
   * what is standing. True when every room in it is the same width, because
   * then one more goes on the end and the building simply gets longer.
   */
  expandable: boolean;
  expansionDirection?: "length" | "width";
};

/** What one housing type contributes to the buildings it shares. */
export type TypeStructure = {
  housingType: HousingType;
  layout: RoomLayout;
  roomCount: number;
  pensPerRoom: number;
  penCapacityHead: number;
  room: Rectangle;
  /** Running metres of partition in one room of this type. */
  partitionM?: number;
};

export type BuildingOptions = {
  /**
   * Whether housing types that belong in one building actually share one. False
   * gives each type its own shed, which is sometimes the cheaper answer when
   * their rooms are different depths.
   */
  share?: boolean;
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
 * architectural one — and even there, whether they actually share is costed
 * rather than assumed. The order the structures are given in is the order their
 * rooms are laid out in, so the caller can try arrangements.
 */
export function buildingsFor(
  structures: readonly TypeStructure[],
  policy: HousingPolicy,
  options: BuildingOptions = {},
): HousingBuilding[] {
  const share = options.share ?? true;
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

    // Each chunk is a set of types that will stand under one roof. Sharing puts
    // them all in one chunk; splitting gives each its own.
    const chunks = share ? [group] : group.map((structure) => [structure]);
    const runs: TypeStructure[][] = [];
    for (const chunk of chunks) {
      const totalRooms = chunk.reduce((total, structure) => total + structure.roomCount, 0);
      const perBuilding = Math.max(1, policy.structure.maxRoomsPerBuilding);
      const buildingCount = Math.max(1, Math.ceil(totalRooms / perBuilding));
      const base = Math.floor(totalRooms / buildingCount);
      const extra = totalRooms % buildingCount;

      // The rooms of the chunk, one entry a room, in the order given.
      const queue: TypeStructure[] = [];
      for (const structure of chunk) {
        for (let room = 0; room < structure.roomCount; room += 1) queue.push(structure);
      }
      let cursor = 0;
      for (let index = 0; index < buildingCount; index += 1) {
        const rooms = base + (index < extra ? 1 : 0);
        runs.push(queue.slice(cursor, cursor + rooms));
        cursor += rooms;
      }
    }

    runs.forEach((rooms, index) => {
      buildings.push(assemble(buildingType, index, runs.length, rooms));
    });
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
  const roomAreaM2 = round4(
    rooms.reduce((total, structure) => total + structure.room.areaM2, 0),
  );
  const unusedAreaM2 = round4(Math.max(0, rectangle.areaM2 - roomAreaM2));
  const partitions =
    rooms.reduce((total, structure) => total + (structure.partitionM ?? 0), 0) +
    Math.max(0, rooms.length - 1) * rectangle.widthM;
  // One width throughout means one more room goes on the end and the shed just
  // gets longer. Mixed widths mean the next room either wastes the difference or
  // forces the whole side wall out, and neither is "adding a room".
  const widths = new Set(rooms.map((structure) => structure.room.widthM));
  const expandable = widths.size <= 1 && rooms.length > 0;

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
    unusedAreaM2,
    layoutEfficiencyPct:
      rectangle.areaM2 > 0 ? round2((roomAreaM2 / rectangle.areaM2) * 100) : 0,
    externalWallM: round2(2 * (rectangle.widthM + rectangle.lengthM)),
    internalPartitionM: round2(partitions),
    expandable,
    expansionDirection: expandable ? "length" : undefined,
  };
}

// ------------------------------------------------- rooms and buildings at once

/** One housing type's ask of the structure generator. */
export type StructureRequest = {
  housingType: HousingType;
  /** The box one pen of this type is, from the geometry phase. */
  pen: Rectangle;
  penCapacityHead: number;
  /** Pens that must exist. The rooms provide at least this many, never fewer. */
  targetPens: number;
  /** The most pens one intake filled, from the allocator. */
  batchPens: number;
};

/** What a whole arrangement would take to build. */
export type HousingLayoutCost = {
  floorAreaM2: number;
  externalWallLengthM: number;
  internalPartitionLengthM: number;
  roofAreaM2: number;
  buildingCount: number;
  roomCount: number;
  sparePens: number;
  unusedRectangularAreaM2: number;
  score: number;
};

/** One whole way of housing a building group, costed and comparable. */
export type HousingStructureCandidate = {
  id: string;
  buildingType: BuildingType;
  /** "4 places/room, double row, shared" — how this one differs from the others. */
  description: string;
  buildingCount: number;
  rooms: RoomCandidate[];
  totalPens: number;
  headCapacity: number;
  totalBuildingAreaM2: number;
  externalWallLengthM: number;
  internalPartitionLengthM: number;
  unusedAreaM2: number;
  layoutEfficiencyPct: number;
  sparePens: number;
  estimatedCostScore: number;
  cost: HousingLayoutCost;
  /** The room template each type in the group would be built to. */
  plans: { housingType: HousingType; plan: RoomPlan }[];
  buildings: HousingBuilding[];
};

export type StructurePlan = {
  /** The room template chosen for each type that could be given one. */
  rooms: Map<HousingType, RoomPlan>;
  buildings: HousingBuilding[];
  /** The best few arrangements of each building group, cheapest first. */
  candidates: HousingStructureCandidate[];
  cost: HousingLayoutCost;
};

/** How far down each type's own shortlist the joint search is willing to look. */
const SHORTLIST = 8;
/** How many arrangements of a building group are kept, to show the working. */
const KEPT_CANDIDATES = 3;

/**
 * Rooms and buildings decided together, one building group at a time.
 *
 * Choosing a room template for each housing type on its own and only then
 * dividing the rooms between buildings is what leaves the breeding house full of
 * air. Three kinds of pen share that building; their rooms come out three
 * different depths; and a building is a rectangle, so its width is the deepest
 * room in it and every shallower room pays for the difference along its whole
 * length. The room that is cheapest on its own is very often not the room that
 * is cheapest to stand next to its neighbours.
 *
 * So the housemates are decided together, and four things are varied at once:
 * which module each type is built to, which way round each room stands, what
 * order the rooms come in, and whether the types share a building at all. Every
 * combination is actually assembled and costed, and the cheapest is kept along
 * with the runners-up, so the plan can show what it turned down.
 *
 * A type housed on its own has one arrangement of neighbours — none — so this
 * reduces to picking its best layout, which is what it should reduce to.
 */
export function planStructures(
  requests: readonly StructureRequest[],
  policy: HousingPolicy,
): StructurePlan {
  const byBuilding = new Map<BuildingType, StructureRequest[]>();
  for (const request of requests) {
    if (request.targetPens <= 0) continue;
    const building = BUILDING_OF[request.housingType];
    const group = byBuilding.get(building);
    if (group) group.push(request);
    else byBuilding.set(building, [request]);
  }

  const rooms = new Map<HousingType, RoomPlan>();
  const buildings: HousingBuilding[] = [];
  const candidates: HousingStructureCandidate[] = [];
  const spares: SpareEntry[] = [];

  for (const buildingType of Object.keys(BUILDING_MEMBERS) as BuildingType[]) {
    const group = byBuilding.get(buildingType);
    if (group === undefined || group.length === 0) continue;
    const order = BUILDING_MEMBERS[buildingType];
    group.sort((a, b) => order.indexOf(a.housingType) - order.indexOf(b.housingType));

    const found = candidatesFor(buildingType, group, policy);
    if (found.length === 0) continue;
    const chosen = found[0];
    for (const entry of chosen.plans) rooms.set(entry.housingType, entry.plan);
    buildings.push(...chosen.buildings);
    candidates.push(...found.slice(0, KEPT_CANDIDATES));
    chosen.plans.forEach((entry, index) => {
      spares.push(spareOf(entry.plan, group[index].pen.areaM2));
    });
  }

  return { rooms, buildings, candidates, cost: costOf(buildings, spares, policy) };
}

/**
 * Every arrangement of one building group worth considering, cheapest first.
 *
 * Exported because the whole argument of this rewrite is that the answer should
 * be arrived at by comparison rather than asserted, and an argument you cannot
 * inspect is not one. The list this returns is what the choice was made from.
 */
export function candidatesFor(
  buildingType: BuildingType,
  group: readonly StructureRequest[],
  policy: HousingPolicy,
): HousingStructureCandidate[] {
  const shortlists = group.map((request) => shortlistFor(request, policy, group.length));
  if (shortlists.some((list) => list.length === 0)) return [];

  const orderings = group.length > 1 ? permutationsOf(group.length) : [[0]];
  const sharing = group.length > 1 && policy.structure.allowBuildingSplit ? [true, false] : [true];

  const found: HousingStructureCandidate[] = [];
  let sequence = 0;
  for (const share of sharing) {
    // Room order only matters where the rooms share a roof.
    for (const ordering of share ? orderings : [identity(group.length)]) {
      for (const combination of combinationsOf(shortlists)) {
        const structures = ordering.map((index) => structureOf(group[index], combination[index]));
        const built = buildingsFor(structures, policy, { share });
        const spares = combination.map((plan, index) =>
          spareOf(plan, group[index].pen.areaM2),
        );
        const cost = costOf(built, spares, policy);
        sequence += 1;
        found.push({
          id: `${buildingType}-${String(sequence).padStart(4, "0")}`,
          buildingType,
          description: describe(group, combination, ordering, share),
          buildingCount: built.length,
          rooms: combination.map(toRoomCandidate),
          totalPens: built.reduce((total, building) => total + building.penCount, 0),
          headCapacity: built.reduce((total, building) => total + building.headCapacity, 0),
          totalBuildingAreaM2: cost.floorAreaM2,
          externalWallLengthM: cost.externalWallLengthM,
          internalPartitionLengthM: cost.internalPartitionLengthM,
          unusedAreaM2: cost.unusedRectangularAreaM2,
          layoutEfficiencyPct: efficiencyOf(built),
          sparePens: cost.sparePens,
          estimatedCostScore: cost.score,
          cost,
          plans: combination.map((plan, index) => ({
            housingType: group[index].housingType,
            plan,
          })),
          buildings: built,
        });
      }
    }
  }

  // Cheapest first, ties settled by the order they were generated in, so the
  // same request always produces the same site.
  found.sort((a, b) => a.estimatedCostScore - b.estimatedCostScore || (a.id < b.id ? -1 : 1));

  // One entry a design. Two arrangements that come to the same rooms in the same
  // order are the same building drawn twice, and a list of alternatives that
  // repeats itself is not telling a reader anything.
  const distinct: HousingStructureCandidate[] = [];
  const seen = new Set<string>();
  for (const candidate of found) {
    if (seen.has(candidate.description)) continue;
    seen.add(candidate.description);
    distinct.push(candidate);
  }
  return distinct;
}

/**
 * The layouts a type is worth considering next to its housemates.
 *
 * Its own cheapest first, because a layout that is dear on its own has to be a
 * long way better as a neighbour to be worth it, and the shortlist is deep
 * enough to hold the ones that could be. It is only a shortlist at all because
 * the search below is a product: three housemates with every module, layout and
 * rotation each, in every order, shared and split, is a great many buildings
 * assembled to save a wall.
 */
function shortlistFor(
  request: StructureRequest,
  policy: HousingPolicy,
  housemates: number,
): RoomPlan[] {
  const all = roomCandidates(request.pen, request.targetPens, policy, {
    batchPens: request.batchPens,
  });
  if (all.length === 0) return [];
  const pool = [...feasible(all)].sort((a, b) => a.score - b.score);
  return housemates > 1 ? pool.slice(0, SHORTLIST) : pool;
}

function structureOf(request: StructureRequest, plan: RoomPlan): TypeStructure {
  return {
    housingType: request.housingType,
    layout: plan.layout,
    roomCount: plan.roomCount,
    pensPerRoom: plan.pensPerRoom,
    penCapacityHead: request.penCapacityHead,
    room: plan.rectangle,
    partitionM: plan.partitionM,
  };
}

function toRoomCandidate(plan: RoomPlan): RoomCandidate {
  return {
    pensPerRoom: plan.pensPerRoom,
    roomCount: plan.roomCount,
    totalPens: plan.totalPens,
    sparePens: plan.sparePens,
    roomWidthM: plan.roomWidthM,
    roomLengthM: plan.roomLengthM,
    roomAreaM2: plan.roomAreaM2,
    totalRoomAreaM2: plan.totalRoomAreaM2,
  };
}

/**
 * What makes this arrangement the one it is, in the terms it was chosen on.
 *
 * Written in the room order the arrangement actually uses, because the order is
 * part of the design: the same three room types laid out gilt-first rather than
 * boar-first is a differently shaped building. It doubles as the key two
 * identical designs are folded together on.
 */
function describe(
  group: readonly StructureRequest[],
  combination: readonly RoomPlan[],
  ordering: readonly number[],
  share: boolean,
): string {
  const parts = ordering.map((index) => {
    const plan = combination[index];
    const layout = plan.layout === "single_row" ? "single row" : "double row";
    const turned = plan.rotated ? ", turned" : "";
    return `${group[index].housingType}: ${plan.roomCount}×${plan.pensPerRoom} ${layout}${turned}`;
  });
  if (group.length > 1) parts.push(share ? "under one roof" : "separate houses");
  return parts.join("; ");
}

/** Every ordering of n rooms, in a fixed order so the search is reproducible. */
function permutationsOf(count: number): number[][] {
  const result: number[][] = [];
  const current: number[] = [];
  const used = new Array<boolean>(count).fill(false);
  const walk = () => {
    if (current.length === count) {
      result.push([...current]);
      return;
    }
    for (let index = 0; index < count; index += 1) {
      if (used[index]) continue;
      used[index] = true;
      current.push(index);
      walk();
      current.pop();
      used[index] = false;
    }
  };
  walk();
  return result;
}

function identity(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index);
}

/** Every way of taking one layout from each housemate, in a fixed order. */
function* combinationsOf(shortlists: readonly RoomPlan[][]): Generator<RoomPlan[]> {
  const chosen: RoomPlan[] = [];
  function* walk(index: number): Generator<RoomPlan[]> {
    if (index === shortlists.length) {
      yield [...chosen];
      return;
    }
    for (const plan of shortlists[index]) {
      chosen.push(plan);
      yield* walk(index + 1);
      chosen.pop();
    }
  }
  yield* walk(0);
}

function efficiencyOf(buildings: readonly HousingBuilding[]): number {
  const footprint = buildings.reduce((total, building) => total + building.rectangle.areaM2, 0);
  const rooms = buildings.reduce((total, building) => total + building.roomAreaM2, 0);
  return footprint > 0 ? round2((rooms / footprint) * 100) : 0;
}

/**
 * What a set of buildings comes to, in equivalent square metres.
 *
 * The footprint is the honest figure and carries the mixed-width waste with it:
 * a building is width times length, and the width is the deepest room in it, so
 * a narrow room standing next to a deep one pays for the difference down its
 * whole length. That waste is then charged a second time, lightly, because a
 * strip of shed nobody can use is worse than an equivalent area of shed that
 * somebody can.
 *
 * Every weight comes out of the policy. None of them is a hard constraint: a
 * layout that breaks a housing rule is not scored badly, it is never generated.
 */
/** What one type's rooms contribute to a cost beyond the buildings they sit in. */
export type SpareEntry = {
  sparePens: number;
  penAreaM2: number;
  over: boolean;
  aspectRatio: number;
};

function spareOf(plan: RoomPlan, penAreaM2: number): SpareEntry {
  return {
    sparePens: plan.sparePens,
    penAreaM2,
    over: plan.overPreferredAspectRatio,
    aspectRatio: plan.aspectRatio,
  };
}

export function costOf(
  buildings: readonly HousingBuilding[],
  spares: readonly SpareEntry[],
  policy: HousingPolicy,
): HousingLayoutCost {
  const weights: LayoutCostWeights = policy.structure.costWeights;
  const { roofPitchFactor, preferredRoomMaxAspectRatio } = policy.structure;

  let floorAreaM2 = 0;
  let externalWallLengthM = 0;
  let internalPartitionLengthM = 0;
  let unusedRectangularAreaM2 = 0;
  let roomCount = 0;
  let expansionPenalty = 0;
  for (const building of buildings) {
    floorAreaM2 += building.rectangle.areaM2;
    externalWallLengthM += building.externalWallM;
    internalPartitionLengthM += building.internalPartitionM;
    unusedRectangularAreaM2 += building.unusedAreaM2;
    roomCount += building.roomCount;
    if (!building.expandable) expansionPenalty += weights.inexpandableBuilding;
  }

  let sparePens = 0;
  let sparePenArea = 0;
  let aspectPenalty = 0;
  for (const spare of spares) {
    sparePens += spare.sparePens;
    sparePenArea += spare.sparePens * spare.penAreaM2;
    if (spare.over) {
      aspectPenalty += (spare.aspectRatio - preferredRoomMaxAspectRatio) * weights.aspectRatio;
    }
  }

  const roofAreaM2 = floorAreaM2 * roofPitchFactor;
  const score =
    floorAreaM2 * weights.floorAreaM2 +
    roofAreaM2 * weights.roofAreaM2 +
    externalWallLengthM * weights.externalWallM +
    internalPartitionLengthM * weights.internalPartitionM +
    buildings.length * weights.building +
    roomCount * weights.room +
    unusedRectangularAreaM2 * weights.unusedAreaM2 +
    sparePenArea * weights.sparePenAreaM2 +
    aspectPenalty +
    expansionPenalty;

  return {
    floorAreaM2: round2(floorAreaM2),
    externalWallLengthM: round2(externalWallLengthM),
    internalPartitionLengthM: round2(internalPartitionLengthM),
    roofAreaM2: round2(roofAreaM2),
    buildingCount: buildings.length,
    roomCount,
    sparePens,
    unusedRectangularAreaM2: round4(unusedRectangularAreaM2),
    score: round2(score),
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
