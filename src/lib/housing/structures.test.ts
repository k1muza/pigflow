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

  it("would rather build another room than pay for pens nobody fills", () => {
    // Thirty pens: six to a room is five rooms with nothing spare; four to a
    // room is eight rooms and two pens of finishers that never exist.
    const chosen = chooseRoom(pen, 30, POLICY);
    expect(chosen?.sparePens).toBe(0);
    expect(chosen?.pensPerRoom).toBe(6);
    expect(chosen?.roomCount).toBe(5);
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
});
