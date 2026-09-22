import type { AnimalDeparture, Boar, GrowingPig, Sow } from "../sim/animals";
import {
  areaPerHeadOf,
  type HousingPolicy,
  type HousingType,
  type StageExitWeights,
} from "./rules";

/**
 * Turning a morning on the farm into a morning's housing demand.
 *
 * Nothing here decides anything about a pen. It reads the herd as the engine
 * left it at the close of a day and says what every animal standing on the place
 * would have to be standing in — which house, how heavy it is, and who it came
 * up with. The allocator then finds it somewhere.
 *
 * This is deliberately built from the daily herd rather than from the monthly
 * Herd Development roll-up. A month end can show twelve sows farrowing in
 * January and fourteen in February and be true of both days while seventeen
 * places were wanted on the 12th of February. Housing is sized on the worst
 * morning, not on the last one of the month.
 */

/** What the planner needs to know about one animal on one day. */
export type HousingAnimalSnapshot = {
  id: string;
  /**
   * The number on its ear, where it has one. Carried because a piglet names its
   * dam by tag rather than by id, and a suckler is housed wherever she is.
   */
  tag?: string;
  /** The dam's tag, for an animal that is still on her. */
  damTag?: string | null;
  kind: "sow" | "boar" | "gilt" | "pig";
  stage?: "piglet" | "weaner" | "grower" | "finisher";
  reproductiveState?: "open" | "gestating" | "lactating";
  weightKg: number;
  ageDays: number;
  /** The group this animal came up with, which is what keeps a pen together. */
  cohortId?: string;
  expectedFarrowDay?: number;
  expectedWeanDay?: number;
  /**
   * The day she is due to be scanned, or absent once she has been.
   *
   * What tells a served sow from a confirmed one, which is a housing question
   * and not only a veterinary one: until the scan says she is in pig she stays
   * where she was served. The farm's own date rather than a housing rule of
   * thumb, so a unit that scans at three weeks moves her at three weeks.
   */
  expectedScanDay?: number;
  sex?: "male" | "female";
};

/**
 * An animal that left the farm at the close of the day just simulated.
 *
 * Both engines drop their dead, sold and culled animals at the end of the day
 * they leave on, so an observer that only sees the herd afterwards knows that
 * somebody has gone and not why. This is the engines saying why, and it is read
 * by the physical housing allocator to tell a sale from a death: both empty a
 * pen, and a plan that could not tell them apart would be no use to anybody
 * reading it afterwards.
 */
export type HerdDeparture = AnimalDeparture;

/** The herd as the planner reads it. Both engines hand over exactly this. */
export type HousingHerdView = {
  readonly sows: readonly Sow[];
  readonly boars: readonly Boar[];
  readonly pigs: readonly GrowingPig[];
  /** Who left the farm on the day just closed, and how. */
  readonly departures?: readonly HerdDeparture[];
};

/**
 * The cohort a growing pig belongs to: everything weaned on the same morning.
 *
 * A litter is about ten pigs and a weaner pen holds twenty, so a litter is the
 * wrong unit — the manual itself puts two litters in a pen. The weaning day is
 * the right one: it is the group that leaves the farrowing house together, and
 * it is stable for the rest of the pig's life, so a pen of weaners becomes a pen
 * of growers and then two pens of finishers without anybody being shuffled.
 */
export function cohortIdOf(pig: GrowingPig): string {
  return pig.weanedOnDay === null ? "B" + pig.birthDay : "W" + pig.weanedOnDay;
}

/**
 * Every animal on the farm on one day, in the terms housing is decided in.
 *
 * Read off the engine's own animals rather than recomputed: a planner that
 * worked out a sow's farrowing date for itself would be a second reproduction
 * model, and the first thing two models do is disagree.
 */
