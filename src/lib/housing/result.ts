import { addDays, format, parseISO } from "date-fns";

import type { PlannerConfig } from "../config";
import { VirtualPenAllocator, type HousingAllocation } from "./allocator";
import {
  analyzeHousingCapacity,
  constructionPhasesFor,
  reserveExplanation,
  reservePensFor,
  utilizationOf,
  type DemandSeries,
  type HousingCapacityFailure,
  type HousingConstructionPhase,
  type HousingUtilizationMetrics,
} from "./capacity";
import { housingDemandFor, type HousingHerdView } from "./demand";
import {
  ARC_HOUSING_POLICY,
  HOUSING_LABELS,
  HOUSING_TYPES,
  HOUSING_UNITS,
  stageExitWeights,
  topBandWeightKg,
  type BuildingType,
  type HousingPolicy,
  type HousingType,
  type RoomLayout,
  type StageExitWeights,
} from "./rules";
import {
  penGeometryFor,
  planStructures,
  type HousingBuilding,
  type HousingStructureCandidate,
  type StructureRequest,
} from "./structures";

/**
 * The housing plan, and the one object that puts it together.
 *
 * The phases run in the order they have to: the allocator says how many pens
 * must exist and on which mornings, the geometry says what one of them is, and
 * the structure generator says how they are grouped into rooms and buildings.
 * The same configuration, the same run and the same housing policy always
 * produce the same pens, rooms, buildings and dates.
 *
 * It is a reading of the simulation and never an input to it. No method here
 * touches an animal, and the plan can be left out entirely without a single
 * figure on the cashflow, the profit statement or the herd plan moving.
 *
 * What it is for is answering three questions a farmer actually asks. What is
 * the least I genuinely have to build? What can I put off, and until when? And
 * why this arrangement rather than another one? The first is the minimum kept
 * strictly apart from every margin on top of it, the second is the construction
 * phasing, and the third is the list of arrangements that were costed and
 * turned down.
 */

export type HousingWarning = {
  code:
    | "no-floor-area-rule"
    | "no-pen-geometry"
    | "no-room-template"
    | "room-over-preferred-aspect"
    | "poor-layout-efficiency"
    | "brief-peak"
    | "no-simulation-days";
  housingType?: HousingType;
  message: string;
};

/**
 * What the simulation required, and what is recommended on top of it, kept
 * apart.
 *
 * These are four different numbers and only one of them is a simulation result.
 * Rolled into one figure they compound — a margin on top of a margin on top of a
 * rounding — and the compound is invisible, which is how a house that has to
 * hold thirty-four pens ends up drawn with forty. Separated, a reader can build
 * the minimum, the minimum rounded to whole rooms, or the whole thing with its
 * reserve, and can see what each of the three costs.
 */
export type HousingCapacityAnalysis = {
  peakHead: number;

  peakOccupiedPens: number;
  peakCleaningPens: number;
  peakReservedPens: number;

  /** The most pens that had to exist at one time. Nothing may be built under it. */
  minimumPhysicalPens: number;

  /**
   * The operating margin, as pens. Under the default reserve mode this is what
   * the run itself justifies, and it is very often nothing at all.
   */
  optionalReservePens: number;

  /** The target rounded up to whole rooms of the chosen module. */
  moduleRoundedPens: number;

  /** What to build, which is the rounded figure. */
  recommendedPens: number;

  /** The day the pen requirement peaked: the day the house is sized on. */
  peakDay: number;
};

/** Every step between the simulation and the number on the card. */
export type HousingDerivation = {
  peakOccupiedPens: number;
  peakReservedPens: number;
  peakCleaningPens: number;
  minimumPens: number;
  reserveMode: HousingPolicy["structure"]["reserveMode"];
  reservePct: number;
  /** The pens the reserve comes to under the mode in force. */
  optionalReservePens: number;
  /** The same figure if a flat percentage were asked for instead. */
  percentageReservePens: number;
  /** The most pens one intake filled: the largest room that can be run in batches. */
  batchPens: number;
  recommendedPens: number;
  pensPerRoom: number;
  roomCount: number;
  /** What the rooms actually provide once the module has been rounded up to. */
  moduleCapacityPens: number;
  /** Pens the plan provides over the simulated minimum, all told. */
  sparePens: number;
  /** The same thing in words, for a reader who wants to check the arithmetic. */
  steps: string[];
};

