import { describe, expect, it } from "vitest";

import { cloneDefaultConfig } from "../config";
import { allocateHousing, VirtualPenAllocator, type HousingAllocation } from "./allocator";
import { housingDemandOf, type HousingAnimalSnapshot } from "./demand";
import {
  areaPerHeadOf,
  ARC_HOUSING_POLICY,
  HOUSING_TYPES,
  housingPolicy,
  stageExitWeights,
  type HousingPolicy,
  type HousingType,
  type StageExitWeights,
} from "./rules";

/**
 * The allocator, on farms small enough to count by hand.
 *
 * Everything here is a herd written out one animal at a time rather than one
 * simulated, because the questions worth asking of a first-fit allocator are
 * exactly the ones a three-sow example answers unambiguously: does a place get
 * held before the sow needs it, does a pen stay shut while it is being washed,
 * does the twenty-first weaner open a second pen. A simulated herd cannot
 * answer any of those without also being a test of the simulation.
 */

const WEIGHTS = stageExitWeights(cloneDefaultConfig());

function sow(
  id: string,
  state: "open" | "gestating" | "lactating",
  extra: { due?: number; wean?: number } = {},
): HousingAnimalSnapshot {
  return {
    id,
    kind: "sow",
    reproductiveState: state,
    weightKg: 210,
    ageDays: 450,
    sex: "female",
    expectedFarrowDay: extra.due,
    expectedWeanDay: extra.wean,
  };
}

function boar(id: string): HousingAnimalSnapshot {
  return { id, kind: "boar", weightKg: 250, ageDays: 500, sex: "male" };
}

function pig(
  id: string,
  stage: "weaner" | "grower" | "finisher",
  weightKg: number,
  cohortId: string,
  sex: "male" | "female" = "female",
): HousingAnimalSnapshot {
  return { id, kind: "pig", stage, weightKg, ageDays: 100, cohortId, sex };
}

/** A pen of like animals, numbered so the ids sort the way they were made. */
function litter(
  count: number,
  build: (index: number) => HousingAnimalSnapshot,
): HousingAnimalSnapshot[] {
  return Array.from({ length: count }, (_, index) => build(index));
}

type Stage = (day: number) => HousingAnimalSnapshot[];

function runDays(
  stage: Stage,
  from: number,
  to: number,
  policy: HousingPolicy = ARC_HOUSING_POLICY,
  weights: StageExitWeights = WEIGHTS,
): HousingAllocation {
  const days = [];
  for (let day = from; day <= to; day += 1) {
    days.push(housingDemandOf(day, stage(day), policy, weights));
  }
  return allocateHousing(days, policy, weights);
}

function pensOf(allocation: HousingAllocation, type: HousingType): number {
  return allocation.byType[type].minimumPens;
}

