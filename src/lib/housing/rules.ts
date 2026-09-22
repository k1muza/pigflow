import type { PlannerConfig } from "../config";

/**
 * What the housing planner is allowed to assume about pigs and pens.
 *
 * Everything in this file is a rule about accommodation and nothing in it is a
 * rule about animals. That separation is the point: the farm is simulated by the
 * engine, and the housing planner only ever asks "given these animals on this
 * day, what would they have to stand in?". A number that belongs to a pen lives
 * here, in configuration, rather than being written into the allocator — so a
 * unit built to a different standard is a different policy object and not a
 * different program.
 *
 * The defaults are read off the ARC Pig Housing Manual and are labelled as such
 * wherever they reach a reader. They are a housing profile, not legislation, and
 * a plan that has to satisfy a particular jurisdiction should carry its own.
 */

export type HousingType =
  | "boar"
  | "service_sow"
  | "gestation"
  | "farrowing"
  | "gilt"
  | "weaner"
  | "grower"
  | "finisher";

/** The order every read-out uses: breeding first, then the growing houses. */
export const HOUSING_TYPES: readonly HousingType[] = [
  "boar",
  "service_sow",
  "gestation",
  "farrowing",
  "gilt",
  "weaner",
  "grower",
  "finisher",
];

export const HOUSING_LABELS: Record<HousingType, string> = {
  boar: "Boar pens",
  service_sow: "Service & dry sow places",
  gestation: "Gestation pens",
  farrowing: "Farrowing places",
  gilt: "Replacement gilt pens",
  weaner: "Weaner pens",
  grower: "Grower pens",
  finisher: "Finisher pens",
};

/** What a pen of this type is counted in, which is not "pens" in every case. */
export const HOUSING_UNITS: Record<HousingType, string> = {
  boar: "pens",
  service_sow: "places",
  gestation: "group pens",
  farrowing: "places",
  gilt: "pens",
  weaner: "pens",
  grower: "pens",
  finisher: "pens",
};

/** A building holds rooms of one primary kind; three of these share one. */
export type BuildingType =
  | "breeding_service"
  | "gestation"
  | "farrowing"
  | "weaner"
  | "grower"
  | "finisher";

export const BUILDING_LABELS: Record<BuildingType, string> = {
  breeding_service: "Breeding & Service House",
  gestation: "Gestation House",
  farrowing: "Farrowing House",
  weaner: "Weaner House",
  grower: "Grower House",
  finisher: "Finisher House",
};

/**
 * Which building a housing type is put in. Boars, sows waiting to be served and
 * replacement gilts share the breeding and service house, which is where a farm
 * puts them: they are handled by the same people on the same round, and the
 * boar has to be within sight and smell of the females he is working.
 */
export const BUILDING_OF: Record<HousingType, BuildingType> = {
  boar: "breeding_service",
  service_sow: "breeding_service",
  gilt: "breeding_service",
  gestation: "gestation",
  farrowing: "farrowing",
  weaner: "weaner",
  grower: "grower",
  finisher: "finisher",
};

/** The order rooms are laid out in a shared building, so a plan reads the same twice. */
export const BUILDING_MEMBERS: Record<BuildingType, readonly HousingType[]> = {
  breeding_service: ["boar", "service_sow", "gilt"],
  gestation: ["gestation"],
  farrowing: ["farrowing"],
  weaner: ["weaner"],
  grower: ["grower"],
  finisher: ["finisher"],
};

/** Floor area a head, stepped by the heaviest the pig gets while it is in there. */
export type FloorAreaBand = { maxWeightKg: number; m2PerHead: number };

export type RoomLayout = "single_row" | "double_row_central_passage";

/**
 * Where the margin over the simulated minimum comes from.
 *
 * `none` builds what the run required and nothing else. `percentage` is the flat
 * margin, kept because a farmer who wants to quote one should be able to.
 * `simulation-derived` is the default, and it is the only one of the three that
 * looks at the farm: it asks what surge in demand this herd actually put through
 * this house, and adds that and no more. A house whose requirement never moves
 * gets nothing, because nothing in the simulation justifies anything.
 */
