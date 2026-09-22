import { z } from "zod";

import type { PlannerConfig } from "../../config";
import type { HousingType } from "../rules";

/**
 * The farm as a place rather than as a requirement.
 *
 * Everything else under `lib/housing` answers "what would this herd have to be
 * housed in?". This answers "what is actually built?", and it is the difference
 * between a plan and a farm: a building here has a name, a room has a date it
 * can first take animals, and a pen has an identity that outlives the run that
 * proposed it. The simulator puts pigs in these.
 *
 * It is deliberately a dumb record. Nothing in this file simulates, allocates or
 * decides; it is the shape that is saved into a plan, the rules for reading one,
 * and the arithmetic — counts, differences, a hash of the inputs it was drawn
 * from — that a page needs before any farm has been run. That is also why it
 * imports nothing at run time but zod: the plan's own config schema carries it,
 * so anything this reached for would be reached for by every page of the
 * product.
 */

/**
 * What an occupant is, in the terms a pen is allowed to hold them.
 *
 * `PigStage` on its own is not enough. A sow is not a stage of a growing pig,
 * and where she stands depends on where she is in her cycle rather than on what
 * she weighs: the same animal belongs in the service house, the gestation house
 * and the farrowing house at three points of the same year. So the breeding
 * herd's states are stages here alongside the growout's.
 */
export type HousedStage =
  | "boar"
  | "open-sow"
  | "gestating-sow"
  | "lactating-sow"
  | "gilt"
  | "piglet"
  | "weaner"
  | "grower"
  | "finisher";

/**
 * Which occupants each kind of pen may hold.
 *
 * The farrowing pen is the only one that holds two kinds at once, and it holds
 * them for the reason a farrowing pen exists: the sow is moved in before she is
 * due — carrying, so still gestating — and her litter is born into the pen she
 * is standing in and stays in it until it is weaned off her.
 */
export const ALLOWED_STAGES: Record<HousingType, readonly HousedStage[]> = {
  boar: ["boar"],
  service_sow: ["open-sow"],
  gestation: ["gestating-sow"],
  farrowing: ["gestating-sow", "lactating-sow", "piglet"],
  gilt: ["gilt"],
  weaner: ["weaner"],
  grower: ["grower"],
  finisher: ["finisher"],
};

/** Whether a pen of this kind may hold an occupant of that kind. */
export function penAccepts(housingType: HousingType, stage: HousedStage): boolean {
  return ALLOWED_STAGES[housingType].includes(stage);
}

// ------------------------------------------------------------------ the model

const housingTypeSchema = z.enum([
  "boar",
  "service_sow",
  "gestation",
  "farrowing",
  "gilt",
  "weaner",
  "grower",
  "finisher",
]);

const housedStageSchema = z.enum([
  "boar",
  "open-sow",
  "gestating-sow",
  "lactating-sow",
  "gilt",
  "piglet",
  "weaner",
  "grower",
  "finisher",
]);

const nonNegative = z.number().finite().min(0);

export const physicalPenSchema = z.object({
  id: z.string().min(1).max(60),
  roomId: z.string().min(1).max(60),
  name: z.string().min(1).max(60),
  housingType: housingTypeSchema,
  /** Head this pen may hold, whatever its floor would otherwise allow. */
  maxHead: z.number().int().min(1).max(10_000),
  floorAreaM2: nonNegative,
  allowedStages: z.array(housedStageSchema).min(1).max(9),
  /** The first day animals may stand in it. Nothing goes in it before. */
  commissionedDay: z.number().int().min(0).max(200_000),
});

export const physicalRoomSchema = z.object({
  id: z.string().min(1).max(60),
  buildingId: z.string().min(1).max(60),
  name: z.string().min(1).max(60),
  housingType: housingTypeSchema,
  lengthM: nonNegative,
  widthM: nonNegative,
  commissionedDay: z.number().int().min(0).max(200_000),
  pens: z.array(physicalPenSchema).max(400),
});

