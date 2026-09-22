import { describe, expect, it } from "vitest";

import { cloneDefaultConfig, withConfigDefaults, type PlannerConfig } from "../../config";
import { placesOf } from "../../engine/housing";
import { planEventLog } from "../../plan";
import { planPhysicalHousing, simulatePlan } from "../../simulation";
import type { HerdDeparture, HousingAnimalSnapshot } from "../demand";
import { ARC_HOUSING_POLICY, stageExitWeights, type HousingType } from "../rules";
import { allocatePhysicalHousing, PhysicalHousingAllocator } from "./allocator";
import { housingEventsByDay, housingEventsFor } from "./events";
import {
  animalLocationOnDay,
  farmStateOnDay,
  penOccupantsOnDay,
} from "./history";
import {
  allPens,
  housingInputHash,
  housingIsStale,
  hasPhysicalHousing,
  planDiff,
  planTotals,
  type PhysicalBuilding,
  type PhysicalFarmPlan,
} from "./model";
import type { HousingSimulationResult } from "./result";
import type { PhysicalFarmState } from "./state";

/**
 * The physical farm: pens with animals in them.
 *
 * Two kinds of case, and they are worth telling apart. Most of the file is a
 * farm written out one animal at a time, because the questions worth asking of
 * an allocator are the ones a three-sow example answers unambiguously: does the
 * sow move a week before she is due, does her litter follow her out, does the
 * pen she left go on to wash, and what happens to the twenty-first weaner when
 * the pen holds twenty. A simulated herd cannot answer any of those without
 * also being a test of the simulation.
 *
 * The rest is one real plan, run twice, to hold the properties that only exist
 * over a whole farm: that the housing is generated from the run rather than
 * assumed, that nothing goes into a room before it is built, and that a day of
 * the plan can be rebuilt from the events long after the run has finished.
 */

const POLICY = ARC_HOUSING_POLICY;
const WEIGHTS = stageExitWeights(cloneDefaultConfig());

// ------------------------------------------------------------------ a farm

type RoomSpec = {
  type: HousingType;
  pens: number;
  maxHead: number;
  areaM2: number;
  /** The first day it can take animals. Day zero unless it is being phased. */
  day?: number;
};

/** A building written out by hand, with the ids the generator would give it. */
function building(code: string, rooms: readonly RoomSpec[]): PhysicalBuilding {
  const id = code + "-01";
  return {
    id,
    name: code,
    housingType: rooms.length > 0 ? rooms[0].type : undefined,
    widthM: 10,
    lengthM: 20,
    commissionedDay: Math.min(...rooms.map((room) => room.day ?? 0)),
    rooms: rooms.map((room, index) => {
      const roomId = id + "-R" + String(index + 1).padStart(2, "0");
      return {
        id: roomId,
        buildingId: id,
        name: "Room " + (index + 1),
        housingType: room.type,
        widthM: 5,
        lengthM: 10,
        commissionedDay: room.day ?? 0,
        pens: Array.from({ length: room.pens }, (_, pen) => ({
          id: roomId + "-P" + String(pen + 1).padStart(2, "0"),
          roomId,
          name: "Pen " + (pen + 1),
          housingType: room.type,
          maxHead: room.maxHead,
          floorAreaM2: room.areaM2,
          allowedStages: [],
          commissionedDay: room.day ?? 0,
        })),
      };
    }),
  };
}

function farm(...buildings: PhysicalBuilding[]): PhysicalFarmPlan {
  // The stages each pen accepts are the model's own, not the test's: a test
  // that wrote its own would be testing itself.
  const plan: PhysicalFarmPlan = { buildings };
  for (const pen of allPens(plan)) {
    pen.allowedStages = [
      ...(
        {
          boar: ["boar"],
          service_sow: ["open-sow"],
          gestation: ["gestating-sow"],
          farrowing: ["gestating-sow", "lactating-sow", "piglet"],
          gilt: ["gilt"],
          weaner: ["weaner"],
          grower: ["grower"],
          finisher: ["finisher"],
        } as const
      )[pen.housingType],
    ];
  }
  return plan;
}

/** The houses this suite builds, at the sizes the manual's profile gives them. */
const FARROWING: RoomSpec = { type: "farrowing", pens: 2, maxHead: 1, areaM2: 3.96 };
const SERVICE: RoomSpec = { type: "service_sow", pens: 4, maxHead: 1, areaM2: 1.8 };
const GESTATION: RoomSpec = { type: "gestation", pens: 2, maxHead: 5, areaM2: 19.5 };
const WEANER: RoomSpec = { type: "weaner", pens: 2, maxHead: 20, areaM2: 8 };
const GROWER: RoomSpec = { type: "grower", pens: 2, maxHead: 20, areaM2: 19 };
const FINISHER: RoomSpec = { type: "finisher", pens: 2, maxHead: 10, areaM2: 13 };

// -------------------------------------------------------------- the animals

function sow(
  id: string,
  state: "open" | "gestating" | "lactating",
  extra: { due?: number; tag?: string } = {},
): HousingAnimalSnapshot {
  return {
    id,
    tag: extra.tag ?? id,
    kind: "sow",
    reproductiveState: state,
    weightKg: 210,
    ageDays: 450,
    sex: "female",
    expectedFarrowDay: extra.due,
  };
}

function piglet(id: string, damTag: string, cohortId: string): HousingAnimalSnapshot {
  return {
    id,
    tag: id,
    damTag,
    kind: "pig",
    stage: "piglet",
    weightKg: 4,
    ageDays: 10,
    cohortId,
    sex: "female",
  };
}

