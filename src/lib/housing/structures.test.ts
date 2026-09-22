import { describe, expect, it } from "vitest";

import { cloneDefaultConfig } from "../config";
import {
  aspectRatioOf,
  ceilToStep,
  DIMENSION_STEP_M,
  rectangleFor,
  type Rectangle,
} from "./geometry";
import {
  ARC_HOUSING_POLICY,
  housingPolicy,
  penAreaOf,
  stageExitWeights,
  type HousingType,
} from "./rules";
import {
  buildingsFor,
  candidatesFor,
  chooseRoom,
  penGeometryFor,
  roomCandidates,
  type TypeStructure,
} from "./structures";

/**
 * The geometry, which has no animals in it at all.
 *
 * Once the allocator has said how many pens there must be, what is left is
 * arithmetic on rectangles, and the thing worth proving about arithmetic on
 * rectangles is that it never produces a box smaller than the floor it was
 * asked for, never produces one that breaks a stated constraint, and produces
 * the same box twice.
 */

const WEIGHTS = stageExitWeights(cloneDefaultConfig());
const POLICY = ARC_HOUSING_POLICY;

/** Two positive sides, and an area a reader can get by multiplying them. */
function isRectangular(box: Rectangle): boolean {
  return box.widthM > 0 && box.lengthM > 0 && Math.abs(box.areaM2 - box.widthM * box.lengthM) < 1e-9;
}

describe("pen rectangles", () => {
  it("covers the floor it was asked for and takes the neatest box that does", () => {
    // The spec's worked example: ten finishers at 1.30 m² apiece.
    const box = rectangleFor({ requiredAreaM2: 13, preferredAspectRatio: 1.25 });
    expect(box).not.toBeNull();
    expect(box?.widthM).toBe(3.25);
    expect(box?.lengthM).toBe(4);
    expect(box?.areaM2).toBe(13);
  });

  it("works to the dimension step rather than to the centimetre", () => {
    const box = rectangleFor({ requiredAreaM2: 7.31, preferredAspectRatio: 1.25 });
    expect(box).not.toBeNull();
    for (const side of [box?.widthM ?? 0, box?.lengthM ?? 0]) {
      expect(Math.abs(side / DIMENSION_STEP_M - Math.round(side / DIMENSION_STEP_M))).toBeLessThan(
        1e-9,
      );
    }
    expect(ceilToStep(7.31 / 2.75)).toBe(2.75);
  });

  it("gives every housing type a box at least as big as the floor the rules ask for", () => {
    const types: HousingType[] = [
      "boar",
      "service_sow",
      "gestation",
      "farrowing",
      "gilt",
      "weaner",
      "grower",
      "finisher",
    ];
    for (const type of types) {
      const required = penAreaOf(POLICY, type, WEIGHTS);
      const geometry = penGeometryFor(POLICY, type, WEIGHTS, 1);
      expect(geometry, type).not.toBeNull();
      expect(isRectangular(geometry!.rectangle), type).toBe(true);
      expect(geometry!.rectangle.areaM2, type).toBeGreaterThanOrEqual(required - 1e-9);
    }
  });

  it("holds a service boar pen to its area and to its shortest side", () => {
    const geometry = penGeometryFor(POLICY, "boar", WEIGHTS, 1);
    expect(geometry).not.toBeNull();
    const box = geometry!.rectangle;
    expect(box.areaM2).toBeGreaterThanOrEqual(POLICY.boar.servicePenAreaM2 - 1e-9);
    expect(Math.min(box.widthM, box.lengthM)).toBeGreaterThanOrEqual(
      POLICY.boar.serviceMinShortSideM - 1e-9,
    );
  });

  it("keeps a farrowing pen inside the width and length the manual gives", () => {
    const geometry = penGeometryFor(POLICY, "farrowing", WEIGHTS, 1);
    expect(geometry).not.toBeNull();
    const box = geometry!.rectangle;
    expect(box.widthM).toBeGreaterThanOrEqual(POLICY.farrowing.penMinWidthM - 1e-9);
    expect(box.widthM).toBeLessThanOrEqual(POLICY.farrowing.penMaxWidthM + 1e-9);
    expect(box.lengthM).toBeGreaterThanOrEqual(POLICY.farrowing.penMinLengthM - 1e-9);
    expect(box.lengthM).toBeLessThanOrEqual(POLICY.farrowing.penMaxLengthM + 1e-9);
  });

  it("says there is no box rather than rounding a rule away", () => {
    // 9.3 m² with no side under 2.1 m and no side over 2.0 m is not a pen.
    expect(
      rectangleFor({
        requiredAreaM2: 9.3,
        preferredAspectRatio: 1.25,
        maxWidthM: 2,
        maxLengthM: 2,
        minShortSideM: 2.1,
      }),
    ).toBeNull();
  });

  it("gives the same box for the same request, every time", () => {
    const once = rectangleFor({ requiredAreaM2: 18.4, preferredAspectRatio: 1.25 });
    const twice = rectangleFor({ requiredAreaM2: 18.4, preferredAspectRatio: 1.25 });
    expect(once).toEqual(twice);
  });
});