export const physicalBuildingSchema = z.object({
  id: z.string().min(1).max(60),
  name: z.string().min(1).max(80),
  /** Absent on a building that holds rooms of more than one kind. */
  housingType: housingTypeSchema.optional(),
  lengthM: nonNegative,
  widthM: nonNegative,
  commissionedDay: z.number().int().min(0).max(200_000),
  rooms: z.array(physicalRoomSchema).max(60),
});

export const physicalFarmPlanSchema = z.object({
  /**
   * The inputs this layout was generated from, as a hash. What makes the
   * staleness notice a fact rather than a guess: housing is generated on
   * purpose and never behind the user's back, so the only honest thing to do
   * when the herd changes underneath it is to say so.
   */
  generatedFromInputHash: z.string().max(64).optional(),
  generatedAt: z.string().max(40).optional(),
  generatorVersion: z.string().max(40).optional(),
  /** The housing profile the pens were sized against, for the read-outs. */
  policySource: z.string().max(120).optional(),
  buildings: z.array(physicalBuildingSchema).max(100),
});

export type PhysicalPen = z.infer<typeof physicalPenSchema>;
export type PhysicalRoom = z.infer<typeof physicalRoomSchema>;
export type PhysicalBuilding = z.infer<typeof physicalBuildingSchema>;
export type PhysicalFarmPlan = z.infer<typeof physicalFarmPlanSchema>;

/** Where one occupant is standing, in full. */
export type PhysicalLocation = {
  buildingId: string;
  roomId: string;
  penId: string;
};

/**
 * The generator's own version.
 *
 * Bumped whenever a change would make the same inputs produce a different
 * layout, so that a saved plan can say which generator drew it rather than
 * being silently compared against rules it was never drawn under.
 */
export const PHYSICAL_HOUSING_GENERATOR_VERSION = "1.0.0";

// ---------------------------------------------------------------- reading one

/** Every pen in the plan, in the order the buildings and rooms are laid out. */
export function allPens(plan: PhysicalFarmPlan): PhysicalPen[] {
  const pens: PhysicalPen[] = [];
  for (const building of plan.buildings) {
    for (const room of building.rooms) pens.push(...room.pens);
  }
  return pens;
}

export function allRooms(plan: PhysicalFarmPlan): PhysicalRoom[] {
  return plan.buildings.flatMap((building) => building.rooms);
}

/** Where a pen sits, by pen id, so a location can be written from a pen alone. */
export function locationsOf(plan: PhysicalFarmPlan): Map<string, PhysicalLocation> {
  const locations = new Map<string, PhysicalLocation>();
  for (const building of plan.buildings) {
    for (const room of building.rooms) {
      for (const pen of room.pens) {
        locations.set(pen.id, { buildingId: building.id, roomId: room.id, penId: pen.id });
      }
    }
  }
  return locations;
}

export type PhysicalPlanTotals = {
  buildings: number;
  rooms: number;
  pens: number;
  /** Design head capacity, all told and by housing type. */
  headCapacity: number;
  headCapacityByType: Partial<Record<HousingType, number>>;
  pensByType: Partial<Record<HousingType, number>>;
  floorAreaM2: number;
  /** Distinct commissioning dates: the construction programme, as day indexes. */
  commissioningDays: number[];
};

export function planTotals(plan: PhysicalFarmPlan | null | undefined): PhysicalPlanTotals {
  const totals: PhysicalPlanTotals = {
    buildings: 0,
    rooms: 0,
    pens: 0,
    headCapacity: 0,
    headCapacityByType: {},
    pensByType: {},
    floorAreaM2: 0,
    commissioningDays: [],
  };
  if (!plan) return totals;
  const days = new Set<number>();
  for (const building of plan.buildings) {
    totals.buildings += 1;
    for (const room of building.rooms) {
      totals.rooms += 1;
      days.add(room.commissionedDay);
      for (const pen of room.pens) {
        totals.pens += 1;
        totals.headCapacity += pen.maxHead;
        totals.headCapacityByType[pen.housingType] =
          (totals.headCapacityByType[pen.housingType] ?? 0) + pen.maxHead;
        totals.pensByType[pen.housingType] = (totals.pensByType[pen.housingType] ?? 0) + 1;
        totals.floorAreaM2 += pen.floorAreaM2;
      }
    }
  }
  totals.floorAreaM2 = Math.round(totals.floorAreaM2 * 100) / 100;
  totals.commissioningDays = [...days].sort((a, b) => a - b);
  return totals;
}