function pig(
  id: string,
  stage: "weaner" | "grower" | "finisher",
  cohortId: string,
  weightKg = stage === "weaner" ? 12 : stage === "grower" ? 35 : 70,
): HousingAnimalSnapshot {
  return { id, tag: id, kind: "pig", stage, weightKg, ageDays: 80, cohortId, sex: "female" };
}

/** A batch of like animals, numbered so their ids sort the way they were made. */
function batch(
  count: number,
  build: (index: number) => HousingAnimalSnapshot,
): HousingAnimalSnapshot[] {
  return Array.from({ length: count }, (_, index) => build(index));
}

type Scene = (day: number) => HousingAnimalSnapshot[];

/** Runs a scene over a span of days and hands back everything that happened. */
function run(
  plan: PhysicalFarmPlan,
  scene: Scene,
  from: number,
  to: number,
  departures: (day: number) => HerdDeparture[] = () => [],
): HousingSimulationResult {
  const days = [];
  for (let day = from; day <= to; day += 1) {
    days.push({ day, animals: scene(day), departures: departures(day) });
  }
  return allocatePhysicalHousing(plan, days, POLICY, WEIGHTS);
}

function penOf(state: PhysicalFarmState, animalId: string): string | null {
  return state.entityLocations[animalId]?.penId ?? null;
}

function statusOf(state: PhysicalFarmState, penId: string): string {
  return state.pens[penId].status;
}

/** Every path in a stored object whose value is explicitly undefined. */
function undefinedFields(value: unknown, prefix = "", into: string[] = []): string[] {
  if (value === null || typeof value !== "object") return into;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const path = prefix ? prefix + "." + key : key;
    if (child === undefined) into.push(path);
    else undefinedFields(child, path, into);
  }
  return into;
}

/** Every animal standing in a pen, place-takers and sucklers alike. */
function housedHead(state: PhysicalFarmState): number {
  return Object.values(state.pens).reduce(
    (total, pen) => total + pen.occupiedHead + pen.sucklingHead,
    0,
  );
}

// ------------------------------------------------------------- the invariants

describe("the invariants", () => {
  const plan = farm(
    building("BREED", [SERVICE]),
    building("GEST", [GESTATION]),
    building("FARR", [FARROWING]),
    building("WEAN", [WEANER]),
  );

  const scene: Scene = (day) => [
    sow("SOW-1", day < 5 ? "open" : "gestating", { due: 20 }),
    sow("SOW-2", "lactating"),
    ...batch(8, (index) => piglet("PIG-" + index, "SOW-2", "B0")),
    ...batch(25, (index) => pig("W-" + String(index).padStart(2, "0"), "weaner", "W1")),
  ];

  const result = run(plan, scene, 1, 30);

  it("houses every animal in at most one pen", () => {
    const state = result.finalState;
    // Every occupant the pens hold, counted off the pens, is one animal with one
    // location. If anybody were housed twice the two would not agree.
    expect(housedHead(state)).toBe(Object.keys(state.entityLocations).length);
  });

  it("never puts more head in a pen than it holds", () => {
    for (const pen of Object.values(result.finalState.pens)) {
      expect(pen.occupiedHead).toBeLessThanOrEqual(pen.maxHead);
    }
    for (const summary of result.penUtilization) {
      expect(summary.peakHead).toBeLessThanOrEqual(summary.maxHead);
    }
  });

  it("never puts an animal in housing of the wrong kind", () => {
    const state = result.finalState;
    for (const [animalId, location] of Object.entries(state.entityLocations)) {
      const type = state.pens[location.penId].housingType;
      if (animalId.startsWith("W-")) expect(type).toBe("weaner");
      if (animalId === "SOW-2") expect(type).toBe("farrowing");
      if (animalId.startsWith("PIG-")) expect(type).toBe("farrowing");
    }
  });

  it("puts the twenty-fifth weaner in the second pen rather than the first", () => {
    const state = result.finalState;
    const pens = new Set(
      Object.entries(state.entityLocations)
        .filter(([id]) => id.startsWith("W-"))
        .map(([, location]) => location.penId),
    );
    expect(pens.size).toBe(2);
    expect(state.pens["WEAN-01-R01-P01"].occupiedHead).toBe(20);
    expect(state.pens["WEAN-01-R01-P02"].occupiedHead).toBe(5);
  });
});

