import { describe, expect, it } from "vitest";

import { cloneDefaultConfig, type PlannerConfig } from "../config";
import { simulatePlan } from "../simulation";
import {
  areaPerHeadOf,
  ARC_HOUSING_POLICY,
  BUILDING_OF,
  housingPolicy,
  type HousingType,
} from "./rules";
import type { HousingNeedsResult, HousingTypeResult } from "./result";

/**
 * The housing planner over a simulated farm.
 *
 * Two different kinds of assertion live here and they are worth telling apart.
 * The invariants are absolute: a pen is rectangular, a recommendation is never
 * under the minimum, no animal is housed twice, and turning the planner on moves
 * nothing on the cashflow. The reconciliations are directional: more pigs never
 * means fewer pens, a longer finishing period never means fewer finishing pens,
 * and the capacity reported for a stage always covers what the herd plan says
 * was standing in it. Those are the ones that would catch a planner that had
 * quietly stopped reading the simulation.
 *
 * A plan is expensive to simulate, so the cases below are different questions
 * about as few runs as they can be asked of.
 */

function plan(edit: (config: PlannerConfig) => void = () => {}): PlannerConfig {
  const config = cloneDefaultConfig();
  config.project.months = 24;
  config.project.variation = "settled";
  edit(config);
  return config;
}

function housed(config: PlannerConfig): HousingNeedsResult {
  const housing = simulatePlan(config, { snapshots: false, housing: true }).housing;
  if (housing === null) throw new Error("The run was asked for a housing plan and gave none.");
  return housing;
}

const BASE_CONFIG = plan();
const BASE = housed(BASE_CONFIG);

function typeOf(result: HousingNeedsResult, type: HousingType): HousingTypeResult | undefined {
  return result.types.find((entry) => entry.housingType === type);
}

function pensOf(result: HousingNeedsResult, type: HousingType): number {
  return typeOf(result, type)?.minimumPens ?? 0;
}

function growingPens(result: HousingNeedsResult): number {
  return pensOf(result, "weaner") + pensOf(result, "grower") + pensOf(result, "finisher");
}

describe("what the plan is read off", () => {
  it("reads every simulated day rather than the month ends", () => {
    expect(BASE.generatedFromSimulationDayCount).toBe(BASE.lastDay - BASE.firstDay + 1);
    expect(BASE.generatedFromSimulationDayCount).toBeGreaterThan(BASE_CONFIG.project.months);
  });

  it("names the profile every figure came from", () => {
    expect(BASE.policySource).toBe(ARC_HOUSING_POLICY.source);
    for (const type of BASE.types) expect(type.sourceAssumptions.length).toBeGreaterThan(0);
  });

  it("houses a farrow-to-finish herd in all eight kinds of accommodation", () => {
    expect(BASE.types.map((type) => type.housingType)).toEqual([
      "boar",
      "service_sow",
      "gestation",
      "farrowing",
      "gilt",
      "weaner",
      "grower",
      "finisher",
    ]);
  });
});