export type HousingPenBox = {
  capacityHead: number;
  widthM: number;
  lengthM: number;
  areaM2: number;
  /** The animal floor the policy demands, before the box was squared off. */
  requiredAreaM2: number;
};

export type HousingRoomBox = {
  layout: RoomLayout;
  pensPerRoom: number;
  roomCount: number;
  widthM: number;
  lengthM: number;
  areaM2: number;
  /** Whether it stands across its building rather than along it. */
  rotated: boolean;
};

export type HousingTypeBuilding = {
  id: string;
  label: string;
  /** This type's rooms in that building, which may not be all of them. */
  roomCount: number;
  penCount: number;
  headCapacity: number;
  widthM: number;
  lengthM: number;
  areaM2: number;
};

/** One arrangement that was costed, whether or not it was the one chosen. */
export type HousingLayoutOption = {
  id: string;
  buildingType: BuildingType;
  /** "Recommended", "Alternative 1", "Alternative 2". */
  label: string;
  /** How this one differs, in the terms the choice was made in. */
  description: string;
  buildingCount: number;
  roomCount: number;
  totalPens: number;
  headCapacity: number;
  sparePens: number;
  footprintM2: number;
  unusedAreaM2: number;
  layoutEfficiencyPct: number;
  externalWallM: number;
  internalPartitionM: number;
  estimatedCostScore: number;
  chosen: boolean;
};

export type HousingTypeResult = {
  housingType: HousingType;
  label: string;
  unit: string;

  /** The day the pen requirement peaked, which is the day the house is sized on. */
  peakDay: number;
  peakDate: string;
  /** The most head this type ever had to hold, and the day it held them. */
  peakHead: number;
  peakHeadDay: number;
  peakHeadDate: string;

  minimumPens: number;
  /** What to build: the target rounded up to whole rooms. */
  recommendedPens: number;
  /** Pens the chosen room module actually provides. Never fewer than recommended. */
  moduleCapacityPens: number;
  /**
   * What the house would come to if the flat percentage reserve were taken
   * instead, rounded to the same module. The third of the three numbers a reader
   * is owed: the minimum, the recommendation, and the comfortable version.
   */
  reserveDesignPens: number;
  headCapacity: number;

  /** The minimum, the reserve and the rounding, told apart. */
  capacity: HousingCapacityAnalysis;
  /** How hard the recommended capacity gets worked over the run. */
  utilization: HousingUtilizationMetrics;
  /** What it would cost to build only the simulated minimum and no rounding. */
  minimumShortfall: HousingCapacityFailure;
  /** The building work, in the order it has to happen. */
  phases: HousingConstructionPhase[];
  /** One more room of the chosen module adds this many pens. */
  expansionStepPens: number;
  /** Why the reserve is the size it is, in one sentence. */
  reserveNote: string;

  /**
   * How well the buildings this housing sits in use their own rectangles, and
   * the floor left over inside them.
   *
   * Read off the buildings rather than off the rooms, so where a house is shared
   * — the boars, the service places and the gilts under one roof — all three
   * report the shared building's figure. That is the right answer to "how much
   * of my breeding house is actually pens?" and the wrong one to add up across
   * types, which is what the site totals are for.
   */
  layoutEfficiencyPct: number;
  unusedAreaM2: number;

  /**
   * Pens in use on every simulated day, from `firstDay` of the plan.
   *
   * Carried so that a question nobody has asked yet can still be answered off
   * the finished plan — what happens if only twenty-eight are built, how many
   * days a house sat full — without rerunning the farm to find out.
   */
  dailyPensInUse: number[];

  averageHeadHoused: number;
  averagePensInUse: number;

  pen: HousingPenBox | null;
  room: HousingRoomBox | null;
  buildings: HousingTypeBuilding[];

  derivation: HousingDerivation;
  sourceAssumptions: string[];
};