describe("pens that cannot take an animal", () => {
  it("will not use a room before it is commissioned", () => {
    const plan = farm(building("WEAN", [{ ...WEANER, pens: 1, day: 10 }]));
    const scene: Scene = () => [pig("W-1", "weaner", "W1")];

    const early = run(plan, scene, 1, 5);
    expect(penOf(early.finalState, "W-1")).toBeNull();
    expect(early.conflicts[0].reason).toBe("NO_COMMISSIONED_PEN");
    expect(early.finalState.unhoused).toEqual([{ animalId: "W-1", housingType: "weaner" }]);

    const later = run(plan, scene, 1, 12);
    expect(penOf(later.finalState, "W-1")).toBe("WEAN-01-R01-P01");
    // Nothing went in before the day the room was finished.
    for (const movement of later.movements) {
      if (movement.to) expect(movement.day).toBeGreaterThanOrEqual(10);
    }
  });

  it("will not put a new batch into a pen that is being cleaned", () => {
    const plan = farm(building("WEAN", [{ ...WEANER, pens: 1 }]));
    const scene: Scene = (day) =>
      day <= 3 ? [pig("W-1", "weaner", "W1")] : day >= 6 ? [pig("W-2", "weaner", "W2")] : [];
    const departures = (day: number): HerdDeparture[] =>
      day === 4 ? [{ id: "W-1", day, reason: "sold" }] : [];

    const result = run(plan, scene, 1, 8, departures);
    // Seven days of cleaning after the batch goes, so the pen is still shut.
    expect(statusOf(result.finalState, "WEAN-01-R01-P01")).toBe("CLEANING");
    expect(penOf(result.finalState, "W-2")).toBeNull();
    expect(result.conflicts.some((c) => c.reason === "ALL_COMPATIBLE_PENS_CLEANING")).toBe(true);
  });

  it("opens the pen again once the cleaning days are up", () => {
    const plan = farm(building("WEAN", [{ ...WEANER, pens: 1 }]));
    const scene: Scene = (day) =>
      day <= 3 ? [pig("W-1", "weaner", "W1")] : day >= 12 ? [pig("W-2", "weaner", "W2")] : [];
    const departures = (day: number): HerdDeparture[] =>
      day === 4 ? [{ id: "W-1", day, reason: "sold" }] : [];

    const result = run(plan, scene, 1, 14, departures);
    expect(penOf(result.finalState, "W-2")).toBe("WEAN-01-R01-P01");
    expect(statusOf(result.finalState, "WEAN-01-R01-P01")).toBe("OCCUPIED");
  });

  it("keeps a second sow out of a farrowing place that is booked", () => {
    const plan = farm(building("FARR", [{ ...FARROWING, pens: 1 }]));
    const scene: Scene = () => [
      sow("SOW-1", "gestating", { due: 10 }),
      sow("SOW-2", "gestating", { due: 11 }),
    ];

    const result = run(plan, scene, 1, 5);
    expect(penOf(result.finalState, "SOW-1")).toBe("FARR-01-R01-P01");
    expect(penOf(result.finalState, "SOW-2")).toBeNull();
    expect(statusOf(result.finalState, "FARR-01-R01-P01")).toBe("RESERVED");
    expect(result.conflicts.some((c) => c.reason === "ALL_COMPATIBLE_PENS_RESERVED")).toBe(true);
  });

  it("reports a shortage rather than overfilling a pen", () => {
    const plan = farm(building("WEAN", [{ ...WEANER, pens: 1 }]));
    const scene: Scene = () =>
      batch(25, (index) => pig("W-" + String(index).padStart(2, "0"), "weaner", "W1"));

    const result = run(plan, scene, 1, 3);
    expect(result.finalState.pens["WEAN-01-R01-P01"].occupiedHead).toBe(20);
    expect(result.finalState.unhoused).toHaveLength(5);
    const conflict = result.conflicts[0];
    expect(conflict.reason).toBe("ALL_COMPATIBLE_PENS_FULL");
    expect(conflict.requiredHead).toBe(5);
    expect(conflict.housingType).toBe("weaner");
  });
});

// ------------------------------------------------------------ the biology

describe("what the biology does to the housing", () => {
  const plan = farm(
    building("BREED", [SERVICE]),
    building("GEST", [GESTATION]),
    building("FARR", [FARROWING]),
    building("WEAN", [WEANER]),
  );

  /**
   * One sow through the end of a cycle: carrying, into the farrowing house a
   * week before she is due, farrowed, and weaned on day 40.
   */
  const scene: Scene = (day) => {
    if (day < 20) return [sow("SOW-1", "gestating", { due: 20 })];
    if (day < 40) {
      return [
        sow("SOW-1", "lactating"),
        ...batch(9, (index) => piglet("P-" + index, "SOW-1", "B20")),
      ];
    }
    return [
      sow("SOW-1", "open"),
      ...batch(9, (index) => pig("P-" + index, "weaner", "W40", 8)),
    ];
  };

  const result = run(plan, scene, 1, 48);
  const moves = result.movements;

  it("moves the sow into the farrowing house before she is due", () => {
    const move = moves.find((entry) => entry.reason === "PRE_FARROW");
    expect(move?.day).toBe(13);
    expect(move?.from?.buildingId).toBe("GEST-01");
    expect(move?.to?.buildingId).toBe("FARR-01");
    expect(move?.occupant).toEqual({ type: "animal", animalId: "SOW-1" });
  });

  it("leaves the litter in its mother's farrowing place", () => {
    const born = moves.find(
      (entry) => entry.reason === "INITIAL_PLACEMENT" && entry.occupant.type === "cohort",
    );
    expect(born?.day).toBe(20);
    expect(born?.to?.penId).toBe("FARR-01-R01-P01");
    expect(born?.occupant).toEqual({ type: "cohort", cohortId: "B20", head: 9 });
  });

  it("moves the sow and the litter to their own houses at weaning", () => {
    const weaning = moves.filter((entry) => entry.day === 40 && entry.reason === "WEANING");
    const sowMove = weaning.find((entry) => entry.occupant.type === "animal");
    expect(sowMove?.from?.penId).toBe("FARR-01-R01-P01");
    expect(sowMove?.to?.buildingId).toBe("BREED-01");

    // The litter is two lines, because it is two groups: the litter born on day
    // 20 ends and the batch weaned on day 40 begins.
    const left = weaning.find((entry) => entry.occupant.type === "cohort" && entry.from);
    const arrived = weaning.find((entry) => entry.occupant.type === "cohort" && entry.to);
    expect(left?.from?.penId).toBe("FARR-01-R01-P01");
    expect(left?.occupant).toEqual({ type: "cohort", cohortId: "B20", head: 9 });
    expect(arrived?.to?.buildingId).toBe("WEAN-01");
    expect(arrived?.occupant).toEqual({ type: "cohort", cohortId: "W40", head: 9 });
  });

  it("leaves nothing behind in the farrowing pen when the events are replayed", () => {
    // The trap this guards: a group that changes its name on the way out would
    // be taken off the pen it never joined and left in the pen it never left,
    // and every day after it would show a litter standing in an empty house.
    expect(penOccupantsOnDay(result, "FARR-01-R01-P01", 39)).toEqual([
      { type: "animal", animalId: "SOW-1" },
      { type: "cohort", cohortId: "B20", head: 9 },
    ]);
    expect(penOccupantsOnDay(result, "FARR-01-R01-P01", 41)).toEqual([]);
    expect(farmStateOnDay(plan, result, 41).pens["FARR-01-R01-P01"].occupiedHead).toBe(0);
  });

  it("leaves an orphaned litter in the pen it is standing in", () => {
    const orphaned = run(
      plan,
      (day) =>
        day < 20
          ? [sow("SOW-9", "lactating"), ...batch(9, (index) => piglet("O-" + index, "SOW-9", "B1"))]
          : batch(9, (index) => piglet("O-" + index, "SOW-9", "B1")),
      1,
      25,
      (day) => (day === 20 ? [{ id: "SOW-9", day, reason: "culled" }] : []),
    );
    // The sow goes and the litter does not follow her out of the farrowing
    // house: it is reared where it lies.
    expect(penOf(orphaned.finalState, "O-0")).toBe("FARR-01-R01-P01");
    expect(orphaned.conflicts).toEqual([]);
    expect(statusOf(orphaned.finalState, "FARR-01-R01-P01")).toBe("OCCUPIED");
  });

  it("puts the emptied farrowing place on to wash, and opens it again after", () => {
    const onWeaningDay = farmStateOnDay(plan, result, 40);
    expect(onWeaningDay.pens["FARR-01-R01-P01"].status).toBe("CLEANING");
    // Four days between litters, from the manual's own profile.
    const later = farmStateOnDay(plan, result, 44);
    expect(later.pens["FARR-01-R01-P01"].status).toBe("AVAILABLE");
  });
});