describe("the invariants", () => {
  it("never recommends less capacity than the simulation required", () => {
    for (const type of BASE.types) {
      expect(type.recommendedPens, type.housingType).toBeGreaterThanOrEqual(type.minimumPens);
      expect(type.moduleCapacityPens, type.housingType).toBeGreaterThanOrEqual(
        type.recommendedPens,
      );
    }
  });

  it("builds every pen with at least the floor the animals in it need", () => {
    for (const type of BASE.types) {
      expect(type.pen, type.housingType).not.toBeNull();
      const pen = type.pen!;
      expect(pen.areaM2).toBeGreaterThanOrEqual(pen.requiredAreaM2 - 1e-9);
      // And the same check the other way round: floor area a head, times the
      // head the pen is rated for, cannot be more than the pen.
      const perHead = areaPerHeadOf(ARC_HOUSING_POLICY, type.housingType, 0).m2PerHead;
      if (type.housingType === "weaner" || type.housingType === "gestation") {
        expect(pen.areaM2).toBeGreaterThanOrEqual(pen.capacityHead * perHead - 1e-9);
      }
    }
  });

  it("draws every pen, room and building as a rectangle", () => {
    for (const type of BASE.types) {
      const pen = type.pen!;
      expect(pen.widthM).toBeGreaterThan(0);
      expect(pen.lengthM).toBeGreaterThan(0);
      expect(pen.areaM2).toBeCloseTo(pen.widthM * pen.lengthM, 6);

      const room = type.room!;
      expect(room.widthM).toBeGreaterThan(0);
      expect(room.lengthM).toBeGreaterThan(0);
      expect(room.areaM2).toBeCloseTo(room.widthM * room.lengthM, 6);
    }
    for (const building of BASE.buildings) {
      expect(building.rectangle.widthM).toBeGreaterThan(0);
      expect(building.rectangle.lengthM).toBeGreaterThan(0);
      expect(building.rectangle.areaM2).toBeCloseTo(
        building.rectangle.widthM * building.rectangle.lengthM,
        6,
      );
      // A footprint has to hold the rooms inside it.
      expect(building.rectangle.areaM2).toBeGreaterThanOrEqual(building.roomAreaM2 - 1e-9);
    }
  });

  it("puts only compatible kinds of pen in one building", () => {
    for (const building of BASE.buildings) {
      for (const section of building.sections) {
        expect(BUILDING_OF[section.housingType]).toBe(building.buildingType);
      }
    }
  });

  it("gives one boar one pen and one sow one farrowing place", () => {
    expect(typeOf(BASE, "boar")?.pen?.capacityHead).toBe(1);
    expect(typeOf(BASE, "farrowing")?.pen?.capacityHead).toBe(1);
    expect(typeOf(BASE, "boar")?.minimumPens).toBe(typeOf(BASE, "boar")?.peakHead);
  });

  it("foots its own totals", () => {
    const rooms = BASE.types.reduce((total, type) => total + (type.room?.roomCount ?? 0), 0);
    const pens = BASE.types.reduce((total, type) => total + type.moduleCapacityPens, 0);
    expect(BASE.totals.rooms).toBe(rooms);
    expect(BASE.totals.pens).toBe(pens);
    expect(BASE.totals.buildings).toBe(BASE.buildings.length);
    expect(BASE.totals.rooms).toBe(
      BASE.buildings.reduce((total, building) => total + building.roomCount, 0),
    );
    expect(BASE.totals.pens).toBe(
      BASE.buildings.reduce((total, building) => total + building.penCount, 0),
    );
  });

  it("shows the working behind every recommendation", () => {
    for (const type of BASE.types) {
      const { derivation } = type;
      expect(derivation.minimumPens).toBe(type.minimumPens);
      expect(derivation.recommendedPens).toBe(type.recommendedPens);
      expect(derivation.moduleCapacityPens).toBe(type.moduleCapacityPens);
      // The parts of the peak account for it: occupied, held and being washed.
      expect(
        derivation.peakOccupiedPens + derivation.peakReservedPens + derivation.peakCleaningPens,
      ).toBe(type.minimumPens);
      expect(derivation.steps.length).toBeGreaterThanOrEqual(5);
    }
  });
});

describe("the farrowing house", () => {
  it("owns places for the week before farrowing and for the days under the hose", () => {
    // The same herd, housed once on the manual's cycle and once on a cycle with
    // no pre-farrow move and no wash-down. The difference between the two is
    // what the cycle costs in crates, and it is a cost a count of suckling sows
    // cannot see.
    //
    // A herd big enough for it to bite: on the default plan's fifteen sows the
    // farrowings are spread far enough apart that the crate freed by one is
    // clean again before the next sow wants it, and both cycles come out at
    // seven places. That is a true answer about a small herd rather than a
    // property of the planner, which is why this asks a larger one.
    const config = plan((edit) => {
      edit.herd.maxSows = 60;
      edit.stock.sows = 40;
    });
    const onCycle = housed(config);
    const bare = simulatePlan(config, {
      snapshots: false,
      housing: true,
      housingPolicy: housingPolicy((policy) => {
        policy.farrowing.preFarrowDays = 0;
        policy.farrowing.cleaningDays = 0;
      }),
    }).housing!;

    expect(pensOf(bare, "farrowing")).toBeGreaterThan(0);
    expect(pensOf(onCycle, "farrowing")).toBeGreaterThan(pensOf(bare, "farrowing"));
    // And the extra places are exactly the ones the cycle explains.
    const farrowing = typeOf(onCycle, "farrowing")!;
    expect(
      farrowing.derivation.peakReservedPens + farrowing.derivation.peakCleaningPens,
    ).toBeGreaterThan(0);
  });

  it("never reports fewer places than there were sows wanting one", () => {
    const farrowing = typeOf(BASE, "farrowing")!;
    expect(farrowing.minimumPens).toBeGreaterThanOrEqual(farrowing.peakHead);
  });

  it("wants more places when the litters are left on the sow longer", () => {
    const later = housed(plan((config) => (config.reproduction.weaningAgeDays = 42)));
    expect(pensOf(later, "farrowing")).toBeGreaterThan(pensOf(BASE, "farrowing"));
  });
});