export function housingSnapshots(day: number, herd: HousingHerdView): HousingAnimalSnapshot[] {
  const animals: HousingAnimalSnapshot[] = [];
  for (const sow of herd.sows) {
    if (!sow.alive) continue;
    animals.push({
      id: sow.id,
      tag: sow.tag,
      kind: "sow",
      reproductiveState: sow.state,
      weightKg: sow.weightKg,
      ageDays: sow.ageDays(day),
      sex: "female",
      expectedFarrowDay: sow.dueDay ?? undefined,
      expectedWeanDay: sow.weanDay ?? undefined,
      expectedScanDay: sow.scanDay ?? undefined,
    });
  }
  for (const boar of herd.boars) {
    if (!boar.alive) continue;
    animals.push({
      id: boar.id,
      tag: boar.tag,
      kind: "boar",
      weightKg: boar.weightKg,
      ageDays: boar.ageDays(day),
      sex: "male",
    });
  }
  for (const pig of herd.pigs) {
    if (!pig.alive) continue;
    animals.push({
      id: pig.id,
      tag: pig.tag,
      damTag: pig.damTag,
      kind: pig.stage === "gilt" ? "gilt" : "pig",
      stage: pig.stage === "gilt" ? undefined : pig.stage,
      weightKg: pig.weightKg,
      ageDays: pig.ageDays(day),
      cohortId: cohortIdOf(pig),
      sex: pig.sex,
    });
  }
  return animals;
}

/** One animal wanting one place, and what that place has to be compatible with. */
export type HousingOccupant = {
  animalId: string;
  housingType: HousingType;
  /** The group this animal should stay with, where it has one. */
  cohortId: string;
  /**
   * The heaviest this animal is expected to be while it is in the pen. Not the
   * weight it walks in at: a pen sized on arrival weight is too small before the
   * batch leaves it.
   */
  governingWeightKg: number;
  /**
   * What this occupant can share a pen with — the house, the floor-area band its
   * weight falls in and, where the policy separates them, its sex. Two occupants
   * with different keys are never put in one pen.
   */
  compatibility: string;
  /**
   * A place held for an animal that is not in it yet: a sow booked into the
   * farrowing house the week before she is due. It is occupied for every purpose
   * that matters to a building, which is why it is counted as one.
   */
  reserved: boolean;
};

/** A day of housing demand, ready for the allocator. */
export type HousingDemandDay = {
  day: number;
  occupants: HousingOccupant[];
  /** Head wanting each kind of accommodation this morning. */
  head: Record<HousingType, number>;
  /** Sucklers, which stand in their dam's farrowing place and take none of their own. */
  sucklingPiglets: number;
  /**
   * The heaviest pig of each growing stage the policy had no floor-area rule
   * for. Absent when every pig was inside the configured bands.
   */
  uncoveredWeightKg: Partial<Record<HousingType, number>>;
};

function zeroHead(): Record<HousingType, number> {
  return {
    boar: 0,
    service_sow: 0,
    gestation: 0,
    farrowing: 0,
    gilt: 0,
    weaner: 0,
    grower: 0,
    finisher: 0,
  };
}

/**
 * Which house a sow is standing in this morning.
 *
 * She is in the farrowing house from a week before she is due — the manual's
 * own recommendation, and a configured number here — until her litter is off
 * her. Before that she is in gestation if she is carrying and in the service
 * house if she is not, which covers a sow waiting for her first heat after
 * weaning, one that returned, and one being served.
 *
 * A served sow is not a sow in pig. She stays in the service house until the
 * scan says she is carrying, which is the manual's own practice and the farm's
 * too: a sow that returns does it inside the first three weeks, and she returns
 * where the boar is and where somebody is watching for it. Moving her into the
 * gestation house on the day she is served would fill that house with sows who
 * are not in pig, and empty the service house of the ones most worth watching.
 *
 * The date comes off her own card rather than out of a housing rule, so a unit
 * that scans at three weeks moves her at three weeks and one that scans at five
 * moves her at five.
 */