describe("growing pigs moving up", () => {
  const plan = farm(
    building("WEAN", [WEANER]),
    building("GROW", [GROWER]),
    building("FIN", [FINISHER]),
  );

  const scene: Scene = (day) => {
    const stage = day < 10 ? "weaner" : day < 20 ? "grower" : "finisher";
    return batch(8, (index) => pig("P-" + index, stage, "W1"));
  };
  const result = run(plan, scene, 1, 25);

  it("books a movement when the weaners become growers", () => {
    const move = result.movements.find((entry) => entry.day === 10);
    expect(move?.reason).toBe("STAGE_TRANSITION");
    expect(move?.from?.buildingId).toBe("WEAN-01");
    expect(move?.to?.buildingId).toBe("GROW-01");
    expect(move?.occupant).toEqual({ type: "cohort", cohortId: "W1", head: 8 });
  });

  it("books a movement when the growers become finishers", () => {
    const move = result.movements.find((entry) => entry.day === 20);
    expect(move?.reason).toBe("STAGE_TRANSITION");
    expect(move?.from?.buildingId).toBe("GROW-01");
    expect(move?.to?.buildingId).toBe("FIN-01");
  });

  it("leaves the weaner pen to be washed behind them", () => {
    const state = farmStateOnDay(plan, result, 10);
    expect(state.pens["WEAN-01-R01-P01"].status).toBe("CLEANING");
    expect(state.pens["WEAN-01-R01-P01"].occupants).toEqual([]);
  });
});

describe("animals leaving the farm", () => {
  const plan = farm(building("FIN", [FINISHER]));
  const scene: Scene = (day) => {
    if (day < 5) return batch(8, (index) => pig("P-" + index, "finisher", "W1"));
    if (day < 9) return batch(7, (index) => pig("P-" + (index + 1), "finisher", "W1"));
    return [];
  };
  const departures = (day: number): HerdDeparture[] => {
    if (day === 5) return [{ id: "P-0", day, reason: "died" }];
    if (day === 9) {
      return Array.from({ length: 7 }, (_, index) => ({
        id: "P-" + (index + 1),
        day,
        reason: "sold" as const,
      }));
    }
    return [];
  };

  const result = run(plan, scene, 1, 12, departures);

  it("takes a dead pig out of the pen it was standing in", () => {
    const death = result.movements.find((entry) => entry.reason === "MORTALITY");
    expect(death?.day).toBe(5);
    expect(death?.occupant).toEqual({ type: "cohort", cohortId: "W1", head: 1 });
    expect(death?.to).toBeUndefined();
    expect(farmStateOnDay(plan, result, 5).pens["FIN-01-R01-P01"].occupiedHead).toBe(7);
  });

  it("empties the pen when the batch is sold", () => {
    const sale = result.movements.filter((entry) => entry.reason === "SALE");
    expect(sale).toHaveLength(1);
    expect(sale[0].occupant).toEqual({ type: "cohort", cohortId: "W1", head: 7 });
    expect(result.finalState.pens["FIN-01-R01-P01"].occupiedHead).toBe(0);
    expect(result.finalState.entityLocations).toEqual({});
  });
});

// ------------------------------------------------------- how it chooses a pen