describe("rooms", () => {
  const pen: Rectangle = { widthM: 3.25, lengthM: 4, areaM2: 13 };

  it("never provides fewer pens than were recommended", () => {
    for (let recommended = 1; recommended <= 40; recommended += 1) {
      for (const candidate of roomCandidates(pen, recommended, POLICY)) {
        expect(candidate.totalPens).toBeGreaterThanOrEqual(recommended);
        expect(candidate.roomCount * candidate.pensPerRoom).toBe(candidate.totalPens);
      }
      const chosen = chooseRoom(pen, recommended, POLICY);
      expect(chosen).not.toBeNull();
      expect(chosen!.totalPens).toBeGreaterThanOrEqual(recommended);
    }
  });

  it("draws rectangles, whichever layout it picks", () => {
    for (const candidate of roomCandidates(pen, 30, POLICY)) {
      expect(isRectangular(candidate.rectangle)).toBe(true);
    }
  });

  it("gives a double row one passage rather than two", () => {
    const candidates = roomCandidates(pen, 12, POLICY);
    const single = candidates.find((c) => c.pensPerRoom === 4 && c.layout === "single_row");
    const double = candidates.find(
      (c) => c.pensPerRoom === 4 && c.layout === "double_row_central_passage",
    );
    expect(single?.rectangle.widthM).toBe(4 + POLICY.structure.centralPassageWidthM);
    expect(double?.rectangle.widthM).toBe(4 * 2 + POLICY.structure.centralPassageWidthM);
    expect(double?.rectangle.lengthM).toBe(2 * pen.widthM);
  });

  it("will not lay an odd number of pens in two rows", () => {
    const candidates = roomCandidates(
      pen,
      9,
      housingPolicy((policy) => (policy.structure.pensPerRoomOptions = [3])),
    );
    expect(candidates.every((c) => c.layout === "single_row")).toBe(true);
  });

  it("will not lay a room bigger than the batch that has to fill it", () => {
    // A room is the unit a house is emptied, washed and refilled in. Whatever it
    // would save, a room that takes two intakes to fill cannot be run all in,
    // all out, so the batch is a ceiling and not a preference.
    const free = chooseRoom(pen, 38, POLICY);
    const batched = chooseRoom(pen, 38, POLICY, { batchPens: 4 });
    expect(free!.pensPerRoom).toBeGreaterThan(4);
    expect(batched!.pensPerRoom).toBeLessThanOrEqual(4);
    for (const candidate of roomCandidates(pen, 38, POLICY, { batchPens: 4 })) {
      expect(candidate.pensPerRoom).toBeLessThanOrEqual(4);
    }
  });

  it("prefers a room inside the shape a shed is built in", () => {
    const narrow = housingPolicy((policy) => {
      policy.structure.preferredRoomMaxAspectRatio = 1.5;
      policy.structure.pensPerRoomOptions = [2, 4, 6];
    });
    const chosen = chooseRoom(pen, 12, narrow);
    expect(chosen).not.toBeNull();
    expect(chosen!.aspectRatio).toBeLessThanOrEqual(1.5 + 1e-9);
  });

  it("accepts a long room and says so when nothing shorter is available", () => {
    const onlyLong = housingPolicy((policy) => {
      policy.structure.preferredRoomMaxAspectRatio = 1.05;
      policy.structure.pensPerRoomOptions = [6];
      policy.structure.layouts = ["single_row"];
    });
    const chosen = chooseRoom(pen, 12, onlyLong);
    expect(chosen).not.toBeNull();
    expect(chosen!.overPreferredAspectRatio).toBe(true);
  });
});