function sowHousing(
  animal: HousingAnimalSnapshot,
  day: number,
  policy: HousingPolicy,
): { type: HousingType; reserved: boolean } {
  if (animal.reproductiveState === "lactating") return { type: "farrowing", reserved: false };
  if (animal.reproductiveState === "gestating") {
    const due = animal.expectedFarrowDay;
    if (due !== undefined && day >= due - policy.farrowing.preFarrowDays) {
      return { type: "farrowing", reserved: true };
    }
    // Carrying, but not yet confirmed to be: still in the service house.
    const scan = animal.expectedScanDay;
    if (scan !== undefined && day < scan) return { type: "service_sow", reserved: false };
    return { type: "gestation", reserved: false };
  }
  return { type: "service_sow", reserved: false };
}

/** The house a growing pig's stage puts it in, or null for one still on the sow. */
function pigHousing(stage: HousingAnimalSnapshot["stage"]): HousingType | null {
  switch (stage) {
    case "weaner":
      return "weaner";
    case "grower":
      return "grower";
    case "finisher":
      return "finisher";
    default:
      // A suckler lives in its dam's farrowing pen and is counted with her.
      return null;
  }
}

/**
 * The day's demand, animal by animal.
 *
 * Every live animal produces exactly one occupant or none, and none is only ever
 * a piglet on the sow. That is the invariant the whole plan rests on: no animal
 * is housed twice and nothing that needs housing is missed.
 */
export function housingDemandOf(
  day: number,
  animals: readonly HousingAnimalSnapshot[],
  policy: HousingPolicy,
  weights: StageExitWeights,
): HousingDemandDay {
  const occupants: HousingOccupant[] = [];
  const head = zeroHead();
  const uncovered: Partial<Record<HousingType, number>> = {};
  let sucklingPiglets = 0;

  const add = (
    animal: HousingAnimalSnapshot,
    type: HousingType,
    governingWeightKg: number,
    reserved: boolean,
    cohortId: string,
  ) => {
    const area = areaPerHeadOf(policy, type, governingWeightKg);
    if (!area.covered) {
      uncovered[type] = Math.max(uncovered[type] ?? 0, governingWeightKg);
    }
    const sexClass =
      type === "finisher" && policy.finisher.separateSexes ? (animal.sex ?? "mixed") : "";
    occupants.push({
      animalId: animal.id,
      housingType: type,
      cohortId,
      governingWeightKg,
      compatibility: type + "|" + area.m2PerHead + "|" + sexClass,
      reserved,
    });
    head[type] += 1;
  };

  for (const animal of animals) {
    if (animal.kind === "sow") {
      const { type, reserved } = sowHousing(animal, day, policy);
      // Sows are interchangeable within a group pen, so they carry no cohort of
      // their own; the pen they join is whichever has room for one more.
      add(animal, type, animal.weightKg, reserved, "");
      continue;
    }
    if (animal.kind === "boar") {
      // A boar has a pen to himself, so he is his own cohort.
      add(animal, "boar", animal.weightKg, false, animal.id);
      continue;
    }
    if (animal.kind === "gilt") {
      add(animal, "gilt", animal.weightKg, false, animal.cohortId ?? "");
      continue;
    }
    const type = pigHousing(animal.stage);
    if (type === null) {
      sucklingPiglets += 1;
      continue;
    }
    const exit =
      type === "weaner" ? weights.weaner : type === "grower" ? weights.grower : weights.finisher;
    add(animal, type, Math.max(animal.weightKg, exit), false, animal.cohortId ?? "");
  }

  return { day, occupants, head, sucklingPiglets, uncoveredWeightKg: uncovered };
}

/** The demand of one day, straight from the herd. */
export function housingDemandFor(
  day: number,
  herd: HousingHerdView,
  policy: HousingPolicy,
  weights: StageExitWeights,
): HousingDemandDay {
  return housingDemandOf(day, housingSnapshots(day, herd), policy, weights);
}