/** What regenerating would change, in the numbers a reader checks first. */
export type PhysicalPlanDiff = {
  buildings: { from: number; to: number };
  rooms: { from: number; to: number };
  pens: { from: number; to: number };
  headCapacity: { from: number; to: number };
  /** Pen ids in one plan and not the other: what regenerating would rename. */
  penIdsAdded: string[];
  penIdsRemoved: string[];
};

export function planDiff(
  before: PhysicalFarmPlan | null | undefined,
  after: PhysicalFarmPlan,
): PhysicalPlanDiff {
  const from = planTotals(before);
  const to = planTotals(after);
  const beforeIds = new Set(before ? allPens(before).map((pen) => pen.id) : []);
  const afterIds = new Set(allPens(after).map((pen) => pen.id));
  return {
    buildings: { from: from.buildings, to: to.buildings },
    rooms: { from: from.rooms, to: to.rooms },
    pens: { from: from.pens, to: to.pens },
    headCapacity: { from: from.headCapacity, to: to.headCapacity },
    penIdsAdded: [...afterIds].filter((id) => !beforeIds.has(id)).sort(),
    penIdsRemoved: [...beforeIds].filter((id) => !afterIds.has(id)).sort(),
  };
}

// ---------------------------------------------------------------- staleness

/**
 * The parts of a plan that decide what has to be housed.
 *
 * Housing is generated from a run of the farm, so anything that changes the
 * herd changes the housing: how long the plan runs, what it starts with, how
 * the sows breed, how the pigs grow, what they are fed and what they die of.
 * What is left out is left out on purpose — money does not move an animal, so
 * changing a feed price, a sale price or the opening cash does not make a
 * building wrong, and a notice that cried stale at every edit would be ignored
 * within a day.
 */
const DEMAND_SECTIONS = [
  "project",
  "stock",
  "herd",
  "reproduction",
  "service",
  "growth",
  "feed",
  "health",
] as const;

/** Keys inside those sections that name or price rather than describe. */
const IGNORED_KEYS = new Set(["name", "currency"]);

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return "[" + value.map(stableJson).join(",") + "]";
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !IGNORED_KEYS.has(key))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return (
    "{" +
    entries.map(([key, item]) => JSON.stringify(key) + ":" + stableJson(item)).join(",") +
    "}"
  );
}

/** FNV-1a: short, stable across runs and machines, and not a secret. */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * A short, stable fingerprint of everything the housing was generated from.
 *
 * The housing inputs themselves are deliberately in it — the bedding and the
 * legacy places are not what a house is sized on, but the crowding rules read
 * them, and crowding changes how fast a pig grows, which changes how long it
 * stands in a pen. What is never in it is the generated layout, or the notice
 * would go stale the moment it was answered.
 */
export function housingInputHash(config: PlannerConfig): string {
  const parts: string[] = [];
  for (const section of DEMAND_SECTIONS) {
    parts.push(section + "=" + stableJson(config[section]));
  }
  const housing = { ...config.housing } as Record<string, unknown>;
  delete housing.physical;
  parts.push("housing=" + stableJson(housing));
  return fnv1a(parts.join("|"));
}

/** Whether the saved layout was drawn from the plan as it now stands. */
export function housingIsStale(config: PlannerConfig): boolean {
  const plan = config.housing.physical;
  if (!plan) return false;
  if (plan.generatorVersion !== PHYSICAL_HOUSING_GENERATOR_VERSION) return true;
  if (!plan.generatedFromInputHash) return true;
  return plan.generatedFromInputHash !== housingInputHash(config);
}

/** Whether this plan has physical housing at all. */
export function hasPhysicalHousing(config: PlannerConfig): boolean {
  const plan = config.housing.physical;
  return plan !== undefined && plan.buildings.length > 0;
}