export type ReserveMode = "none" | "percentage" | "simulation-derived";

/**
 * What a layout is scored on, in equivalent square metres of construction.
 *
 * Not a bill of quantities and not a quotation. What it is for is comparing two
 * layouts of the same house, and for that it only has to get the shape of the
 * trade-off right: floor is bought by the square metre, a wall costs more per
 * metre than a floor does, a room costs more than a partition and a building
 * costs more than a room. Every weight is here rather than in the algorithm, so
 * a unit built where walls are cheap and land is dear can say so.
 */
export type LayoutCostWeights = {
  /** Per square metre of building footprint. */
  floorAreaM2: number;
  /** Per square metre of roof, which is the footprint times the pitch factor. */
  roofAreaM2: number;
  /** Per metre of external wall, which is the buildings' perimeters. */
  externalWallM: number;
  /** Per metre of internal partition: pen divisions, passage walls, room walls. */
  internalPartitionM: number;
  /** Per building, for everything a shell costs that is not its walls and floor. */
  building: number;
  /** Per room, for the door, the drain and its share of the ventilation. */
  room: number;
  /** Per square metre of footprint that is inside a building and not inside a room. */
  unusedAreaM2: number;
  /** Per square metre of pen that gets built and never filled: its fit-out. */
  sparePenAreaM2: number;
  /** Per unit of aspect ratio over the preferred maximum, per room. */
  aspectRatio: number;
  /** For a building another room cannot be added to without disturbing it. */
  inexpandableBuilding: number;
};