describe("farrowing places", () => {
  it("holds a place from a week before the sow is due", () => {
    const policy = ARC_HOUSING_POLICY;
    const due = 20;
    const before = housingDemandOf(
      due - policy.farrowing.preFarrowDays - 1,
      [sow("S1", "gestating", { due })],
      policy,
      WEIGHTS,
    );
    const onTheDay = housingDemandOf(
      due - policy.farrowing.preFarrowDays,
      [sow("S1", "gestating", { due })],
      policy,
      WEIGHTS,
    );

    expect(before.head.gestation).toBe(1);
    expect(before.head.farrowing).toBe(0);
    expect(onTheDay.head.farrowing).toBe(1);
    expect(onTheDay.head.gestation).toBe(0);
    expect(onTheDay.occupants[0].reserved).toBe(true);
  });

  it("counts a reserved place as a place the farm has to own", () => {
    // Two sows due a fortnight apart, each carried through her week of
    // reservation and nothing else. The second is still in gestation while the
    // first is holding her crate, so one crate does for both.
    const one = runDays(() => [sow("S1", "gestating", { due: 20 })], 13, 19);
    expect(pensOf(one, "farrowing")).toBe(1);
    expect(one.byType.farrowing.peakReservedPens).toBe(1);
    expect(one.byType.farrowing.peakOccupiedPens).toBe(0);
  });

  it("keeps the place out of use while it is being washed down", () => {
    const policy = ARC_HOUSING_POLICY;
    const allocator = new VirtualPenAllocator(policy, WEIGHTS);
    // She suckles to day 9 and is gone on day 10.
    for (let day = 0; day <= 9; day += 1) {
      allocator.step(housingDemandOf(day, [sow("S1", "lactating")], policy, WEIGHTS));
    }
    allocator.step(housingDemandOf(10, [], policy, WEIGHTS));

    const pen = allocator.pensOf("farrowing")[0];
    expect(pen.state).toBe("cleaning");
    for (let day = 11; day < 10 + policy.farrowing.cleaningDays; day += 1) {
      allocator.step(housingDemandOf(day, [], policy, WEIGHTS));
      expect(allocator.pensOf("farrowing")[0].state).toBe("cleaning");
    }
    allocator.step(housingDemandOf(10 + policy.farrowing.cleaningDays, [], policy, WEIGHTS));
    expect(allocator.pensOf("farrowing")[0].state).toBe("available");
  });

  it("will not let the next sow in early, and owns a second place instead", () => {
    const policy = ARC_HOUSING_POLICY;
    const wash = policy.farrowing.cleaningDays;
    // One sow out on day 10; the next arrives while the place is still wet.
    const early = runDays(
      (day) => [
        ...(day <= 9 ? [sow("S1", "lactating")] : []),
        ...(day >= 10 + wash - 1 ? [sow("S2", "lactating")] : []),
      ],
      0,
      20,
    );
    expect(pensOf(early, "farrowing")).toBe(2);

    // The same two sows, with the second held back one more day.
    const patient = runDays(
      (day) => [
        ...(day <= 9 ? [sow("S1", "lactating")] : []),
        ...(day >= 10 + wash ? [sow("S2", "lactating")] : []),
      ],
      0,
      20,
    );
    expect(pensOf(patient, "farrowing")).toBe(1);
  });

  it("wants another place for every farrowing that overlaps another", () => {
    const one = runDays(() => [sow("S1", "lactating")], 0, 30);
    const two = runDays(() => [sow("S1", "lactating"), sow("S2", "lactating")], 0, 30);
    const three = runDays(
      () => [sow("S1", "lactating"), sow("S2", "lactating"), sow("S3", "lactating")],
      0,
      30,
    );
    expect(pensOf(one, "farrowing")).toBe(1);
    expect(pensOf(two, "farrowing")).toBe(2);
    expect(pensOf(three, "farrowing")).toBe(3);
  });

  it("never puts two sows in one farrowing place", () => {
    const policy = ARC_HOUSING_POLICY;
    const allocator = new VirtualPenAllocator(policy, WEIGHTS);
    const herd = litter(6, (index) => sow("S" + index, "lactating"));
    for (let day = 0; day <= 5; day += 1) {
      allocator.step(housingDemandOf(day, herd, policy, WEIGHTS));
    }
    for (const pen of allocator.pensOf("farrowing")) expect(pen.members.size).toBeLessThanOrEqual(1);
    expect(allocator.pensOf("farrowing")).toHaveLength(6);
  });
});