describe("what moves the requirement", () => {
  it("never shrinks the growing houses because the litters got bigger", () => {
    const bigger = housed(plan((config) => (config.reproduction.bornAlivePerLitter = 15)));
    const smaller = housed(plan((config) => (config.reproduction.bornAlivePerLitter = 9)));
    expect(growingPens(bigger)).toBeGreaterThanOrEqual(growingPens(BASE));
    expect(growingPens(BASE)).toBeGreaterThanOrEqual(growingPens(smaller));
  });

  it("carries fewer pigs, and no more pens, when more of them die", () => {
    const deadly = housed(
      plan((config) => {
        config.growth.weanerMortalityPct = 12;
        config.growth.growerMortalityPct = 10;
        config.growth.finisherMortalityPct = 10;
      }),
    );
    for (const type of ["weaner", "grower", "finisher"] as HousingType[]) {
      expect(typeOf(deadly, type)!.peakHead, type).toBeLessThan(typeOf(BASE, type)!.peakHead);
    }
    expect(growingPens(deadly)).toBeLessThanOrEqual(growingPens(BASE));
  });

  it("needs more finishing pens when the pigs are taken to a heavier weight", () => {
    const heavy = housed(plan((config) => (config.growth.saleWeightKg = 120)));
    expect(pensOf(heavy, "finisher")).toBeGreaterThan(pensOf(BASE, "finisher"));
  });
});

describe("reconciliation with the herd plan", () => {
  const projection = simulatePlan(BASE_CONFIG, { snapshots: false, housing: false }).projection;

  it("houses at least as many head as any month end shows standing", () => {
    const observed: [HousingType, (month: (typeof projection.months)[number]) => number][] = [
      ["weaner", (month) => month.weaners],
      ["grower", (month) => month.growers],
      ["finisher", (month) => month.finishers],
      ["boar", (month) => month.boars],
      ["gilt", (month) => month.gilts],
      ["farrowing", (month) => month.lactatingSows],
    ];
    for (const [type, read] of observed) {
      const peak = Math.max(0, ...projection.months.map(read));
      expect(typeOf(BASE, type)!.peakHead, type).toBeGreaterThanOrEqual(peak);
    }
  });

  it("reports capacity no month end ever exceeds", () => {
    for (const month of projection.months) {
      expect(month.weaners).toBeLessThanOrEqual(typeOf(BASE, "weaner")!.headCapacity);
      expect(month.growers).toBeLessThanOrEqual(typeOf(BASE, "grower")!.headCapacity);
      expect(month.finishers).toBeLessThanOrEqual(typeOf(BASE, "finisher")!.headCapacity);
      expect(month.boars).toBeLessThanOrEqual(typeOf(BASE, "boar")!.headCapacity);
      expect(month.gilts).toBeLessThanOrEqual(typeOf(BASE, "gilt")!.headCapacity);
      expect(month.lactatingSows).toBeLessThanOrEqual(typeOf(BASE, "farrowing")!.headCapacity);
      // A sow is in one of three places, and the breeding side has to hold all
      // of her herd at once whichever of the three she is standing in.
      expect(month.sows).toBeLessThanOrEqual(
        typeOf(BASE, "service_sow")!.headCapacity +
          typeOf(BASE, "gestation")!.headCapacity +
          typeOf(BASE, "farrowing")!.headCapacity,
      );
    }
  });
});

describe("what it does not touch", () => {
  it("leaves the cashflow, the profit and the herd exactly as they were", () => {
    const without = simulatePlan(BASE_CONFIG, { snapshots: false, housing: false });
    const with_ = simulatePlan(BASE_CONFIG, { snapshots: false, housing: true });
    expect(with_.projection).toEqual(without.projection);
    expect(with_.projection.summary).toEqual(without.projection.summary);
    expect(with_.history.length).toBe(without.history.length);
    expect(without.housing).toBeNull();
  });

  it("gives the same plan every time it is asked", () => {
    expect(housed(plan())).toEqual(BASE);
  });
});