export type HousingPolicy = {
  /** Where the numbers came from, printed wherever they are shown. */
  source: string;

  farrowing: {
    /** Days the sow is moved in before she is due. */
    preFarrowDays: number;
    /** Days the place stands empty between litters and cannot take another sow. */
    cleaningDays: number;
    penMinWidthM: number;
    penMaxWidthM: number;
    penMinLengthM: number;
    penMaxLengthM: number;
  };

  weaner: {
    targetHeadPerPen: number;
    maxHeadPerPen: number;
    floorAreaM2PerHead: number;
    cleaningDays: number;
  };

  grower: {
    targetHeadPerPen: number;
    maxHeadPerPen: number;
    cleaningDays: number;
    floorAreaBands: readonly FloorAreaBand[];
  };

  finisher: {
    targetHeadPerPen: number;
    maxHeadPerPen: number;
    cleaningDays: number;
    floorAreaBands: readonly FloorAreaBand[];
    /**
     * Whether entire males are penned apart from females. The manual makes sex
     * a grouping criterion where young males are not castrated, which is what
     * this model grows, so it is on by default.
     */
    separateSexes: boolean;
  };

  boar: {
    housingOnlyAreaM2: number;
    servicePenAreaM2: number;
    /** The shortest side a pen used for service may have. */
    serviceMinShortSideM: number;
    /**
     * Whether the boar pens are built to serve in. A unit that serves in the pen
     * needs the larger box and the 2.1 m short side; one that walks the sow to a
     * service crate does not, and this is the switch between them.
     */
    penUsedForService: boolean;
  };

  gestation: {
    mode: "group";
    targetSowsPerPen: number;
    minAreaM2PerSow: number;
    cleaningDays: number;
  };

  serviceSow: {
    areaM2PerSow: number;
    /**
     * The shortest a sow's own pen may be along its long side. The manual gives
     * the area and not the box; a mature sow is about two metres from snout to
     * tail, and 1.8 m² laid out as a tidy square is a pen she cannot lie down
     * in. A Pigflow planning assumption.
     */
    minLengthM: number;
  };

  /**
   * Replacement gilts. The manual sets no separate gilt standard, so they are
   * housed on the group-sow rule at a smaller body size — a Pigflow planning
   * assumption, and labelled as one wherever it is shown.
   */
  gilt: {
    targetHeadPerPen: number;
    minAreaM2PerHead: number;
    cleaningDays: number;
  };

  structure: {
    /**
     * Where the margin over the simulated minimum comes from.
     *
     * A blanket percentage added to every house before anything is rounded
     * compounds with the room module and the building module, and the compound
     * is invisible: on a single boar pen it is the whole reason a second one
     * gets drawn. The default asks the run what margin it can justify instead.
     */
    reserveMode: ReserveMode;
    /** The margin under `percentage`, and the only thing that mode looks at. */
    reservePct: number;
    /** The most a derived reserve may come to, as a fraction of the minimum. */
    reserveMaxPct: number;
    /**
     * The window a surge in demand is measured over for a derived reserve. One
     * intake: the reserve is there to absorb the next batch being bigger than
     * the last, not to cover five years of herd growth, which the peak covers.
     */
    reserveWindowDays: number;
    /**
     * How far up the run of daily surges a derived reserve reads. Short of 1, so
     * that a surge which happened once in five years — a herd being stocked, a
     * house being filled for the first time — does not set the margin for the
     * other five years.
     */
    reservePercentile: number;
    /**
     * Pen counts a room may be laid out in, or null for every count between
     * `minPensPerRoom` and `maxPensPerRoom`.
     *
     * Null is the default. A fixed list of modules is the second reason the old
     * generator overbuilt: a house needing three pens and a list offering two,
     * four and six has to buy four, and a house needing one has to buy two.
     */
    pensPerRoomOptions: readonly number[] | null;
    minPensPerRoom: number;
    maxPensPerRoom: number;
    centralPassageWidthM: number;
    /** The shape a pen is aimed at: a little longer than it is wide. */
    preferredPenAspectRatio: number;
    preferredRoomMaxAspectRatio: number;
    maxRoomsPerBuilding: number;
    /** Roof area as a multiple of footprint: a pitched roof is bigger than its plan. */
    roofPitchFactor: number;
    /** What every feasible layout is scored on. */
    costWeights: LayoutCostWeights;
    /** Room layouts the generator is allowed to draw. */
    layouts: readonly RoomLayout[];
    /**
     * Whether a room may be turned through a right angle when it is placed.
     *
     * A 5 × 8 room and an 8 × 5 room hold the same pens laid out the same way;
     * which way it is turned only decides how it packs against its neighbours.
     * Turning the narrow service rooms to run across a building instead of along
     * it is often the whole difference between a tidy shed and a wide empty
     * strip down one side of it.
     */
    allowRoomRotation: boolean;
    /**
     * Whether housing types that share a building may be given separate ones
     * when sharing packs badly. The breeding house is the only place this
     * arises, and it is a choice worth costing rather than assuming either way.
     */
    allowBuildingSplit: boolean;
    /**
     * Days between committing to a building and being able to put pigs in it.
     * Construction phases are dated this far ahead of the day the capacity is
     * first needed.
     */
    constructionLeadDays: number;
    /**
     * How far apart two pieces of building work have to fall due before they are
     * worth treating as separate phases.
     *
     * Without it, a house that fills over its first two months comes out as five
     * phases a fortnight apart, which is not a construction programme, it is the
     * same programme written five times. Rooms falling due inside one of these
     * windows are built together, at the earliest date any of them is needed.
     */
    minPhaseSpacingDays: number;
    /**
     * How long a pen goes on taking new arrivals after the first one lands in
     * it. A farm fills a pen over a few days and then shuts the gate; it does
     * not drip one more pig into a settled group a month later. Without this a
     * pen would never close, so it would never empty, so it would never be
     * washed — and the cleaning days the manual asks for would cost nothing.
     *
     * A Pigflow planning assumption, not a figure from the manual.
     */
    penFillWindowDays: number;
  };
};

/** The label every derived figure is traced back to. */
export const HOUSING_SOURCE = "ARC Pig Housing Manual profile";

