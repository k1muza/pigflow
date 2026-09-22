import type { HousingDemandDay, HousingOccupant } from "./demand";
import {
  areaPerHeadOf,
  cleaningDaysOf,
  headCapacityOf,
  HOUSING_TYPES,
  penAreaOf,
  targetHeadOf,
  type HousingPolicy,
  type HousingType,
  type StageExitWeights,
} from "./rules";

/**
 * The virtual pen allocator.
 *
 * The farm is run past this one morning at a time, and every morning it does
 * what a stockperson does: opens the pens whose cleaning is finished, keeps
 * everybody who is already correctly housed exactly where they are, finds a
 * place for whatever has moved up a stage overnight, and puts a pen that has
 * emptied on to wash.
 *
 * The number this exists to produce is the largest number of pens that ever had
 * to exist at one time. That is the minimum a unit can be built with, and it is
 * not the same as the peak head count divided by pen size — a pen standing empty
 * under the hose is a pen the farm has to own, a batch of three that will not
 * share with a batch of eighteen is two pens, and a sow booked into the
 * farrowing house a week before she is due is holding a place nobody else can
 * have. All three are why this is simulated rather than divided.
 *
 * It is deliberately a first-fit allocator and not an optimiser. A farm does not
 * solve a bin-packing problem every morning, and a plan that can only be
 * reproduced by rerunning a solver is a plan nobody can check.
 *
 * There is no separate batch object here, because the pen is the batch. A group
 * of pigs weaned on one morning fills a pen together, is topped up only by its
 * own cohort while the pen is still filling, and then travels as that pen for as
 * long as it exists — so a batch with an identity of its own would be a second
 * name for a thing already on the page. What a batch is for is kept: a cohort
 * key, a fill window, and the rule that nobody is ever moved for tidiness.
 */

/** Where a pen is in its cycle. An empty pen under the hose is not available. */
export type PenState = "available" | "reserved" | "occupied" | "cleaning";

export type VirtualPen = {
  id: string;
  housingType: HousingType;
  /** Floor area the pen was built with. Fixed: a pen does not grow. */
  areaM2: number;
  /** Head the pen may never exceed, whatever the floor area would allow. */
  maxHead: number;
  state: PenState;
  /** What the current batch is: the key a new arrival has to match to join it. */
  compatibility: string | null;
  /** The group the pen was opened for, which is who it prefers to fill with. */
  cohortId: string | null;
  members: Set<string>;
  /** The heaviest any occupant is expected to get while it is in here. */
  governingWeightKg: number;
  /** The day the current batch started filling it. */
  openedDay: number;
  /**
   * The last day it will take a new arrival, or null for a pen that never shuts
   * its gate. See {@link VirtualPenAllocator.fillWindowOf}.
   */
  closesDay: number | null;
  /** The day it comes back into use, while it is being cleaned. */
  cleaningUntilDay: number | null;
};

/** What one housing type asked of the farm over the whole run. */
export type HousingTypeAllocation = {
  housingType: HousingType;
  /** The floor area one pen of this type is built with. */
  penAreaM2: number;
  /** Head one pen of this type is filled to. */
  penCapacityHead: number;
  /** The most pens that ever had to exist at once: the physical minimum. */
  minimumPens: number;
  /** The day that peak fell on. */
  peakPensDay: number;
  /** The parts of that peak, which is what makes it explicable. */
  peakOccupiedPens: number;
  peakReservedPens: number;
  peakCleaningPens: number;
  /** The most head this type ever had to house, and when. */
  peakHead: number;
  peakHeadDay: number;
  /** Pens the allocator ever had to create. Equal to the peak when it reuses. */
  totalPensCreated: number;
  /**
   * The most pens one intake ever filled: pens opened inside a single fill
   * window.
   *
   * This is what a batch is, measured rather than assumed, and it is the only
   * thing the structure generator needs to know about the herd. A room is the
   * unit a house is emptied, washed and refilled in, so a room larger than a
   * batch cannot be run all in, all out however cheap it looks on paper. Zero
   * for a type that is never turned over as a group, which is not a batch of
   * nothing but an absence of batching.
   */
  batchPens: number;
  /**
   * Pens in use on every simulated day, in order from `firstDay`.
   *
   * The one thing the structure phases cannot work out for themselves. A peak is
   * a single number and it cannot answer the three questions that decide what is
   * actually worth building: when was this capacity first needed, how long was it
   * needed for, and what would fall over if it were not there. All three are
   * read off this series, and none of them can be read off a peak.
   */
  dailyPensInUse: number[];
  /** Pen-days standing in use and pen-days actually holding animals. */
  penDaysInUse: number;
  penDaysOccupied: number;
  /** Animal-days housed, for the average occupancy of a pen of this type. */
  headDays: number;
  /** Batches broken because the pen they were in could not hold them any longer. */
  pensSplitForFloorArea: number;
};