describe("buildings", () => {
  const room: Rectangle = { widthM: 5.2, lengthM: 6.5, areaM2: 33.8 };

  function finisherRooms(roomCount: number): TypeStructure {
    return {
      housingType: "finisher",
      layout: "single_row",
      roomCount,
      pensPerRoom: 2,
      penCapacityHead: 10,
      room,
    };
  }

  it("splits the rooms evenly rather than filling the first shed to the brim", () => {
    const buildings = buildingsFor([finisherRooms(10)], POLICY);
    expect(buildings).toHaveLength(2);
    expect(buildings.map((building) => building.roomCount)).toEqual([5, 5]);
  });

  it("puts everything in one house while it fits in one", () => {
    const buildings = buildingsFor([finisherRooms(6)], POLICY);
    expect(buildings).toHaveLength(1);
    expect(buildings[0].label).toBe("Finisher House");
  });

  it("names the houses apart once there is more than one", () => {
    const buildings = buildingsFor([finisherRooms(7)], POLICY);
    expect(buildings.map((building) => building.label)).toEqual([
      "Finisher House A",
      "Finisher House B",
    ]);
    expect(buildings.map((building) => building.roomCount)).toEqual([4, 3]);
  });

  it("puts the boars, the service places and the gilts under one roof", () => {
    const buildings = buildingsFor(
      [
        {
          housingType: "boar",
          layout: "single_row",
          roomCount: 1,
          pensPerRoom: 2,
          penCapacityHead: 1,
          room,
        },
        {
          housingType: "service_sow",
          layout: "single_row",
          roomCount: 1,
          pensPerRoom: 4,
          penCapacityHead: 1,
          room,
        },
        {
          housingType: "gilt",
          layout: "single_row",
          roomCount: 1,
          pensPerRoom: 2,
          penCapacityHead: 10,
          room,
        },
      ],
      POLICY,
    );
    expect(buildings).toHaveLength(1);
    expect(buildings[0].buildingType).toBe("breeding_service");
    expect(buildings[0].sections.map((section) => section.housingType)).toEqual([
      "boar",
      "service_sow",
      "gilt",
    ]);
    expect(buildings[0].penCount).toBe(8);
  });

  it("gives every house a rectangular footprint no smaller than its rooms", () => {
    const buildings = buildingsFor([finisherRooms(9)], POLICY);
    for (const building of buildings) {
      expect(isRectangular(building.rectangle)).toBe(true);
      expect(building.rectangle.areaM2).toBeGreaterThanOrEqual(building.roomAreaM2 - 1e-9);
      expect(aspectRatioOf(building.rectangle.widthM, building.rectangle.lengthM)).toBeGreaterThan(
        0,
      );
    }
  });

  it("measures the strip left over where rooms of different depths stand together", () => {
    // The breeding house, which is where this actually bites: three kinds of pen
    // under one roof, three different depths, and a building is a rectangle.
    const mixed = buildingsFor(
      [
        { ...room2(4.7, 2.75), housingType: "boar" },
        { ...room2(3.2, 2.5), housingType: "service_sow" },
      ],
      POLICY,
    );
    expect(mixed).toHaveLength(1);
    const building = mixed[0];
    // 4.7 wide, because the deepest room in it is; 5.25 long, being both rooms.
    expect(building.rectangle.areaM2).toBeCloseTo(4.7 * 5.25, 6);
    expect(building.roomAreaM2).toBeCloseTo(4.7 * 2.75 + 3.2 * 2.5, 4);
    expect(building.unusedAreaM2).toBeCloseTo(
      building.rectangle.areaM2 - building.roomAreaM2,
      4,
    );
    expect(building.unusedAreaM2).toBeGreaterThan(0);
    // Reported to two places, like every other percentage on the plan.
    expect(building.layoutEfficiencyPct).toBeCloseTo(
      (building.roomAreaM2 / building.rectangle.areaM2) * 100,
      2,
    );
    expect(building.layoutEfficiencyPct).toBeLessThan(100);
    // And it cannot be extended by adding a room on the end, because there is no
    // one width to add one at.
    expect(building.expandable).toBe(false);
  });

  it("calls a house of matching rooms fully used, and extendable along its length", () => {
    const building = buildingsFor([finisherRooms(4)], POLICY)[0];
    expect(building.unusedAreaM2).toBe(0);
    expect(building.layoutEfficiencyPct).toBe(100);
    expect(building.expandable).toBe(true);
    expect(building.expansionDirection).toBe("length");
  });
});

/** A one-room structure of a given room size, for the packing tests. */
function room2(widthM: number, lengthM: number): TypeStructure {
  return {
    housingType: "boar",
    layout: "single_row",
    roomCount: 1,
    pensPerRoom: 1,
    penCapacityHead: 1,
    room: { widthM, lengthM, areaM2: widthM * lengthM },
  };
}