/**
 * The manual's profile, as this planner reads it.
 *
 * Boar pens: 7.0 m² for housing only, 9.3 m² where the pen is served in, with
 * the short side not under 2.1 m. Service sows in individual pens of about
 * 1.8 m². Group gestation in fours and fives at 3.9–4.9 m² of total floor a sow.
 * Farrowing at 1.8–2.0 m wide by 2.2–2.5 m long, the sow moved in a week before
 * she is due and the place left four days between litters. Weaners two litters
 * to a pen of about 8 m², which is 0.4 m² a head, with a week of cleaning and
 * sterilising between groups. Growers kept in the groups they came up in.
 * Finishers in eights and tens by bodyweight, and by sex where the males are
 * entire. Floor area for both stepped by liveweight: 0.80 m² to 45 kg, 0.95 m²
 * to 90 kg, 1.30 m² to 110 kg.
 *
 * The conservative end of every range the manual gives is the one taken, and the
 * top grower/finisher band is read at 1.30 rather than 1.00: a pen that turns
 * out too small cannot be fixed by a spreadsheet.
 */
export const ARC_HOUSING_POLICY: HousingPolicy = {
  source: HOUSING_SOURCE,
  farrowing: {
    preFarrowDays: 7,
    cleaningDays: 4,
    penMinWidthM: 1.8,
    penMaxWidthM: 2.0,
    penMinLengthM: 2.2,
    penMaxLengthM: 2.5,
  },
  weaner: {
    targetHeadPerPen: 20,
    maxHeadPerPen: 20,
    floorAreaM2PerHead: 0.4,
    cleaningDays: 7,
  },
  grower: {
    targetHeadPerPen: 20,
    maxHeadPerPen: 20,
    cleaningDays: 7,
    floorAreaBands: [
      { maxWeightKg: 45, m2PerHead: 0.8 },
      { maxWeightKg: 90, m2PerHead: 0.95 },
      { maxWeightKg: 110, m2PerHead: 1.3 },
    ],
  },
  finisher: {
    targetHeadPerPen: 10,
    maxHeadPerPen: 10,
    cleaningDays: 7,
    floorAreaBands: [
      { maxWeightKg: 45, m2PerHead: 0.8 },
      { maxWeightKg: 90, m2PerHead: 0.95 },
      { maxWeightKg: 110, m2PerHead: 1.3 },
    ],
    separateSexes: true,
  },
  boar: {
    housingOnlyAreaM2: 7.0,
    servicePenAreaM2: 9.3,
    serviceMinShortSideM: 2.1,
    penUsedForService: true,
  },
  gestation: {
    mode: "group",
    targetSowsPerPen: 5,
    minAreaM2PerSow: 3.9,
    cleaningDays: 0,
  },
  serviceSow: {
    areaM2PerSow: 1.8,
    minLengthM: 2.0,
  },
  gilt: {
    targetHeadPerPen: 10,
    minAreaM2PerHead: 1.5,
    cleaningDays: 0,
  },
  structure: {
    reserveMode: "simulation-derived",
    reservePct: 0.1,
    reserveMaxPct: 0.25,
    reserveWindowDays: 7,
    reservePercentile: 0.95,
    pensPerRoomOptions: null,
    minPensPerRoom: 1,
    maxPensPerRoom: 12,
    centralPassageWidthM: 1.2,
    preferredPenAspectRatio: 1.25,
    preferredRoomMaxAspectRatio: 3.5,
    maxRoomsPerBuilding: 6,
    roofPitchFactor: 1.15,
    costWeights: {
      floorAreaM2: 1,
      roofAreaM2: 0.6,
      externalWallM: 6,
      internalPartitionM: 1.5,
      building: 40,
      room: 8,
      unusedAreaM2: 0.5,
      sparePenAreaM2: 0.5,
      aspectRatio: 25,
      inexpandableBuilding: 30,
    },
    layouts: ["single_row", "double_row_central_passage"],
    allowRoomRotation: true,
    allowBuildingSplit: true,
    penFillWindowDays: 7,
    constructionLeadDays: 180,
    minPhaseSpacingDays: 365,
  },
};

/**
 * The pen counts a room of this type may be laid out in.
 *
 * `batchPens` is the largest number of pens one intake ever filled, and it is a
 * ceiling rather than a preference: a room is the unit a house is emptied,
 * washed and refilled in, so a room bigger than a batch is a room that can never
 * be run all in, all out. Where a type is not batched — a gestation pen or a
 * boar pen, held continuously and never turned over as a group — there is no
 * batch to be bigger than, and the policy ceiling is the only one.
 */
