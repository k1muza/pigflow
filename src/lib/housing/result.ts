import { addDays, format, parseISO } from "date-fns";

import type { PlannerConfig } from "../config";
import { VirtualPenAllocator, type HousingAllocation } from "./allocator";
import { housingDemandFor, type HousingHerdView } from "./demand";
import {
  ARC_HOUSING_POLICY,
  HOUSING_LABELS,
  HOUSING_TYPES,
  HOUSING_UNITS,
  stageExitWeights,
  topBandWeightKg,
  type HousingPolicy,
  type HousingType,
  type RoomLayout,
  type StageExitWeights,
} from "./rules";
import {
  buildingsFor,
  chooseRoom,
  penGeometryFor,
  type HousingBuilding,
  type TypeStructure,
} from "./structures";

/**
 * The housing plan, and the one object that puts it together.
 *
 * The four phases run in the order they have to: the allocator says how many
 * pens must exist, the geometry says what one of them is, the room generator
 * says how they are grouped and the building generator says how many sheds that
 * comes to. Nothing later feeds back into anything earlier, which is what makes
 * the plan reproducible — the same configuration, the same run and the same
 * housing policy always produce the same pens, rooms, buildings and dates.
 *
 * It is a reading of the simulation and never an input to it. No method here
 * touches an animal, and the plan can be left out entirely without a single
 * figure on the cashflow, the profit statement or the herd plan moving.
 */

export type HousingWarning = {
  code:
    | "no-floor-area-rule"
    | "no-pen-geometry"
    | "no-room-template"
    | "room-over-preferred-aspect"
    | "no-simulation-days";
  housingType?: HousingType;
  message: string;
};

/** Every step between the simulation and the number on the card. */
export type HousingDerivation = {
  peakOccupiedPens: number;
  peakReservedPens: number;
  peakCleaningPens: number;
  minimumPens: number;
  reservePct: number;
  recommendedPens: number;
  pensPerRoom: number;
  roomCount: number;
  /** What the rooms actually provide once the module has been rounded up to. */
  moduleCapacityPens: number;
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
  recommendedPens: number;
  /** Pens the chosen room module actually provides. Never fewer than recommended. */
  moduleCapacityPens: number;
  headCapacity: number;

  /**
   * Head standing in this housing on an ordinary day of the plan, and pens in
   * use on one.
   *
   * A shed is sized on the worst morning and lived in on all the others, so the
   * gap between these and the peaks is the part of the building that is empty
   * most of the time. It is worth seeing before anybody pours a floor: it is
   * either the price of a batch system, or a sign the herd flow is lumpier than
   * it needs to be.
   */
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
  totals: {
    buildings: number;
    rooms: number;
    pens: number;
    headCapacity: number;
    /** Pen floor, added up over every pen the plan proposes building. */
    animalFloorAreaM2: number;
    /** The footprint the buildings occupy, passages and all. */
    estimatedStructureAreaM2: number;
  };
  /** Sucklers standing in the farrowing house with their dams at the busiest. */
  peakSucklingPiglets: number;
  warnings: HousingWarning[];
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

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
    `An operational reserve of ${Math.round(policy.structure.reservePct * 100)}% is added to the simulated minimum, then rounded up to a whole room module.`,
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
  const structures: TypeStructure[] = [];

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

    const recommendedPens = Math.max(
      totals.minimumPens,
      Math.ceil(totals.minimumPens * (1 + policy.structure.reservePct)),
    );
    const room = geometry === null ? null : chooseRoom(geometry.rectangle, recommendedPens, policy);
    if (geometry !== null && room === null) {
      warnings.push({
        code: "no-room-template",
        housingType: type,
        message: `No room template fits ${recommendedPens} ${HOUSING_UNITS[type]} of this kind. Widen structure.pensPerRoomOptions or the layouts allowed.`,
      });
    }
    if (room?.overPreferredAspectRatio === true) {
      warnings.push({
        code: "room-over-preferred-aspect",
        housingType: type,
        message: `The best ${HOUSING_LABELS[type].toLowerCase()} room comes out ${round2(room.aspectRatio)} times as long as it is wide, over the preferred limit of ${policy.structure.preferredRoomMaxAspectRatio}. No shorter layout was available.`,
      });
    }

    const moduleCapacityPens = room?.totalPens ?? recommendedPens;
    const headCapacity = moduleCapacityPens * totals.penCapacityHead;

    if (room !== null && geometry !== null) {
      structures.push({
        housingType: type,
        layout: room.layout,
        roomCount: room.roomCount,
        pensPerRoom: room.pensPerRoom,
        penCapacityHead: totals.penCapacityHead,
        room: room.rectangle,
      });
    }

    const reservePct = policy.structure.reservePct;
    const steps = [
      `Peak simultaneous occupied ${HOUSING_UNITS[type]}: ${totals.peakOccupiedPens}`,
      `Peak ${HOUSING_UNITS[type]} held in reserve: ${totals.peakReservedPens}`,
      `Peak ${HOUSING_UNITS[type]} unavailable for cleaning: ${totals.peakCleaningPens}`,
      `Minimum physical requirement: ${totals.minimumPens}`,
      `${Math.round(reservePct * 100)}% operational reserve: ${totals.minimumPens} × ${round2(1 + reservePct)} = ${round2(totals.minimumPens * (1 + reservePct))} → ${recommendedPens}`,
    ];
    if (room !== null) {
      steps.push(
        `Chosen room module: ${room.pensPerRoom} ${HOUSING_UNITS[type]} / room, ${room.layout === "single_row" ? "single row" : "double row off a central passage"}`,
        `Rounded module capacity: ${room.roomCount} rooms × ${room.pensPerRoom} = ${moduleCapacityPens}`,
      );
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
      recommendedPens,
      moduleCapacityPens,
      headCapacity,
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
            },
      buildings: [],
      derivation: {
        peakOccupiedPens: totals.peakOccupiedPens,
        peakReservedPens: totals.peakReservedPens,
        peakCleaningPens: totals.peakCleaningPens,
        minimumPens: totals.minimumPens,
        reservePct,
        recommendedPens,
        pensPerRoom: room?.pensPerRoom ?? 0,
        roomCount: room?.roomCount ?? 0,
        moduleCapacityPens,
        steps,
      },
      sourceAssumptions: assumptionsFor(type, policy, weights),
    });
  }

  const buildings = buildingsFor(structures, policy);

  // Three housing types share the breeding and service house, so a type is told
  // which buildings hold its rooms rather than being given buildings of its own.
  for (const result of types) {
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
    }
  }

  const sum = (pick: (type: HousingTypeResult) => number) =>
    types.reduce((total, type) => total + pick(type), 0);

  return {
    generatedFromSimulationDayCount: allocation.days,
    firstDay: allocation.firstDay,
    lastDay: allocation.lastDay,
    policySource: policy.source,
    types,
    buildings,
    totals: {
      buildings: buildings.length,
      rooms: sum((type) => type.room?.roomCount ?? 0),
      pens: sum((type) => type.moduleCapacityPens),
      headCapacity: sum((type) => type.headCapacity),
      animalFloorAreaM2: round2(
        sum((type) => type.moduleCapacityPens * (type.pen?.areaM2 ?? 0)),
      ),
      estimatedStructureAreaM2: round2(
        buildings.reduce((total, building) => total + building.rectangle.areaM2, 0),
      ),
    },
    peakSucklingPiglets: allocation.peakSucklingPiglets,
    warnings,
  };
}