describe("choosing between whole arrangements", () => {
  const pen: Rectangle = { widthM: 3.25, lengthM: 4, areaM2: 13 };
  const finisher = (targetPens: number, batchPens = 4) => ({
    housingType: "finisher" as const,
    pen,
    penCapacityHead: 10,
    targetPens,
    batchPens,
  });

  it("buys two spare pens rather than nine more rooms and two more buildings", () => {
    // The case this whole scoring change exists for. Thirty-eight finishing pens
    // with nothing spare is two to a room: nineteen rooms, four buildings, and
    // nineteen sets of partitions, doors, drains and fans — to save two pens.
    const options = candidatesFor("finisher", [finisher(38)], POLICY);
    const chosen = options[0];
    expect(chosen.totalPens).toBe(40);
    expect(chosen.sparePens).toBe(2);
    expect(chosen.cost.roomCount).toBe(10);
    expect(chosen.buildingCount).toBe(2);

    const zeroSpare = options.find((option) => option.sparePens === 0);
    expect(zeroSpare, "the tidy answer is still generated, and still costed").toBeDefined();
    expect(zeroSpare!.cost.roomCount).toBe(19);
    expect(zeroSpare!.buildingCount).toBe(4);
    expect(zeroSpare!.estimatedCostScore).toBeGreaterThan(chosen.estimatedCostScore);
  });

  it("takes the cheapest of everything it generated, and never a dearer one", () => {
    for (const target of [7, 19, 38]) {
      const options = candidatesFor("finisher", [finisher(target)], POLICY);
      expect(options.length).toBeGreaterThan(1);
      for (const option of options) {
        expect(option.estimatedCostScore).toBeGreaterThanOrEqual(options[0].estimatedCostScore);
      }
    }
  });

  it("never offers an arrangement that houses fewer pens than were required", () => {
    // The hard constraint. Cost decides between arrangements; it never decides
    // whether an arrangement is allowed, so a cheaper one is never a shorter one.
    for (const target of [1, 5, 19, 38, 61]) {
      for (const option of candidatesFor("finisher", [finisher(target)], POLICY)) {
        expect(option.totalPens, `${target} wanted`).toBeGreaterThanOrEqual(target);
        for (const room of option.rooms) expect(room.pensPerRoom).toBeLessThanOrEqual(4);
      }
    }
  });

  it("lets a bigger building limit cut the number of buildings", () => {
    const tight = candidatesFor("finisher", [finisher(38)], POLICY)[0];
    const roomy = candidatesFor(
      "finisher",
      [finisher(38)],
      housingPolicy((policy) => (policy.structure.maxRoomsPerBuilding = 20)),
    )[0];
    expect(roomy.buildingCount).toBeLessThan(tight.buildingCount);
  });

  it("turns a room round when that packs the building better", () => {
    // Two rooms of different depths. Laid out as they come, the shallower one
    // pays for the difference down its whole length; turned, it does not.
    const group = [
      { housingType: "boar" as const, pen: { widthM: 2.75, lengthM: 3.5, areaM2: 9.625 }, penCapacityHead: 1, targetPens: 2, batchPens: 0 },
      { housingType: "service_sow" as const, pen: { widthM: 1.25, lengthM: 2, areaM2: 2.5 }, penCapacityHead: 1, targetPens: 6, batchPens: 0 },
    ];
    const turning = housingPolicy((policy) => (policy.structure.allowRoomRotation = true));
    const fixed = housingPolicy((policy) => (policy.structure.allowRoomRotation = false));
    const withRotation = candidatesFor("breeding_service", group, turning)[0];
    const without = candidatesFor("breeding_service", group, fixed)[0];
    expect(withRotation.estimatedCostScore).toBeLessThanOrEqual(without.estimatedCostScore);
    expect(withRotation.totalBuildingAreaM2).toBeLessThanOrEqual(without.totalBuildingAreaM2);
    expect(withRotation.layoutEfficiencyPct).toBeGreaterThanOrEqual(without.layoutEfficiencyPct);
  });

  it("gives the same arrangement for the same question, every time", () => {
    const once = candidatesFor("finisher", [finisher(38)], POLICY);
    const twice = candidatesFor("finisher", [finisher(38)], POLICY);
    expect(once.map((option) => option.description)).toEqual(
      twice.map((option) => option.description),
    );
    expect(once[0]).toEqual(twice[0]);
  });
});