describe("choosing a pen", () => {
  it("leaves an animal where it is while its pen is still the right one", () => {
    const plan = farm(building("WEAN", [WEANER]));
    const scene: Scene = () => batch(5, (index) => pig("P-" + index, "weaner", "W1"));
    const result = run(plan, scene, 1, 20);

    // One placement on the first morning and nothing afterwards: no pig is
    // moved to make the packing tidier, which is the whole rule.
    expect(result.movements).toHaveLength(1);
    expect(result.movements[0].day).toBe(1);
  });

  it("does not rebalance a part-full pen when a pen falls empty", () => {
    const plan = farm(building("WEAN", [WEANER]));
    const scene: Scene = (day) => [
      ...batch(5, (index) => pig("A-" + index, "weaner", "W1")),
      ...(day <= 3 ? batch(20, (index) => pig("B-" + index, "weaner", "W2")) : []),
    ];
    const departures = (day: number): HerdDeparture[] =>
      day === 4
        ? Array.from({ length: 20 }, (_, index) => ({
            id: "B-" + index,
            day,
            reason: "sold" as const,
          }))
        : [];

    const result = run(plan, scene, 1, 20, departures);
    const cohortA = result.movements.filter(
      (entry) => entry.occupant.type === "cohort" && entry.occupant.cohortId === "W1",
    );
    // Five pigs, placed once, and never moved to the pen the other batch left.
    expect(cohortA).toHaveLength(1);
    expect(penOf(result.finalState, "A-0")).toBe("WEAN-01-R01-P01");
  });

  it("fills the room it is in before opening another one", () => {
    const plan = farm(
      building("WEAN", [
        { ...WEANER, pens: 2 },
        { ...WEANER, pens: 2 },
      ]),
    );
    const scene: Scene = () =>
      batch(30, (index) => pig("W-" + String(index).padStart(2, "0"), "weaner", "W1"));
    const result = run(plan, scene, 1, 3);

    const rooms = new Set(
      Object.values(result.finalState.entityLocations).map((location) => location.roomId),
    );
    expect([...rooms]).toEqual(["WEAN-01-R01"]);
    expect(result.finalState.rooms["WEAN-01-R02"].occupiedHead).toBe(0);
  });

  it("comes out the same way twice", () => {
    const plan = farm(
      building("FARR", [FARROWING]),
      building("GEST", [GESTATION]),
      building("WEAN", [WEANER]),
    );
    const scene: Scene = (day) => [
      sow("SOW-1", "gestating", { due: 12 }),
      sow("SOW-2", "gestating", { due: 40 }),
      ...batch(23, (index) => pig("W-" + String(index).padStart(2, "0"), "weaner", "W1")),
      ...(day > 5 ? [sow("SOW-3", "gestating", { due: 13 })] : []),
    ];

    const first = run(plan, scene, 1, 30);
    const second = run(plan, scene, 1, 30);
    expect(second.movements).toEqual(first.movements);
    expect(second.statusChanges).toEqual(first.statusChanges);
    expect(second.finalState).toEqual(first.finalState);
  });
});

// ------------------------------------------------------------ the history

describe("reading a past day back out of the events", () => {
  const plan = farm(
    building("GEST", [GESTATION]),
    building("FARR", [FARROWING]),
    building("WEAN", [WEANER]),
  );
  const scene: Scene = (day) => {
    if (day < 20) return [sow("SOW-1", "gestating", { due: 20 })];
    if (day < 40) {
      return [
        sow("SOW-1", "lactating"),
        ...batch(10, (index) => piglet("P-" + index, "SOW-1", "B20")),
      ];
    }
    return batch(10, (index) => pig("P-" + index, "weaner", "W40", 8));
  };

  /** The farm as it actually stood on day 30, kept while the run went past it. */
  const allocator = new PhysicalHousingAllocator(plan, POLICY, WEIGHTS);
  let day30: PhysicalFarmState | null = null;
  for (let day = 1; day <= 60; day += 1) {
    allocator.step(day, scene(day), []);
    if (day === 30) day30 = structuredClone(allocator.state());
  }
  const result = allocator.finish();

  it("says where an animal was on a day the run has long since passed", () => {
    expect(animalLocationOnDay(result, "SOW-1", 30)?.penId).toBe("FARR-01-R01-P01");
    expect(animalLocationOnDay(result, "SOW-1", 5)?.penId).toBe("GEST-01-R01-P01");
    // She is gone by the end of the scene, and the events say so.
    expect(animalLocationOnDay(result, "SOW-1", 60)).toBeNull();
  });

  it("says what was standing in a pen on a day the run has long since passed", () => {
    expect(penOccupantsOnDay(result, "FARR-01-R01-P01", 30)).toEqual([
      { type: "animal", animalId: "SOW-1" },
      { type: "cohort", cohortId: "B20", head: 10 },
    ]);
    expect(penOccupantsOnDay(result, "FARR-01-R01-P01", 5)).toEqual([]);
    expect(penOccupantsOnDay(result, "WEAN-01-R01-P01", 50)).toEqual([
      { type: "cohort", cohortId: "W40", head: 10 },
    ]);
  });

  it("rebuilds the whole farm of that day, pen for pen", () => {
    const rebuilt = farmStateOnDay(plan, result, 30);
    const kept = day30 as PhysicalFarmState;
    for (const penId of Object.keys(kept.pens)) {
      expect(rebuilt.pens[penId].status).toBe(kept.pens[penId].status);
      expect(rebuilt.pens[penId].occupiedHead).toBe(kept.pens[penId].occupiedHead);
      expect(rebuilt.pens[penId].sucklingHead).toBe(kept.pens[penId].sucklingHead);
      expect(rebuilt.pens[penId].occupants).toEqual(kept.pens[penId].occupants);
    }
  });
});

// -------------------------------------------------- what the calendar is told