describe("group pens", () => {
  it("fits a standard weaner group in one pen", () => {
    const allocation = runDays(
      () => litter(20, (index) => pig("P" + index, "weaner", 10, "W0")),
      0,
      10,
    );
    expect(pensOf(allocation, "weaner")).toBe(1);
  });

  it("opens a second pen for the twenty-first weaner", () => {
    const allocation = runDays(
      () => litter(21, (index) => pig("P" + String(index).padStart(2, "0"), "weaner", 10, "W0")),
      0,
      10,
    );
    expect(pensOf(allocation, "weaner")).toBe(2);
  });

  it("keeps a cohort together as it trickles up out of the weaner house", () => {
    // Twenty growers of one cohort, arriving seven, seven and six over three
    // mornings. A pen still filling takes its own group's stragglers, so this
    // is one pen and not three.
    const arrived = (day: number) => (day === 0 ? 7 : day === 1 ? 14 : 20);
    const allocation = runDays(
      (day) =>
        litter(arrived(day), (index) =>
          pig("P" + String(index).padStart(2, "0"), "grower", 35, "W0"),
        ),
      0,
      20,
    );
    expect(pensOf(allocation, "grower")).toBe(1);
  });

  it("never lets a finishing pen exceed the head it is configured for", () => {
    const policy = ARC_HOUSING_POLICY;
    const allocator = new VirtualPenAllocator(policy, WEIGHTS);
    for (let day = 0; day <= 20; day += 1) {
      const herd = litter(37, (index) =>
        pig("P" + String(index).padStart(2, "0"), "finisher", 70, "W0", index % 2 ? "male" : "female"),
      );
      allocator.step(housingDemandOf(day, herd, policy, WEIGHTS));
    }
    for (const pen of allocator.pensOf("finisher")) {
      expect(pen.members.size).toBeLessThanOrEqual(policy.finisher.maxHeadPerPen);
    }
  });

  it("pens males apart from females where the policy says to", () => {
    const mixed = runDays(
      () =>
        litter(10, (index) =>
          pig("P" + index, "finisher", 70, "W0", index < 5 ? "male" : "female"),
        ),
      0,
      5,
    );
    // Ten pigs would be one pen of ten if sex did not matter. It does.
    expect(pensOf(mixed, "finisher")).toBe(2);

    const together = runDays(
      () =>
        litter(10, (index) =>
          pig("P" + index, "finisher", 70, "W0", index < 5 ? "male" : "female"),
        ),
      0,
      5,
      housingPolicy((policy) => (policy.finisher.separateSexes = false)),
    );
    expect(pensOf(together, "finisher")).toBe(1);
  });

  it("takes more pens when the floor will not hold the head the pen is rated for", () => {
    // A unit that sells at 90 kg builds its finishing pens at 0.95 m² a head:
    // ten places on 9.5 m² of floor. Run the same pens with pigs that reach
    // 100 kg and the manual's next band applies at 1.30 m² a head, so the pen
    // is a seven-place pen — without a single extra pig being on the farm.
    const policy = housingPolicy((edit) => {
      edit.finisher.separateSexes = false;
    });
    const weights: StageExitWeights = { weaner: 30, grower: 60, finisher: 90 };
    const atRating = runDays(
      () => litter(10, (index) => pig("P" + index, "finisher", 85, "W0")),
      0,
      5,
      policy,
      weights,
    );
    const heavier = runDays(
      () => litter(10, (index) => pig("P" + index, "finisher", 100, "W0")),
      0,
      5,
      policy,
      weights,
    );

    expect(atRating.byType.finisher.penCapacityHead).toBe(10);
    expect(pensOf(atRating, "finisher")).toBe(1);
    expect(pensOf(heavier, "finisher")).toBe(2);
  });

  it("splits a pen its own batch has grown out of", () => {
    // The same ten pigs, in a pen rated for ten of them, putting on the weight
    // that takes them into the next floor-area band while they stand there. The
    // pen cannot hold all ten any more, so three of them are moved — which is a
    // real event on a real farm and is recorded as one.
    const policy = housingPolicy((edit) => (edit.finisher.separateSexes = false));
    const weights: StageExitWeights = { weaner: 30, grower: 60, finisher: 90 };
    const allocation = runDays(
      (day) => litter(10, (index) => pig("P" + index, "finisher", day < 3 ? 85 : 100, "W0")),
      0,
      6,
      policy,
      weights,
    );
    expect(allocation.byType.finisher.pensSplitForFloorArea).toBe(1);
    expect(pensOf(allocation, "finisher")).toBe(2);
  });

  it("says so rather than extrapolating past the heaviest band it has a rule for", () => {
    const allocation = runDays(
      () => litter(4, (index) => pig("P" + index, "finisher", 140, "W0")),
      0,
      3,
    );
    expect(allocation.uncoveredWeightKg.finisher).toBe(140);
  });
});