export type HousingNeedsResult = {
  /** Days of simulation the plan was read off. */
  generatedFromSimulationDayCount: number;
  firstDay: number;
  lastDay: number;
  policySource: string;
  types: HousingTypeResult[];
  buildings: HousingBuilding[];
  /** What was considered and what was chosen, for each building group. */
  layoutOptions: HousingLayoutOption[];
  /** Every phase of every house, in the order the work falls due. */
  phases: HousingConstructionPhase[];
  totals: {
    buildings: number;
    rooms: number;
    pens: number;
    headCapacity: number;
    /** Pen floor, added up over every pen the plan proposes building. */
    animalFloorAreaM2: number;
    /** The footprint the buildings occupy, passages and all. */
    estimatedStructureAreaM2: number;
    /** Footprint inside a building and inside no room. */
    unusedAreaM2: number;
    /** Room floor as a percentage of footprint, across the whole site. */
    layoutEfficiencyPct: number;
    /** What the chosen arrangement scored, on the policy's own weights. */
    estimatedCostScore: number;
  };
  /** Sucklers standing in the farrowing house with their dams at the busiest. */
  peakSucklingPiglets: number;
  warnings: HousingWarning[];
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** A pen count taken up to a whole number of rooms of the chosen module. */
function roundToModule(pens: number, pensPerRoom: number): number {
  if (pensPerRoom <= 0) return pens;
  return Math.ceil(pens / pensPerRoom) * pensPerRoom;
}

/** Below this, a building is mostly rectangle and not much room. */
const POOR_EFFICIENCY_PCT = 70;
/**
 * A house worked this lightly on an ordinary day, whose peak lasted no time at
 * all, was sized on something that barely happened. It is still sized correctly
 * — the pens were genuinely wanted that morning — but a reader deciding what to
 * build is owed the fact, because it is the one place in the plan where the
 * honest answer and the sensible answer can come apart.
 */
const BRIEF_PEAK_DAYS = 30;
const LIGHTLY_WORKED_PCT = 40;

/**
 * The housing planner.
 *
 * Fed one simulated day at a time, so that the plan is worked out from the daily
 * state that produces Herd Development rather than from Herd Development itself.
 * A month end can be true of both the month's ends and still miss the morning
 * seventeen sows wanted a farrowing place.
 */
export class HousingPlanner {
  readonly policy: HousingPolicy;
  private readonly config: PlannerConfig;
  private readonly weights: StageExitWeights;
  private readonly allocator: VirtualPenAllocator;

  constructor(config: PlannerConfig, policy: HousingPolicy = ARC_HOUSING_POLICY) {
    this.config = config;
    this.policy = policy;
    this.weights = stageExitWeights(config);
    this.allocator = new VirtualPenAllocator(policy, this.weights);
  }

  /** One morning of the plan, as the engine left it. */
  observe(day: number, herd: HousingHerdView): void {
    this.allocator.step(housingDemandFor(day, herd, this.policy, this.weights));
  }

  /** The finished plan. Safe to call more than once; it recomputes from the run. */
  plan(): HousingNeedsResult {
    return housingPlanOf(this.allocator.finish(), this.config, this.policy, this.weights);
  }
}

/** The day of the plan a day index falls on, for a report that shows dates. */
function dateOf(config: PlannerConfig, day: number): string {
  const start = parseISO(config.project.startDate);
  if (Number.isNaN(start.getTime())) return "";
  return format(addDays(start, Math.max(day, 0)), "yyyy-MM-dd");
}

/**
 * What a reader is owed for every figure: where it came from, and what was
 * assumed on the way. A recommendation with no derivation is a number to be
 * taken on trust, and nobody builds a shed on trust.
 */
function assumptionsFor(
  type: HousingType,
  policy: HousingPolicy,
  weights: StageExitWeights,
): string[] {
  const source = policy.source;
  const lines: string[] = [];
  switch (type) {
    case "boar":
      lines.push(
        policy.boar.penUsedForService
          ? `${source}: a boar pen used for service is at least ${policy.boar.servicePenAreaM2} m² with no side under ${policy.boar.serviceMinShortSideM} m.`
          : `${source}: a boar pen for housing only is at least ${policy.boar.housingOnlyAreaM2} m².`,
        "One boar to a pen. Pen count is the simulated boar team, not a ratio to sows.",
      );
      break;
    case "service_sow":
      lines.push(
        `${source}: individual sow pens of about ${policy.serviceSow.areaM2PerSow} m² in the service and boar house.`,
        "Places are the most sows ever open or being served on one day, not a share of the herd.",
        `Pigflow planning assumption: no sow pen shorter than ${policy.serviceSow.minLengthM} m on its long side.`,
      );
      break;
    case "gestation":
      lines.push(
        `${source}: sows in pig grouped by condition, about ${policy.gestation.targetSowsPerPen} to a pen at ${policy.gestation.minAreaM2PerSow} m² of floor a sow or more.`,
        "Group housing. Both the group size and the floor a sow are enforced, so whichever binds first decides the pen.",
      );
      break;
    case "farrowing":
      lines.push(
        `${source}: farrowing pens ${policy.farrowing.penMinWidthM}–${policy.farrowing.penMaxWidthM} m wide by ${policy.farrowing.penMinLengthM}–${policy.farrowing.penMaxLengthM} m long.`,
        `The sow is moved in ${policy.farrowing.preFarrowDays} days before she is due and the place stands ${policy.farrowing.cleaningDays} days between litters.`,
        "Lactation length is the plan's own weaning age, not a fixed 35 days. The requirement is the most overlapping reservations, which is more than the most sows suckling at once.",
      );
      break;
    case "gilt":
      lines.push(
        "Pigflow planning assumption: replacement gilts are group housed on the sow rule at a smaller body size — " +
          `${policy.gilt.targetHeadPerPen} to a pen at ${policy.gilt.minAreaM2PerHead} m² a head. The manual sets no separate gilt standard.`,
      );
      break;
    case "weaner":
      lines.push(
        `${source}: about two litters to a pen of roughly ${round2(policy.weaner.targetHeadPerPen * policy.weaner.floorAreaM2PerHead)} m², which is ${policy.weaner.floorAreaM2PerHead} m² a head, and ${policy.weaner.cleaningDays} days of cleaning and sterilising between groups.`,
        "Pigs are grouped by the day they were weaned, so a pen of weaners stays together into the grower house.",
      );
      break;
    case "grower":
      lines.push(
        `${source}: existing groups are kept together out of the weaner house; ${policy.grower.targetHeadPerPen} to a pen with ${policy.grower.cleaningDays} days of cleaning between groups.`,
        `Floor area stepped by liveweight, sized on ${weights.grower} kg — the weight a grower leaves this house at, not the weight it walks in at.`,
      );
      break;
    case "finisher":
      lines.push(
        `${source}: finishing pigs in groups of about ${policy.finisher.targetHeadPerPen} by bodyweight, with ${policy.finisher.cleaningDays} days of cleaning between groups.`,
        `Floor area stepped by liveweight, sized on ${weights.finisher} kg — the weight a finisher leaves at.`,
      );
      if (policy.finisher.separateSexes) {
        lines.push(`${source}: entire males are penned apart from females.`);
      }
      break;
  }
  lines.push(
    "Room size is capped at the largest intake the simulation ever made, so every room can be emptied, washed and refilled as one batch.",
    "Floor areas, group sizes, cleaning downtime and farrowing reservations are hard constraints. No arrangement that breaks one of them is ever costed, let alone chosen.",
  );
  return lines;
}

/** The plan, once the whole run has been through the allocator. */
export function housingPlanOf(
  allocation: HousingAllocation,
  config: PlannerConfig,
  policy: HousingPolicy,
  weights: StageExitWeights = stageExitWeights(config),
): HousingNeedsResult {
  const warnings: HousingWarning[] = [];
  const types: HousingTypeResult[] = [];

  if (allocation.days === 0) {
    warnings.push({
      code: "no-simulation-days",
      message: "No simulated days were observed, so there is nothing to house.",
    });
  }

  for (const [type, weightKg] of Object.entries(allocation.uncoveredWeightKg)) {
    if (weightKg === undefined) continue;
    const housingType = type as HousingType;
    const bands =
      housingType === "grower" ? policy.grower.floorAreaBands : policy.finisher.floorAreaBands;
    warnings.push({
      code: "no-floor-area-rule",
      housingType,
      message:
        `No housing floor-area rule configured for pigs above ${topBandWeightKg(bands)} kg. ` +
        `${HOUSING_LABELS[housingType]} were sized for pigs of up to ${round2(weightKg)} kg at the top band's rate, which is not an extrapolation and may be short.`,
    });
  }

  // What must exist, before anything is known about rooms. The minimum is the
  // simulation's own answer; the reserve is a separate decision taken next to it
  // and never folded into it.
  type Planned = {
    type: HousingType;
    totals: HousingAllocation["byType"][HousingType];
    geometry: ReturnType<typeof penGeometryFor>;
    series: DemandSeries;
    optionalReservePens: number;
    targetPens: number;
  };
  const planned: Planned[] = [];
  const requests: StructureRequest[] = [];

  for (const type of HOUSING_TYPES) {
    const totals = allocation.byType[type];
    if (totals.minimumPens <= 0) continue;

    const geometry = penGeometryFor(policy, type, weights, totals.penCapacityHead);
    if (geometry === null) {
      warnings.push({
        code: "no-pen-geometry",
        housingType: type,
        message: `No rectangle satisfies the ${HOUSING_LABELS[type].toLowerCase()} rules in ${policy.source}, so no pen, room or building dimensions were generated for them.`,
      });
    }

    const series: DemandSeries = {
      firstDay: allocation.firstDay,
      pensInUse: totals.dailyPensInUse,
    };
    const optionalReservePens = reservePensFor(series, totals.minimumPens, policy);
    const targetPens = totals.minimumPens + optionalReservePens;
    planned.push({ type, totals, geometry, series, optionalReservePens, targetPens });
    if (geometry !== null) {
      requests.push({
        housingType: type,
        pen: geometry.rectangle,
        penCapacityHead: totals.penCapacityHead,
        targetPens,
        batchPens: totals.batchPens,
      });
    }
  }

  // Rooms and buildings together, because they decide each other. See
  // planStructures: the room a house should be built to depends on what it
  // stands next to.
  const structurePlan = planStructures(requests, policy);
  const buildings = structurePlan.buildings;
  const layoutOptions = optionsOf(structurePlan.candidates);
  const phases: HousingConstructionPhase[] = [];

  for (const entry of planned) {
    const { type, totals, geometry, series, optionalReservePens, targetPens } = entry;
    const room = geometry === null ? null : (structurePlan.rooms.get(type) ?? null);

    if (geometry !== null && room === null) {
      warnings.push({
        code: "no-room-template",
        housingType: type,
        message: `No room template fits ${targetPens} ${HOUSING_UNITS[type]} of this kind without breaking a housing rule. Widen structure.minPensPerRoom and maxPensPerRoom, or the layouts allowed.`,
      });
    }
    if (room?.overPreferredAspectRatio === true) {
      warnings.push({
        code: "room-over-preferred-aspect",
        housingType: type,
        message: `The best ${HOUSING_LABELS[type].toLowerCase()} room comes out ${round2(room.aspectRatio)} times as long as it is wide, over the preferred limit of ${policy.structure.preferredRoomMaxAspectRatio}. No shorter layout was available.`,
      });
    }

    const moduleCapacityPens = room?.totalPens ?? targetPens;
    const headCapacity = moduleCapacityPens * totals.penCapacityHead;
    const utilization = utilizationOf(series, moduleCapacityPens);
    const typePhases =
      room === null
        ? []
        : constructionPhasesFor({
            housingType: type,
            series,
            pensPerRoom: room.pensPerRoom,
            roomCount: room.roomCount,
            policy,
            dateOf: (day) => dateOf(config, day),
          });
    phases.push(...typePhases);

    const percentageReservePens = Math.max(
      0,
      Math.ceil(totals.minimumPens * policy.structure.reservePct),
    );
    const steps = [
      `Peak simultaneous occupied ${HOUSING_UNITS[type]}: ${totals.peakOccupiedPens}`,
      `Peak ${HOUSING_UNITS[type]} held ahead of use, booked but not yet occupied: ${totals.peakReservedPens}`,
      `Peak ${HOUSING_UNITS[type]} unavailable for cleaning: ${totals.peakCleaningPens}`,
      `Minimum required by simulation: ${totals.minimumPens}, first reached ${dateOf(config, totals.peakPensDay)} and wanted on ${utilization.peakDurationDays} day${utilization.peakDurationDays === 1 ? "" : "s"} of ${allocation.days}`,
      reserveExplanation(series, totals.minimumPens, policy, HOUSING_UNITS[type]),
    ];
    if (room !== null) {
      steps.push(
        totals.batchPens > 0
          ? `Largest intake the run ever made: ${totals.batchPens} ${HOUSING_UNITS[type]}, which is the largest room this house can be run all in, all out with`
          : `Held continuously rather than in batches, so the batch rules no room size out`,
        `Chosen room module: ${room.pensPerRoom} ${HOUSING_UNITS[type]} / room, ${room.layout === "single_row" ? "single row" : "double row off a central passage"}${room.rotated ? ", standing across the building" : ""}`,
        `Recommended design capacity: ${room.roomCount} rooms × ${room.pensPerRoom} = ${moduleCapacityPens}`,
        `Expansion: one more room of the same module adds ${room.pensPerRoom} ${HOUSING_UNITS[type]}`,
      );
      if (typePhases.length > 1) {
        steps.push(
          `Built in ${typePhases.length} phases: ` +
            typePhases
              .map(
                (phase) =>
                  `${phase.resultingCapacity} by ${phase.buildByDate ?? "day " + phase.buildByDay}`,
              )
              .join(", "),
        );
      }
    }

    types.push({
      housingType: type,
      label: HOUSING_LABELS[type],
      unit: HOUSING_UNITS[type],
      peakDay: totals.peakPensDay,
      peakDate: dateOf(config, totals.peakPensDay),
      peakHead: totals.peakHead,
      peakHeadDay: totals.peakHeadDay,
      peakHeadDate: dateOf(config, totals.peakHeadDay),
      minimumPens: totals.minimumPens,
      recommendedPens: moduleCapacityPens,
      moduleCapacityPens,
      reserveDesignPens: roundToModule(
        totals.minimumPens + percentageReservePens,
        room?.pensPerRoom ?? 0,
      ),
      headCapacity,
      capacity: {
        peakHead: totals.peakHead,
        peakOccupiedPens: totals.peakOccupiedPens,
        peakCleaningPens: totals.peakCleaningPens,
        peakReservedPens: totals.peakReservedPens,
        minimumPhysicalPens: totals.minimumPens,
        optionalReservePens,
        moduleRoundedPens: moduleCapacityPens,
        recommendedPens: moduleCapacityPens,
        peakDay: totals.peakPensDay,
      },
      utilization,
      minimumShortfall: analyzeHousingCapacity(series, totals.minimumPens),
      phases: typePhases,
      expansionStepPens: room?.pensPerRoom ?? 0,
      reserveNote: reserveExplanation(series, totals.minimumPens, policy, HOUSING_UNITS[type]),
      layoutEfficiencyPct: 0,
      unusedAreaM2: 0,
      dailyPensInUse: [...totals.dailyPensInUse],
      averageHeadHoused: round2(totals.headDays / Math.max(allocation.days, 1)),
      averagePensInUse: round2(totals.penDaysInUse / Math.max(allocation.days, 1)),
      pen:
        geometry === null
          ? null
          : {
              capacityHead: totals.penCapacityHead,
              widthM: geometry.rectangle.widthM,
              lengthM: geometry.rectangle.lengthM,
              areaM2: geometry.rectangle.areaM2,
              requiredAreaM2: round2(geometry.requiredAreaM2),
            },
      room:
        room === null
          ? null
          : {
              layout: room.layout,
              pensPerRoom: room.pensPerRoom,
              roomCount: room.roomCount,
              widthM: room.rectangle.widthM,
              lengthM: room.rectangle.lengthM,
              areaM2: room.rectangle.areaM2,
              rotated: room.rotated,
            },
      buildings: [],
      derivation: {
        peakOccupiedPens: totals.peakOccupiedPens,
        peakReservedPens: totals.peakReservedPens,
        peakCleaningPens: totals.peakCleaningPens,
        minimumPens: totals.minimumPens,
        reserveMode: policy.structure.reserveMode,
        reservePct: policy.structure.reservePct,
        optionalReservePens,
        percentageReservePens,
        batchPens: totals.batchPens,
        recommendedPens: moduleCapacityPens,
        pensPerRoom: room?.pensPerRoom ?? 0,
        roomCount: room?.roomCount ?? 0,
        moduleCapacityPens,
        sparePens: moduleCapacityPens - totals.minimumPens,
        steps,
      },
      sourceAssumptions: assumptionsFor(type, policy, weights),
    });
  }

  // Three housing types share the breeding and service house, so a type is told
  // which buildings hold its rooms rather than being given buildings of its own.
  for (const result of types) {
    let footprint = 0;
    let roomFloor = 0;
    for (const building of buildings) {
      const section = building.sections.find(
        (entry) => entry.housingType === result.housingType,
      );
      if (!section) continue;
      result.buildings.push({
        id: building.id,
        label: building.label,
        roomCount: section.roomCount,
        penCount: section.penCount,
        headCapacity: section.headCapacity,
        widthM: building.rectangle.widthM,
        lengthM: building.rectangle.lengthM,
        areaM2: building.rectangle.areaM2,
      });
      footprint += building.rectangle.areaM2;
      roomFloor += building.roomAreaM2;
    }
    result.layoutEfficiencyPct = footprint > 0 ? round2((roomFloor / footprint) * 100) : 0;
    result.unusedAreaM2 = round2(Math.max(0, footprint - roomFloor));
  }

  for (const type of types) {
    const { utilization } = type;
    if (utilization.peakDurationDays > BRIEF_PEAK_DAYS) continue;
    if (utilization.averageOccupiedPct >= LIGHTLY_WORKED_PCT) continue;
    if (allocation.days <= BRIEF_PEAK_DAYS) continue;
    warnings.push({
      code: "brief-peak",
      housingType: type.housingType,
      message:
        `${type.label} are sized on ${type.minimumPens} ${type.unit} wanted on ${utilization.peakDurationDays} day${utilization.peakDurationDays === 1 ? "" : "s"} of ${allocation.days}, ` +
        `and stand ${round2(100 - utilization.averageOccupiedPct)}% empty on an ordinary day. The requirement is real and the capacity is not padded — but this is the part of the plan where a shorter peak would cost a good deal less to build.`,
    });
  }

  for (const building of buildings) {
    if (building.layoutEfficiencyPct >= POOR_EFFICIENCY_PCT) continue;
    warnings.push({
      code: "poor-layout-efficiency",
      message:
        `${building.label} uses ${building.layoutEfficiencyPct}% of its rectangle as rooms, leaving ${round2(building.unusedAreaM2)} m² of footprint inside the building and inside no room. ` +
        "Every room order, rotation and grouping allowed by the policy was costed and this was still the cheapest; widening the room modules or the layouts may do better.",
    });
  }

  const sum = (pick: (type: HousingTypeResult) => number) =>
    types.reduce((total, type) => total + pick(type), 0);
  const footprint = buildings.reduce((total, building) => total + building.rectangle.areaM2, 0);
  const roomFloor = buildings.reduce((total, building) => total + building.roomAreaM2, 0);

  // Every house's work, in the order it falls due rather than by housing type.
  phases.sort((a, b) => a.buildByDay - b.buildByDay || (a.housingType < b.housingType ? -1 : 1));

  return {
    generatedFromSimulationDayCount: allocation.days,
    firstDay: allocation.firstDay,
    lastDay: allocation.lastDay,
    policySource: policy.source,
    types,
    buildings,
    layoutOptions,
    phases,
    totals: {
      buildings: buildings.length,
      rooms: sum((type) => type.room?.roomCount ?? 0),
      pens: sum((type) => type.moduleCapacityPens),
      headCapacity: sum((type) => type.headCapacity),
      animalFloorAreaM2: round2(
        sum((type) => type.moduleCapacityPens * (type.pen?.areaM2 ?? 0)),
      ),
      estimatedStructureAreaM2: round2(footprint),
      unusedAreaM2: round2(Math.max(0, footprint - roomFloor)),
      layoutEfficiencyPct: footprint > 0 ? round2((roomFloor / footprint) * 100) : 0,
      estimatedCostScore: structurePlan.cost.score,
    },
    peakSucklingPiglets: allocation.peakSucklingPiglets,
    warnings,
  };
}

/**
 * What building only this many pens of one kind would have cost.
 *
 * The finished plan carries the daily requirement for every housing type, so the
 * question "what happens if I build twenty-eight finishing pens instead of
 * thirty-four?" can be asked of it afterwards without rerunning the farm. Null
 * when the plan has no such housing in it.
 *
 * Analysis only. It says which mornings the herd wanted more room than that and
 * by how much; it does not re-house anybody, and it is not a simulation of the
 * farm that actually did build twenty-eight.
 */
export function housingShortfallOf(
  result: HousingNeedsResult,
  housingType: HousingType,
  pens: number,
): HousingCapacityFailure | null {
  const type = result.types.find((entry) => entry.housingType === housingType);
  if (type === undefined) return null;
  return analyzeHousingCapacity(
    { firstDay: result.firstDay, pensInUse: type.dailyPensInUse },
    pens,
  );
}

/**
 * The arrangements that were costed, labelled as a reader would want them.
 *
 * The cheapest of each building group is the recommendation and the rest are the
 * alternatives, in the order they were beaten. Keeping them is the difference
 * between a plan that asserts a layout and one that can show what it turned
 * down and by how much.
 */
function optionsOf(candidates: readonly HousingStructureCandidate[]): HousingLayoutOption[] {
  const seen = new Map<BuildingType, number>();
  return candidates.map((candidate) => {
    const rank = seen.get(candidate.buildingType) ?? 0;
    seen.set(candidate.buildingType, rank + 1);
    return {
      id: candidate.id,
      buildingType: candidate.buildingType,
      label: rank === 0 ? "Recommended" : `Alternative ${rank}`,
      description: candidate.description,
      buildingCount: candidate.buildingCount,
      roomCount: candidate.cost.roomCount,
      totalPens: candidate.totalPens,
      headCapacity: candidate.headCapacity,
      sparePens: candidate.sparePens,
      footprintM2: candidate.totalBuildingAreaM2,
      unusedAreaM2: candidate.unusedAreaM2,
      layoutEfficiencyPct: candidate.layoutEfficiencyPct,
      externalWallM: candidate.externalWallLengthM,
      internalPartitionM: candidate.internalPartitionLengthM,
      estimatedCostScore: candidate.estimatedCostScore,
      chosen: rank === 0,
    };
  });
}