export function pensPerRoomChoices(policy: HousingPolicy, batchPens = 0): number[] {
  const { pensPerRoomOptions, minPensPerRoom, maxPensPerRoom } = policy.structure;
  const ceiling = batchPens > 0 ? Math.min(maxPensPerRoom, batchPens) : maxPensPerRoom;
  const floor = Math.max(1, minPensPerRoom);
  const options: number[] = [];
  if (pensPerRoomOptions !== null) {
    for (const count of pensPerRoomOptions) if (count > 0) options.push(count);
  } else {
    for (let count = floor; count <= Math.max(ceiling, floor); count += 1) options.push(count);
  }
  const allowed = options.filter((count) => count <= ceiling);
  // Never nothing: a ceiling below every configured module still has to produce
  // a room, so the smallest module on offer is kept.
  const pool = allowed.length > 0 ? allowed : [Math.min(...options)];
  return [...new Set(pool)].sort((a, b) => a - b);
}

/** A policy of one's own, without editing the manual's. */
export function housingPolicy(edit: (policy: HousingPolicy) => void = () => {}): HousingPolicy {
  const policy = structuredClone(ARC_HOUSING_POLICY) as HousingPolicy;
  edit(policy);
  return policy;
}

/**
 * The weight a pig of each growing stage leaves its house at, read off the plan
 * rather than assumed.
 *
 * This is what makes "the maximum expected bodyweight while the pigs occupy the
 * pen" a figure instead of a guess. A pen built for the weight a batch walks in
 * at is a pen that is too small by the time the batch walks out of it, which is
 * the commonest way a grower house comes out undersized on paper.
 */
export type StageExitWeights = { weaner: number; grower: number; finisher: number };

export function stageExitWeights(config: PlannerConfig): StageExitWeights {
  const { growth } = config;
  return {
    weaner: growth.growerStartWeightKg,
    grower: growth.finisherStartWeightKg,
    // A pig is drawn for market on its cohort's average, so part of a pen goes
    // over target before the pen goes. Sale weight is the floor of what the
    // finishing pen has to hold, not the ceiling, and the allocator raises it to
    // the heaviest pig actually standing in the pen.
    finisher: growth.saleWeightKg,
  };
}

/**
 * Floor area a head at a given liveweight, and whether the bands covered it.
 *
 * A pig heavier than the top band is not extrapolated. The top rate is used so
 * that a plan still produces a number, and `covered` comes back false so the
 * planner can say out loud that it has no rule for a pig that size rather than
 * quietly inventing one.
 */
export function floorAreaPerHead(
  bands: readonly FloorAreaBand[],
  weightKg: number,
): { m2PerHead: number; covered: boolean } {
  if (bands.length === 0) return { m2PerHead: 0, covered: false };
  for (const band of bands) {
    if (weightKg <= band.maxWeightKg) return { m2PerHead: band.m2PerHead, covered: true };
  }
  const top = bands[bands.length - 1];
  return { m2PerHead: top.m2PerHead, covered: false };
}

/** The heaviest weight the configured bands have a rule for. */
export function topBandWeightKg(bands: readonly FloorAreaBand[]): number {
  return bands.length === 0 ? 0 : bands[bands.length - 1].maxWeightKg;
}

/** Days between one group leaving a pen of this type and the next arriving. */
export function cleaningDaysOf(policy: HousingPolicy, type: HousingType): number {
  switch (type) {
    case "farrowing":
      return policy.farrowing.cleaningDays;
    case "weaner":
      return policy.weaner.cleaningDays;
    case "grower":
      return policy.grower.cleaningDays;
    case "finisher":
      return policy.finisher.cleaningDays;
    case "gestation":
      return policy.gestation.cleaningDays;
    case "gilt":
      return policy.gilt.cleaningDays;
    // A boar pen and a service place take one animal after another with no group
    // turnover, so there is no batch gap for them to stand empty through.
    case "boar":
    case "service_sow":
      return 0;
  }
}