export type HousingAllocation = {
  days: number;
  firstDay: number;
  lastDay: number;
  byType: Record<HousingType, HousingTypeAllocation>;
  /** The most sucklers ever standing in the farrowing house with their dams. */
  peakSucklingPiglets: number;
  /**
   * The heaviest pig of each stage the policy had no floor-area band for. The
   * planner turns these into warnings; they are not silently extrapolated.
   */
  uncoveredWeightKg: Partial<Record<HousingType, number>>;
};

/** Floor area arithmetic lands a hair under a whole head; this is that hair. */
const HEAD_EPSILON = 1e-6;

function emptyAllocation(type: HousingType): HousingTypeAllocation {
  return {
    housingType: type,
    penAreaM2: 0,
    penCapacityHead: 0,
    minimumPens: 0,
    peakPensDay: 0,
    peakOccupiedPens: 0,
    peakReservedPens: 0,
    peakCleaningPens: 0,
    peakHead: 0,
    peakHeadDay: 0,
    totalPensCreated: 0,
    batchPens: 0,
    dailyPensInUse: [],
    penDaysInUse: 0,
    penDaysOccupied: 0,
    headDays: 0,
    pensSplitForFloorArea: 0,
  };
}

/**
 * The pens of one farm, day after day.
 *
 * Fed a day at a time so that the whole herd of a five-year plan never has to be
 * held in memory at once: the allocator sees one morning, decides, records what
 * it decided and forgets the morning.
 */
export class VirtualPenAllocator {
  private readonly policy: HousingPolicy;
  private readonly weights: StageExitWeights;
  private readonly pens = new Map<HousingType, VirtualPen[]>();
  /** Which pen each animal is standing in, so nothing is ever housed twice. */
  private readonly placement = new Map<string, VirtualPen>();
  private readonly totals: Record<HousingType, HousingTypeAllocation>;
  private readonly uncovered: Partial<Record<HousingType, number>> = {};
  /** The day every pen of a type was last opened, in the order they happened. */
  private readonly openings = new Map<HousingType, number[]>();
  private sequence = 0;
  private daysRun = 0;
  private firstDay = 0;
  private lastDay = 0;
  private peakSucklingPiglets = 0;

  constructor(policy: HousingPolicy, weights: StageExitWeights) {
    this.policy = policy;
    this.weights = weights;
    this.totals = Object.fromEntries(
      HOUSING_TYPES.map((type) => [type, emptyAllocation(type)]),
    ) as Record<HousingType, HousingTypeAllocation>;
    for (const type of HOUSING_TYPES) {
      this.pens.set(type, []);
      this.openings.set(type, []);
      this.totals[type].penAreaM2 = penAreaOf(policy, type, weights);
      this.totals[type].penCapacityHead = this.fillLimit(type, this.stageWeightOf(type));
    }
  }

  /** The weight a full pen of this type is built around. */
  private stageWeightOf(type: HousingType): number {
    if (type === "weaner") return this.weights.weaner;
    if (type === "grower") return this.weights.grower;
    if (type === "finisher") return this.weights.finisher;
    return 0;
  }

