import type { PlannerConfig } from "../../config";
import type { HousingNeedsResult, HousingTypeResult } from "../result";
import { HOUSING_LABELS, type BuildingType, type HousingType } from "../rules";
import {
  ALLOWED_STAGES,
  housingInputHash,
  PHYSICAL_HOUSING_GENERATOR_VERSION,
  type PhysicalBuilding,
  type PhysicalFarmPlan,
  type PhysicalPen,
  type PhysicalRoom,
} from "./model";

/**
 * Turning the housing plan into a farm.
 *
 * The needs planner answers in quantities: this house wants eleven pens, in
 * three rooms of four, and the third room is not wanted until the spring of
 * 2029. That is a specification, and a specification cannot hold a pig. This
 * writes it out as the thing it describes — named buildings, numbered rooms,
 * identified pens, each with the day it can first take animals — so that the
 * simulator has somewhere to put an animal rather than a number to compare a
 * count against.
 *
 * Nothing is decided here. Every pen count, room module, building grouping and
 * construction date is read straight off the planner's result; this is a
 * translation, and the only thing it adds is identity. That is the whole reason
 * it is worth separating: the layout is argued about in one place, and the farm
 * that layout becomes is written in another, so an id is never quietly the
 * reason a room came out a different size.
 */

/** The short code a house is known by. Chosen to be readable on a pen card. */
const BUILDING_CODES: Record<BuildingType, string> = {
  breeding_service: "BREED",
  gestation: "GEST",
  farrowing: "FARR",
  weaner: "WEAN",
  grower: "GROW",
  finisher: "FIN",
};

function pad(value: number, width = 2): string {
  return String(value).padStart(width, "0");
}

/**
 * When each room of a housing type has to be standing, one entry a room.
 *
 * Read off the construction phases the planner already worked out, because the
 * phases are where the argument about what can be postponed was had. A room
 * beyond the last phase — which should not happen, and would mean a module
 * rounded up after the phasing — is commissioned with the last phase rather
 * than being given a date of its own.
 */
function roomCommissioningDays(type: HousingTypeResult, firstDay: number): number[] {
  const days: number[] = [];
  for (const phase of type.phases) {
    for (let room = 0; room < phase.roomsAdded; room += 1) days.push(phase.buildByDay);
  }
  const rooms = type.room?.roomCount ?? days.length;
  const last = days[days.length - 1] ?? firstDay;
  while (days.length < rooms) days.push(last);
  return days;
}

/**
 * The saved farm this plan would be built as.
 *
 * Deterministic in every part: the same needs result always produces the same
 * ids, in the same order, with the same dates on them. That is what lets a
 * saved layout be compared with a regenerated one, and what stops a pen moving
 * from one room to another because two buildings happened to be counted in a
 * different order.
 */
export function physicalFarmPlanOf(
  housing: HousingNeedsResult,
  config: PlannerConfig,
  generatedAt: string = new Date().toISOString(),
): PhysicalFarmPlan {
  const byType = new Map<HousingType, HousingTypeResult>(
    housing.types.map((type) => [type.housingType, type]),
  );
  const commissioning = new Map<HousingType, number[]>();
  for (const type of housing.types) {
    commissioning.set(type.housingType, roomCommissioningDays(type, housing.firstDay));
  }

  /** Rooms of each housing type already written out, across every building. */
  const roomsWritten = new Map<HousingType, number>();
  const codesUsed = new Map<BuildingType, number>();
  const buildings: PhysicalBuilding[] = [];

  for (const building of housing.buildings) {
    const code = BUILDING_CODES[building.buildingType];
    const index = (codesUsed.get(building.buildingType) ?? 0) + 1;
    codesUsed.set(building.buildingType, index);
    const buildingId = code + "-" + pad(index);

    const rooms: PhysicalRoom[] = [];
    let roomNumber = 0;
    for (const section of building.sections) {
      const type = byType.get(section.housingType);
      const days = commissioning.get(section.housingType) ?? [];
      for (let room = 0; room < section.roomCount; room += 1) {
        roomNumber += 1;
        const roomId = buildingId + "-R" + pad(roomNumber);
        const written = roomsWritten.get(section.housingType) ?? 0;
        roomsWritten.set(section.housingType, written + 1);
        const commissionedDay = days[written] ?? housing.firstDay;

        const pens: PhysicalPen[] = [];
        for (let pen = 1; pen <= section.pensPerRoom; pen += 1) {
          pens.push({
            id: roomId + "-P" + pad(pen),
            roomId,
            name: "Pen " + pen,
            housingType: section.housingType,
            maxHead: Math.max(1, Math.round(type?.pen?.capacityHead ?? 1)),
            floorAreaM2: type?.pen?.areaM2 ?? 0,
            allowedStages: [...ALLOWED_STAGES[section.housingType]],
            commissionedDay,
          });
        }

        rooms.push({
          id: roomId,
          buildingId,
          name: "Room " + roomNumber,
          housingType: section.housingType,
          widthM: type?.room?.widthM ?? section.room.widthM,
          lengthM: type?.room?.lengthM ?? section.room.lengthM,
          commissionedDay,
          pens,
        });
      }
    }

    const kinds = new Set(rooms.map((room) => room.housingType));
    buildings.push({
      id: buildingId,
      name: building.label,
      // A house of one kind says which; the breeding house holds three and says
      // nothing, because naming one of them would be naming the wrong one.
      housingType: kinds.size === 1 ? [...kinds][0] : undefined,
      widthM: building.rectangle.widthM,
      lengthM: building.rectangle.lengthM,
      commissionedDay: rooms.reduce(
        (earliest, room) => Math.min(earliest, room.commissionedDay),
        rooms[0]?.commissionedDay ?? housing.firstDay,
      ),
      rooms,
    });
  }

  return {
    generatedFromInputHash: housingInputHash(config),
    generatedAt,
    generatorVersion: PHYSICAL_HOUSING_GENERATOR_VERSION,
    policySource: housing.policySource,
    buildings,
  };
}

/** A room heading a reader recognises: "Room 2 — Service & dry sow places". */
export function roomHeading(room: { name: string; housingType: HousingType }): string {
  return room.name + " — " + HOUSING_LABELS[room.housingType];
}