describe("the pen pool", () => {
  it("opens another pen only when every pen it owns is busy", () => {
    const allocation = runDays(
      (day) => litter(day < 5 ? 20 : 40, (index) => pig("P" + index, "weaner", 10, "W" + index)),
      0,
      10,
    );
    // Twenty pigs in cohorts of one, then forty: one pen a cohort until the
    // pens run out, and never a pen more than the day needed.
    expect(pensOf(allocation, "weaner")).toBe(allocation.byType.weaner.totalPensCreated);
  });

  it("reuses a pen that has come back off the wash rather than building one", () => {
    const policy = ARC_HOUSING_POLICY;
    const wash = policy.weaner.cleaningDays;
    const allocation = runDays(
      (day) =>
        day <= 9
          ? litter(20, (index) => pig("A" + index, "weaner", 10, "W0"))
          : day >= 10 + wash
            ? litter(20, (index) => pig("B" + index, "weaner", 10, "W1"))
            : [],
      0,
      40,
    );
    expect(pensOf(allocation, "weaner")).toBe(1);
    expect(allocation.byType.weaner.totalPensCreated).toBe(1);
  });

  it("never owns more pens than the busiest morning needed", () => {
    // The property the whole plan rests on: the pens created and the peak
    // simultaneous requirement are the same number, for every kind of housing.
    const allocation = runDays(
      (day) => [
        boar("B1"),
        sow("S1", "open"),
        sow("S2", "gestating", { due: 400 }),
        sow("S3", "lactating"),
        ...litter(day % 3 === 0 ? 25 : 12, (index) =>
          pig("P" + String(index).padStart(2, "0"), "grower", 40, "W" + Math.floor(day / 10)),
        ),
      ],
      0,
      60,
    );
    for (const totals of Object.values(allocation.byType)) {
      expect(totals.totalPensCreated).toBe(totals.minimumPens);
    }
  });

  it("never lets a pen hold more pigs than its floor has room for", () => {
    // One batch of finishers taken right up through the floor-area bands, day
    // by day. The pen was poured for a weight; the pigs go past it; the pen has
    // to stop holding them all before it holds more than it has floor for.
    const policy = ARC_HOUSING_POLICY;
    const allocator = new VirtualPenAllocator(policy, WEIGHTS);
    for (let day = 0; day <= 50; day += 1) {
      const herd = litter(24, (index) =>
        pig("P" + String(index).padStart(2, "0"), "finisher", 60 + day, "W0"),
      );
      allocator.step(housingDemandOf(day, herd, policy, WEIGHTS));
      for (const type of HOUSING_TYPES) {
        for (const pen of allocator.pensOf(type)) {
          const perHead = areaPerHeadOf(policy, type, pen.governingWeightKg).m2PerHead;
          expect(pen.members.size * perHead).toBeLessThanOrEqual(pen.areaM2 + 1e-6);
        }
      }
    }
  });

  it("houses every animal that needs housing, exactly once", () => {
    const policy = ARC_HOUSING_POLICY;
    const allocator = new VirtualPenAllocator(policy, WEIGHTS);
    const herd = (day: number) => [
      boar("B1"),
      sow("S1", "open"),
      sow("S2", "gestating", { due: 400 }),
      sow("S3", "lactating"),
      ...litter(20 + (day % 4), (index) =>
        pig("P" + String(index).padStart(2, "0"), "finisher", 70, "W" + (index % 3)),
      ),
    ];
    for (let day = 0; day <= 30; day += 1) {
      const demand = housingDemandOf(day, herd(day), policy, WEIGHTS);
      allocator.step(demand);

      const housed = new Set<string>();
      for (const type of HOUSING_TYPES) {
        for (const pen of allocator.pensOf(type)) {
          for (const member of pen.members) {
            expect(housed.has(member)).toBe(false);
            housed.add(member);
          }
        }
      }
      expect(housed.size).toBe(demand.occupants.length);
    }
  });
});