  /** How many head a pen of this type holds at a given occupant weight. */
  private fillLimit(type: HousingType, governingWeightKg: number): number {
    const area = penAreaOf(this.policy, type, this.weights);
    const perHead = areaPerHeadOf(this.policy, type, governingWeightKg).m2PerHead;
    const byArea = perHead > 0 ? Math.floor(area / perHead + HEAD_EPSILON) : Number.MAX_SAFE_INTEGER;
    return Math.max(1, Math.min(targetHeadOf(this.policy, type), byArea));
  }

  /** The hard ceiling on a pen of this type, floor area included. */
  private hardLimit(type: HousingType, governingWeightKg: number): number {
    const area = penAreaOf(this.policy, type, this.weights);
    const perHead = areaPerHeadOf(this.policy, type, governingWeightKg).m2PerHead;
    const byArea = perHead > 0 ? Math.floor(area / perHead + HEAD_EPSILON) : Number.MAX_SAFE_INTEGER;
    return Math.max(1, Math.min(headCapacityOf(this.policy, type), byArea));
  }

  /** One morning: release, keep, place, wash, record. */
  step(demand: HousingDemandDay): void {
    const day = demand.day;
    if (this.daysRun === 0) this.firstDay = day;
    this.lastDay = day;
    this.daysRun += 1;

    for (const [type, weight] of Object.entries(demand.uncoveredWeightKg)) {
      if (weight === undefined) continue;
      const key = type as HousingType;
      this.uncovered[key] = Math.max(this.uncovered[key] ?? 0, weight);
    }
    this.peakSucklingPiglets = Math.max(this.peakSucklingPiglets, demand.sucklingPiglets);

    this.endCleaning(day);
    const byAnimal = new Map<string, HousingOccupant>();
    for (const occupant of demand.occupants) byAnimal.set(occupant.animalId, occupant);

    const waiting = this.keepHousedAnimals(day, byAnimal, demand.occupants);
    this.placeArrivals(day, waiting);
    this.enforceFloorArea(day);
    this.refreshStates(byAnimal);
    this.record(day, demand);
  }

  /**
   * How many pens one intake of this type filled at its biggest.
   *
   * The fill window is the gate: pens opened inside one of them belong to one
   * batch, because that is the same rule that decides which pen an arriving pig
   * may join. The widest run of openings that fits in a window is therefore the
   * largest group the house ever took in one go — and it is the largest room
   * that house can be run all in, all out with.
   */
  private batchPensOf(type: HousingType): number {
    if (cleaningDaysOf(this.policy, type) <= 0) return 0;
    const days = this.openings.get(type) ?? [];
    const window = Math.max(0, this.policy.structure.penFillWindowDays);
    let widest = 0;
    let start = 0;
    for (let end = 0; end < days.length; end += 1) {
      while (days[end] - days[start] > window) start += 1;
      widest = Math.max(widest, end - start + 1);
    }
    return widest;
  }

  /** Everything the run asked for, once the last day has been stepped. */
  finish(): HousingAllocation {
    for (const type of HOUSING_TYPES) this.totals[type].batchPens = this.batchPensOf(type);
    return {
      days: this.daysRun,
      firstDay: this.firstDay,
      lastDay: this.lastDay,
      byType: this.totals,
      peakSucklingPiglets: this.peakSucklingPiglets,
      uncoveredWeightKg: { ...this.uncovered },
    };
  }

  /** The pens as they stand, for tests and for anything that wants to look. */
  pensOf(type: HousingType): readonly VirtualPen[] {
    return this.pens.get(type) ?? [];
  }

  // ------------------------------------------------------------------ the day