describe("the housing as a day's work", () => {
  const plan = farm(
    building("GEST", [GESTATION]),
    building("FARR", [{ ...FARROWING, pens: 1 }]),
    building("WEAN", [WEANER]),
  );
  const scene: Scene = (day) => {
    if (day < 20) {
      return [sow("SOW-1", "gestating", { due: 20 }), sow("SOW-2", "gestating", { due: 21 })];
    }
    if (day < 40) {
      return [
        sow("SOW-1", "lactating"),
        sow("SOW-2", "gestating", { due: 21 }),
        ...batch(9, (index) => piglet("P-" + index, "SOW-1", "B20")),
      ];
    }
    return batch(9, (index) => pig("P-" + index, "weaner", "W40", 8));
  };
  const result = run(plan, scene, 1, 45);

  it("says what moved, in the words a work list is written in", () => {
    expect(housingEventsFor(result, 13, 13)).toEqual([
      {
        type: "housing",
        label: "Move SOW-1 into the farrowing house to farrow · FARR-01-R01: P01",
        count: 1,
      },
    ]);
    // The pen a batch went into and the pen it left behind to be washed, on the
    // one morning both happened.
    expect(housingEventsFor(result, 40, 40).map((entry) => entry.label)).toEqual([
      "Move W40 (9 pigs) into the weaner house at weaning · WEAN-01-R01: P01",
      "Wash down 1 pen in the farrowing house · FARR-01-R01: P01",
    ]);
  });

  it("says out loud when there was nowhere to put them", () => {
    // One farrowing place and two sows due within a day of each other.
    const shortage = housingEventsFor(result, 14, 14);
    expect(shortage).toEqual([
      {
        type: "housing-shortage",
        label: "SOW-2 wanted farrowing places and there were none free",
        count: 1,
      },
    ]);
  });

  it("names the pens on a day, and counts them over a month", () => {
    const [weaning] = housingEventsFor(result, 40, 40).filter((entry) =>
      entry.label.includes("weaner house"),
    );
    expect(weaning.label).toBe(
      "Move W40 (9 pigs) into the weaner house at weaning · WEAN-01-R01: P01",
    );

    // A month is not read to find a gate, and thirty days of pen ids is a
    // paragraph where a line was wanted.
    const month = housingEventsFor(result, 1, 45).filter((entry) =>
      entry.label.includes("weaner house"),
    );
    expect(month[0].label).toBe("Move 9 head into the weaner house at weaning");
  });

  it("names the animals and the batches rather than counting heads", () => {
    // A batch split between two pens is one batch under one name, with the head
    // that actually moved — not the same name written twice.
    const weaners = farm(building("WEAN", [WEANER]));
    const split = run(
      weaners,
      () => batch(25, (index) => pig("W-" + String(index).padStart(2, "0"), "weaner", "W1")),
      1,
      2,
    );
    expect(housingEventsFor(split, 1, 1).find((entry) => entry.type === "housing")?.label).toBe(
      "House W1 (25 pigs) into the weaner house · WEAN-01-R01: P01, P02",
    );

    // Past a few names a line stops being a line, so the rest are counted.
    const gestation = farm(building("GEST", [GESTATION]));
    const crowd = run(
      gestation,
      () => batch(6, (index) => sow("SOW-" + (index + 1), "gestating", { due: 200 })),
      1,
      2,
    );
    expect(housingEventsFor(crowd, 1, 1).find((entry) => entry.type === "housing")?.label).toBe(
      "House SOW-1, SOW-2, SOW-3, SOW-4 and 2 head more into the gestation house · " +
        "GEST-01-R01: P01, P02",
    );
  });

  it("offers to say what the plain stage-change line says, and only then", () => {
    const upstairs = farm(building("WEAN", [WEANER]), building("GROW", [GROWER]));
    const moved = run(
      upstairs,
      (day) => batch(4, (index) => pig("P-" + index, day < 5 ? "weaner" : "grower", "W1")),
      1,
      8,
    );
    const move = housingEventsFor(moved, 5, 5).find((entry) =>
      entry.label.includes("grower house"),
    );
    expect(move?.replaces).toEqual(["moved-to-grower"]);

    // A sow set down to farrow is not what "3 weaners become growers" was
    // saying, so it stands in for nothing.
    expect(housingEventsFor(result, 13, 13)[0].replaces).toBeUndefined();
  });

  it("rolls a stretch of days into one line rather than thirty", () => {
    const month = housingEventsFor(result, 1, 45);
    const moves = month.filter((entry) => entry.label.includes("into the weaner house"));
    expect(moves).toHaveLength(1);
    expect(moves[0].count).toBe(9);
  });

  it("indexes by day without walking the record once a day", () => {
    const byDay = housingEventsByDay(result);
    for (const [day, events] of byDay) {
      expect(events).toEqual(housingEventsFor(result, day, day));
    }
    expect(byDay.get(13)).toBeDefined();
  });
});

// ----------------------------------------------------- generating the housing

/**
 * One real plan, generated and then run in what was generated.
 *
 * Kept short because it is a farm simulated day by day, and it is the only case
 * in this file that needs one: everything above is about the allocator, and this
 * is about the two runs fitting together.
 */
function smallPlan(): PlannerConfig {
  const config = cloneDefaultConfig();
  config.project.months = 12;
  config.project.variation = "settled";
  config.herd.maxSows = 8;
  return config;
}

const GENERATED_FROM = smallPlan();
const GENERATED = planPhysicalHousing(GENERATED_FROM, { generatedAt: "2026-01-01T00:00:00.000Z" });

/** The same plan run again, this time in the buildings that were generated. */
const HOUSED = (() => {
  const config = structuredClone(GENERATED_FROM);
  config.housing.physical = GENERATED;
  const simulation = simulatePlan(config, { snapshots: false, physicalHousing: true });
  const housing = simulation.physicalHousing;
  if (housing === null) throw new Error("A plan with housing was run without filling it.");
  return housing;
})();