/** The most head a pen of this type may hold before floor area is considered. */
export function headCapacityOf(policy: HousingPolicy, type: HousingType): number {
  switch (type) {
    case "boar":
    case "service_sow":
    case "farrowing":
      return 1;
    case "gestation":
      return policy.gestation.targetSowsPerPen;
    case "gilt":
      return policy.gilt.targetHeadPerPen;
    case "weaner":
      return policy.weaner.maxHeadPerPen;
    case "grower":
      return policy.grower.maxHeadPerPen;
    case "finisher":
      return policy.finisher.maxHeadPerPen;
  }
}

/** The head a pen of this type is aimed at filling, which is not always its most. */
export function targetHeadOf(policy: HousingPolicy, type: HousingType): number {
  switch (type) {
    case "weaner":
      return policy.weaner.targetHeadPerPen;
    case "grower":
      return policy.grower.targetHeadPerPen;
    case "finisher":
      return policy.finisher.targetHeadPerPen;
    default:
      return headCapacityOf(policy, type);
  }
}

/**
 * The floor area one pen of this type is built with.
 *
 * Fixed per type rather than per batch, because a pen is a thing that gets
 * built: it is poured to hold a full group of the stage at the weight that stage
 * leaves at, and the group that stands in it afterwards has to fit the pen
 * rather than the other way round. That is what lets floor area bind — a batch
 * heavier than the pen was sized for gets fewer places in it, not a bigger pen.
 */
export function penAreaOf(
  policy: HousingPolicy,
  type: HousingType,
  weights: StageExitWeights,
): number {
  switch (type) {
    case "boar":
      return policy.boar.penUsedForService
        ? policy.boar.servicePenAreaM2
        : policy.boar.housingOnlyAreaM2;
    case "service_sow":
      return policy.serviceSow.areaM2PerSow;
    case "gestation":
      return policy.gestation.targetSowsPerPen * policy.gestation.minAreaM2PerSow;
    case "farrowing":
      return policy.farrowing.penMinWidthM * policy.farrowing.penMinLengthM;
    case "gilt":
      return policy.gilt.targetHeadPerPen * policy.gilt.minAreaM2PerHead;
    case "weaner":
      return policy.weaner.targetHeadPerPen * policy.weaner.floorAreaM2PerHead;
    case "grower":
      return (
        policy.grower.targetHeadPerPen *
        floorAreaPerHead(policy.grower.floorAreaBands, weights.grower).m2PerHead
      );
    case "finisher":
      return (
        policy.finisher.targetHeadPerPen *
        floorAreaPerHead(policy.finisher.floorAreaBands, weights.finisher).m2PerHead
      );
  }
}

/**
 * Floor area one animal of this type needs at the weight it is carrying, and
 * whether the policy had a rule for a pig that size.
 *
 * Only the growing stages step with weight. A sow's place is a sow's place.
 */
export function areaPerHeadOf(
  policy: HousingPolicy,
  type: HousingType,
  weightKg: number,
): { m2PerHead: number; covered: boolean } {
  switch (type) {
    case "boar":
      return {
        m2PerHead: policy.boar.penUsedForService
          ? policy.boar.servicePenAreaM2
          : policy.boar.housingOnlyAreaM2,
        covered: true,
      };
    case "service_sow":
      return { m2PerHead: policy.serviceSow.areaM2PerSow, covered: true };
    case "gestation":
      return { m2PerHead: policy.gestation.minAreaM2PerSow, covered: true };
    case "farrowing":
      return {
        m2PerHead: policy.farrowing.penMinWidthM * policy.farrowing.penMinLengthM,
        covered: true,
      };
    case "gilt":
      return { m2PerHead: policy.gilt.minAreaM2PerHead, covered: true };
    case "weaner":
      return { m2PerHead: policy.weaner.floorAreaM2PerHead, covered: true };
    case "grower":
      return floorAreaPerHead(policy.grower.floorAreaBands, weightKg);
    case "finisher":
      return floorAreaPerHead(policy.finisher.floorAreaBands, weightKg);
  }
}