  /** A pen whose washing days are up comes back into the pool. */
  private endCleaning(day: number): void {
    for (const type of HOUSING_TYPES) {
      for (const pen of this.pens.get(type) ?? []) {
        if (pen.state !== "cleaning") continue;
        if (pen.cleaningUntilDay !== null && day < pen.cleaningUntilDay) continue;
        pen.state = "available";
        pen.cleaningUntilDay = null;
        pen.compatibility = null;
        pen.cohortId = null;
        pen.governingWeightKg = 0;
      }
    }
  }

  /**
   * Everybody already correctly housed stays exactly where they are.
   *
   * An animal is only taken out of its pen when it has left the house — sold,
   * dead, weaned, promoted, moved up a stage. It is never moved because another
   * pen would pack better. Repeated pen changing breaks the social order in a
   * group and costs more in fighting and checked growth than the empty places
   * were ever worth.
   *
   * Returns everyone who now needs somewhere to go.
   */
  private keepHousedAnimals(
    day: number,
    byAnimal: ReadonlyMap<string, HousingOccupant>,
    occupants: readonly HousingOccupant[],
  ): HousingOccupant[] {
    for (const type of HOUSING_TYPES) {
      for (const pen of this.pens.get(type) ?? []) {
        if (pen.state !== "occupied" && pen.state !== "reserved") continue;
        for (const member of [...pen.members]) {
          const occupant = byAnimal.get(member);
          // Still here and still in this house: nothing to do, which is the
          // commonest thing that happens to a pig on any given day.
          if (occupant !== undefined && occupant.housingType === pen.housingType) continue;
          pen.members.delete(member);
          this.placement.delete(member);
        }
        if (pen.members.size === 0) {
          this.startCleaning(pen, day);
          continue;
        }
        // Taken afresh from whoever is standing in it, because the pigs in a pen
        // get heavier while they are in it. Left at the weight they were admitted
        // at, a batch could grow up into the next floor-area band without the
        // pen ever noticing that it had become too small for them.
        let governing = 0;
        for (const member of pen.members) {
          governing = Math.max(governing, byAnimal.get(member)?.governingWeightKg ?? 0);
        }
        pen.governingWeightKg = governing;
      }
    }

    const waiting: HousingOccupant[] = [];
    for (const occupant of occupants) {
      if (!this.placement.has(occupant.animalId)) waiting.push(occupant);
    }
    return waiting;
  }

  /** A batch has gone; the pen is out of use until it has been washed down. */
  private startCleaning(pen: VirtualPen, day: number): void {
    const days = cleaningDaysOf(this.policy, pen.housingType);
    if (days <= 0) {
      pen.state = "available";
      pen.cleaningUntilDay = null;
      pen.compatibility = null;
      pen.cohortId = null;
      pen.governingWeightKg = 0;
      return;
    }
    pen.state = "cleaning";
    pen.cleaningUntilDay = day + days;
  }

  /**
   * Somewhere for everybody who moved overnight.
   *
   * Grouped before it is placed, so that a cohort coming up out of the weaner
   * house arrives as a group rather than as thirty separate pigs handled in
   * whatever order the herd array happened to hold them. Within a compatible
   * set the pens already holding that cohort are offered first, then the pen
   * with the least room left, and only then is another pen opened — which is
   * the order that keeps a group together and still fills what is standing
   * empty.
   */
  private placeArrivals(day: number, waiting: readonly HousingOccupant[]): void {
    if (waiting.length === 0) return;
    const groups = new Map<string, HousingOccupant[]>();
    for (const occupant of waiting) {
      const key = occupant.compatibility + " " + occupant.cohortId;
      const group = groups.get(key);
      if (group) group.push(occupant);
      else groups.set(key, [occupant]);
    }

    for (const key of [...groups.keys()].sort()) {
      const group = groups.get(key) as HousingOccupant[];
      group.sort((a, b) => (a.animalId < b.animalId ? -1 : a.animalId > b.animalId ? 1 : 0));
      for (const occupant of group) {
        const pen =
          this.findPen(day, occupant, true) ??
          this.findPen(day, occupant, false) ??
          this.openPen(day, occupant);
        this.admit(pen, occupant);
      }
    }
  }