describe("generating a farm from the plan", () => {
  it("writes buildings, rooms and pens with stable, readable ids", () => {
    const totals = planTotals(GENERATED);
    expect(totals.buildings).toBeGreaterThan(0);
    expect(totals.pens).toBeGreaterThan(0);
    for (const pen of allPens(GENERATED)) {
      expect(pen.id).toMatch(/^[A-Z]+-\d{2}-R\d{2}-P\d{2}$/);
      expect(pen.roomId).toBe(pen.id.slice(0, pen.id.lastIndexOf("-P")));
      expect(pen.maxHead).toBeGreaterThan(0);
    }
  });

  it("comes out the same for the same plan, ids and all", () => {
    const again = planPhysicalHousing(GENERATED_FROM, {
      generatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(again).toEqual(GENERATED);
    const diff = planDiff(GENERATED, again);
    expect(diff.penIdsAdded).toEqual([]);
    expect(diff.penIdsRemoved).toEqual([]);
  });

  it("is storable: nothing in it is a field set to undefined", () => {
    // Plans are written to Firestore as data rather than as JSON, and there a
    // field explicitly set to undefined is not an absent field — it is a value
    // Firestore refuses, by throwing over the whole batch. A generated farm
    // travels in the plan, so one such field here would stop every plan in the
    // workspace from being saved and say so only as "Not syncing".
    expect(undefinedFields(GENERATED)).toEqual([]);
    // And it survives the round trip through storage unchanged.
    expect(JSON.parse(JSON.stringify(GENERATED))).toEqual(GENERATED);
  });

  it("loads back from storage as the farm it was saved as", () => {
    const stored = JSON.parse(
      JSON.stringify({ ...GENERATED_FROM, housing: { ...GENERATED_FROM.housing, physical: GENERATED } }),
    );
    const loaded = withConfigDefaults(stored);
    if (loaded === null) throw new Error("A plan with generated housing would not load.");
    expect(loaded.housing.physical).toEqual(GENERATED);
    expect(housingIsStale(loaded)).toBe(false);
    expect(planTotals(loaded.housing.physical).pens).toBe(planTotals(GENERATED).pens);
  });

  it("stamps what it was generated from, so staleness is a fact", () => {
    expect(GENERATED.generatedFromInputHash).toBe(housingInputHash(GENERATED_FROM));
    expect(GENERATED.generatorVersion).toBeTruthy();

    const housed = { ...GENERATED_FROM, housing: { ...GENERATED_FROM.housing, physical: GENERATED } };
    expect(housingIsStale(housed)).toBe(false);
    expect(hasPhysicalHousing(housed)).toBe(true);

    const bigger = structuredClone(housed);
    bigger.herd.maxSows = 40;
    expect(housingIsStale(bigger)).toBe(true);
  });

  it("dates every room it phases, and never fills one before it is built", () => {
    const commissioned = new Map(allPens(GENERATED).map((pen) => [pen.id, pen.commissionedDay]));
    for (const movement of HOUSED.movements) {
      if (!movement.to) continue;
      expect(movement.day).toBeGreaterThanOrEqual(commissioned.get(movement.to.penId) ?? 0);
    }
    for (const summary of HOUSED.penUtilization) {
      expect(summary.peakHead).toBeLessThanOrEqual(summary.maxHead);
    }
    // The farm was actually filled: this is not a run that housed nobody.
    expect(HOUSED.movements.length).toBeGreaterThan(0);
    expect(Object.keys(HOUSED.finalState.entityLocations).length).toBeGreaterThan(0);
  });

  it("writes what the housing did into the calendar the plan is read from", () => {
    const config = structuredClone(GENERATED_FROM);
    config.housing.physical = GENERATED;
    const timeline = simulatePlan(config, { snapshots: false, physicalHousing: true }).timeline;

    // A move is a thing that happened on a day, so it is on the day beside the
    // farrowings and the sales rather than in a panel of its own.
    const days = timeline.days.filter((day) =>
      day.events.some((event) => event.type === "housing"),
    );
    expect(days.length).toBeGreaterThan(0);
    expect(days[0].events.some((event) => event.label.includes("into the"))).toBe(true);

    // And the month says it once rather than thirty times.
    const month = timeline.months.find((entry) =>
      entry.events.some((event) => event.type === "housing"),
    );
    expect(month).toBeDefined();

    // The pens are named where a person went looking for a pen.
    const named = timeline.days.some((entry) =>
      entry.events.some((event) => event.type === "housing" && / · [A-Z]+-\d+-R\d+: /.test(event.label)),
    );
    expect(named).toBe(true);

    // And where a move says a pig went up a house, the farm's own line about it
    // has stood down rather than saying the same thing again in fewer words.
    const movedUp = timeline.days.filter((entry) =>
      entry.events.some(
        (event) => event.type === "housing" && event.label.includes("into the grower house"),
      ),
    );
    expect(movedUp.length).toBeGreaterThan(0);
    for (const entry of movedUp) {
      expect(entry.events.some((event) => event.label.includes("become growers"))).toBe(false);
    }
  });

  it("says where the farm's own work happens, in the house it happens in", () => {
    const config = structuredClone(GENERATED_FROM);
    config.housing.physical = GENERATED;
    const timeline = simulatePlan(config, { snapshots: false, physicalHousing: true }).timeline;

    // A count of jobs cannot say which pen — "service 1 sow" names no sow — but
    // the house it is done in is the same house whichever sow she is, and the
    // building is the thing a person walks to.
    const serviced = timeline.days
      .flatMap((day) => day.events)
      .find((event) => event.type === "service");
    expect(serviced?.label).toMatch(/ · in the service house \([A-Z]+-\d+\)$/);

    const farrowed = timeline.days
      .flatMap((day) => day.events)
      .find((event) => event.type === "farrowing");
    expect(farrowed?.label).toContain(" · in the farrowing house (FARR-01)");

    // A piglet is vaccinated where a piglet stands, and a weaner where a weaner
    // does; the line carries the stage so the housing can say which that is.
    const vaccinated = timeline.days
      .flatMap((day) => day.events)
      .filter((event) => event.type === "vaccination");
    expect(vaccinated.some((event) => event.label.includes("in the farrowing house"))).toBe(true);

    // A loss can happen anywhere, so nothing is claimed about where it was.
    const lost = timeline.days.flatMap((day) => day.events).find((event) => event.type === "loss");
    expect(lost?.label).not.toContain(" · in ");

    // A month is not walked, so it names the house and not the buildings.
    const month = timeline.months
      .flatMap((entry) => entry.events)
      .find((event) => event.type === "service");
    expect(month?.label).toContain(" · in the service house");
    expect(month?.label).not.toContain("(");
  });

  it("writes every pen an animal stood in into the exported log", () => {
    const config = structuredClone(GENERATED_FROM);
    config.housing.physical = GENERATED;
    const log = planEventLog(config);

    // A log is read in the order things happened, so the housing lines are in
    // among the farm's own rather than in a block at the end of the file.
    const days = log.map((event) => event.day);
    expect([...days].sort((a, b) => a - b)).toEqual(days);

    const housing = log.filter((event) => event.type === "housing");
    expect(housing.length).toBeGreaterThan(0);
    // One line an occupant, with both ends of the move on it: what an export is
    // for is a question nobody thought of in advance, asked in a spreadsheet.
    expect(
      housing.some((event) => /^[A-Z]+-\d+ moved from \S+ to \S+ — to farrow$/.test(event.message)),
    ).toBe(true);
    expect(housing.some((event) => event.message.includes("commissioned in"))).toBe(true);
    expect(housing.some((event) => event.message.includes("cleaning until day"))).toBe(true);
    for (const event of housing) expect(event.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // And a plan with no pens exports exactly what it always did.
    expect(planEventLog(GENERATED_FROM).some((event) => event.type === "housing")).toBe(false);
  });

  it("keeps the plain stage-change line on a plan with no pens to move between", () => {
    const timeline = simulatePlan(GENERATED_FROM, { snapshots: false }).timeline;
    const grown = timeline.days.filter((entry) =>
      entry.events.some((event) => event.type === "growth"),
    );
    expect(grown.length).toBeGreaterThan(0);
  });

  it("holds the herd it was generated for, with nobody left outside", () => {
    // The property the two runs exist to have between them. The housing is
    // sized off this herd, so this herd has to fit in it — if it does not, the
    // needs planner and the allocator disagree about what a pen is, and one of
    // them is wrong.
    expect(HOUSED.conflicts).toEqual([]);
    expect(HOUSED.finalState.unhoused).toEqual([]);
    expect(HOUSED.totals.peakUnhousedHead).toBe(0);
  });

  it("answers where every animal is, on the last day and on any other", () => {
    const state = HOUSED.finalState;
    const housed = Object.values(state.pens).reduce(
      (total, pen) => total + pen.occupiedHead + pen.sucklingHead,
      0,
    );
    expect(housed).toBe(Object.keys(state.entityLocations).length);

    // The replay of every event of a real run lands exactly where the run
    // itself did, pen for pen. Nothing is left standing in a pen it left.
    const replayed = farmStateOnDay(GENERATED, HOUSED, HOUSED.lastDay);
    for (const penId of Object.keys(state.pens)) {
      expect(replayed.pens[penId].occupants).toEqual(state.pens[penId].occupants);
      expect(replayed.pens[penId].occupiedHead).toBe(state.pens[penId].occupiedHead);
      expect(replayed.pens[penId].status).toBe(state.pens[penId].status);
    }

    const midway = farmStateOnDay(GENERATED, HOUSED, Math.floor(HOUSED.lastDay / 2));
    const midwayHead = Object.values(midway.pens).reduce(
      (total, pen) => total + pen.occupiedHead + pen.sucklingHead,
      0,
    );
    expect(midwayHead).toBeGreaterThan(0);
    for (const pen of Object.values(midway.pens)) {
      expect(pen.occupiedHead).toBeLessThanOrEqual(pen.maxHead);
    }
  });
});

describe("what physical housing replaces", () => {
  it("takes over from the aggregate places once it exists", () => {
    const legacy = smallPlan();
    legacy.housing.weanerPlaces = 56;
    expect(placesOf(legacy).weaner).toBe(56);

    const housed = structuredClone(legacy);
    housed.housing.physical = GENERATED;
    const capacity = planTotals(GENERATED).headCapacityByType;
    expect(placesOf(housed).weaner).toBe(capacity.weaner);
    expect(placesOf(housed).farrowing).toBe(capacity.farrowing);
    expect(placesOf(housed).weaner).not.toBe(56);
  });

  it("leaves a plan saved before any of this existed exactly as it was", () => {
    const stored = structuredClone(smallPlan()) as unknown as Record<string, unknown>;
    delete (stored.housing as Record<string, unknown>).physical;
    const loaded = withConfigDefaults(stored);
    if (loaded === null) throw new Error("A plan saved before physical housing would not load.");

    expect(loaded.housing.physical).toBeUndefined();
    expect(hasPhysicalHousing(loaded)).toBe(false);
    expect(housingIsStale(loaded)).toBe(false);
    expect(placesOf(loaded).finisher).toBe(loaded.housing.finisherPlaces);
    // And it still runs, with nothing watching a set of pens it has not got.
    const simulation = simulatePlan(loaded, { snapshots: false });
    expect(simulation.physicalHousing).toBeNull();
    expect(simulation.projection.months).toHaveLength(loaded.project.months);
  });
});