  /**
   * A pen this animal can join: same house, same batch, still filling and with
   * the floor to take one more. Fullest first, so a part-filled pen is finished
   * before another is opened.
   */
  private findPen(
    day: number,
    occupant: HousingOccupant,
    sameCohort: boolean,
  ): VirtualPen | null {
    let best: VirtualPen | null = null;
    let bestFree = Number.MAX_SAFE_INTEGER;
    for (const pen of this.pens.get(occupant.housingType) ?? []) {
      if (pen.state !== "occupied" && pen.state !== "reserved") continue;
      if (pen.compatibility !== occupant.compatibility) continue;
      if (sameCohort && pen.cohortId !== occupant.cohortId) continue;
      // The batch in this pen is closed. A farm fills a pen over a few days and
      // then shuts the gate; it does not drip one more pig into a settled group
      // a month later, and a pen that never closes never empties to be washed.
      if (pen.closesDay !== null && day > pen.closesDay) continue;
      const governing = Math.max(pen.governingWeightKg, occupant.governingWeightKg);
      const free = this.fillLimit(pen.housingType, governing) - pen.members.size;
      if (free <= 0) continue;
      if (free < bestFree || (free === bestFree && best !== null && pen.id < best.id)) {
        best = pen;
        bestFree = free;
      }
    }
    return best;
  }

  /** A pen back off the wash, or a new one if every pen the farm has is busy. */
  private openPen(day: number, occupant: HousingOccupant): VirtualPen {
    const pool = this.pens.get(occupant.housingType) as VirtualPen[];
    let pen = pool.find((candidate) => candidate.state === "available") ?? null;
    if (pen === null) {
      this.sequence += 1;
      pen = {
        id: occupant.housingType + "-" + String(this.sequence).padStart(4, "0"),
        housingType: occupant.housingType,
        areaM2: penAreaOf(this.policy, occupant.housingType, this.weights),
        maxHead: headCapacityOf(this.policy, occupant.housingType),
        state: "available",
        compatibility: null,
        cohortId: null,
        members: new Set(),
        governingWeightKg: 0,
        openedDay: day,
        closesDay: null,
        cleaningUntilDay: null,
      };
      pool.push(pen);
      this.totals[occupant.housingType].totalPensCreated += 1;
    }
    pen.compatibility = occupant.compatibility;
    pen.cohortId = occupant.cohortId;
    pen.openedDay = day;
    pen.closesDay = this.fillWindowOf(occupant.housingType, day);
    pen.governingWeightKg = 0;
    // Recorded in the order it happened, which is ascending by day, so the batch
    // size can be read off it afterwards with one pass and no sorting.
    this.openings.get(occupant.housingType)?.push(day);
    return pen;
  }

  /**
   * The day a pen of this type stops taking arrivals, or null if it never does.
   *
   * A pen only has a gate to shut where it is run all in, all out: the batch
   * goes in together, leaves together, and the pen is washed before the next.
   * The cleaning days are what say a type is run that way, so they are also what
   * decides whether the fill window applies.
   *
   * It matters more than it looks. A gestation pen and a gilt pen are held
   * continuously — a sow joins the group the day she is confirmed in pig and
   * leaves it the week before she farrows — so closing them after a week would
   * mean a fresh pen for almost every sow, and a twenty-sow herd would be shown
   * needing nine group pens for four pens' worth of sows.
   */
  private fillWindowOf(type: HousingType, day: number): number | null {
    if (cleaningDaysOf(this.policy, type) <= 0) return null;
    return day + this.policy.structure.penFillWindowDays;
  }

  private admit(pen: VirtualPen, occupant: HousingOccupant): void {
    pen.members.add(occupant.animalId);
    pen.governingWeightKg = Math.max(pen.governingWeightKg, occupant.governingWeightKg);
    pen.state = "occupied";
    this.placement.set(occupant.animalId, pen);
  }

  /**
   * Which pens are held rather than filled.
   *
   * Settled every morning rather than when an animal walks in, because the thing
   * that changes it is the animal changing: the sow moved into the farrowing
   * house a week early is holding a reserved place until the morning she
   * farrows, and nobody moves her to mark the difference.
   */
  private refreshStates(byAnimal: ReadonlyMap<string, HousingOccupant>): void {
    for (const type of HOUSING_TYPES) {
      for (const pen of this.pens.get(type) ?? []) {
        if (pen.state !== "occupied" && pen.state !== "reserved") continue;
        let held = true;
        for (const member of pen.members) {
          if (byAnimal.get(member)?.reserved !== true) {
            held = false;
            break;
          }
        }
        pen.state = held ? "reserved" : "occupied";
      }
    }
  }

  /**
   * A pen that its own batch has outgrown.
   *
   * Pigs are not moved for tidiness, but they are moved when the floor will not
   * hold them: a batch that has gone up a weight band needs more square metres a
   * head than the pen was poured for, and the alternative to splitting it is a
   * plan that reports a pen holding more pigs than it has room for. The pigs
   * that go are the ones latest in the pen, so the same run always splits the
   * same way.
   */
  private enforceFloorArea(day: number): void {
    for (const type of HOUSING_TYPES) {
      for (const pen of [...(this.pens.get(type) ?? [])]) {
        if (pen.state !== "occupied" && pen.state !== "reserved") continue;
        const limit = this.hardLimit(type, pen.governingWeightKg);
        if (pen.members.size <= limit) continue;
        const leaving = [...pen.members].sort().slice(limit);
        for (const animalId of leaving) {
          pen.members.delete(animalId);
          this.placement.delete(animalId);
        }
        this.totals[type].pensSplitForFloorArea += 1;
        const occupant: HousingOccupant = {
          animalId: "",
          housingType: type,
          cohortId: pen.cohortId ?? "",
          governingWeightKg: pen.governingWeightKg,
          compatibility: pen.compatibility ?? "",
          reserved: false,
        };
        for (const animalId of leaving) {
          const moved = { ...occupant, animalId };
          const target = this.findPen(day, moved, true) ?? this.openPen(day, moved);
          this.admit(target, moved);
        }
      }
    }
  }

  /** What the day cost in pens, and whether it was the worst one so far. */
  private record(day: number, demand: HousingDemandDay): void {
    for (const type of HOUSING_TYPES) {
      let occupied = 0;
      let reserved = 0;
      let cleaning = 0;
      let head = 0;
      for (const pen of this.pens.get(type) ?? []) {
        if (pen.state === "occupied") occupied += 1;
        else if (pen.state === "reserved") reserved += 1;
        else if (pen.state === "cleaning") cleaning += 1;
        head += pen.members.size;
      }
      const inUse = occupied + reserved + cleaning;
      const totals = this.totals[type];
      totals.dailyPensInUse.push(inUse);
      totals.penDaysInUse += inUse;
      totals.penDaysOccupied += occupied + reserved;
      totals.headDays += head;
      if (inUse > totals.minimumPens) {
        totals.minimumPens = inUse;
        totals.peakPensDay = day;
        totals.peakOccupiedPens = occupied;
        totals.peakReservedPens = reserved;
        totals.peakCleaningPens = cleaning;
      }
      const wanted = demand.head[type];
      if (wanted > totals.peakHead) {
        totals.peakHead = wanted;
        totals.peakHeadDay = day;
      }
    }
  }
}

/**
 * Runs a whole series of days through a fresh allocator. The library entry point
 * is the streaming one above; this is for tests and for anything that already
 * holds the days it wants to house.
 */
export function allocateHousing(
  demand: readonly HousingDemandDay[],
  policy: HousingPolicy,
  weights: StageExitWeights,
): HousingAllocation {
  const allocator = new VirtualPenAllocator(policy, weights);
  for (const day of demand) allocator.step(day);
  return allocator.finish();
}
