import {
  housingDemandOf,
  housingSnapshots,
  type HerdDeparture,
  type HousingAnimalSnapshot,
  type HousingHerdView,
} from "../demand";
import {
  areaPerHeadOf,
  cleaningDaysOf,
  type HousingPolicy,
  type HousingType,
  type StageExitWeights,
} from "../rules";
import {
  emptyHistory,
  type HousingConflict,
  type HousingHistory,
  type HousingMovementEvent,
  type MovementReason,
  type PenStatusEvent,
} from "./history";
import {
  penAccepts,
  type HousedStage,
  type PhysicalFarmPlan,
  type PhysicalLocation,
  type PhysicalPen,
} from "./model";
import {
  deriveFromPens,
  type PenOccupant,
  type PenHousingState,
  type PenStatus,
  type PhysicalFarmState,
  type UnhousedOccupant,
} from "./state";
import type {
  HousingSimulationResult,
  PenUtilizationSummary,
  RoomUtilizationSummary,
} from "./result";

/**
 * The physical pen allocator.
 *
 * The needs planner asks how many pens a herd would have to have. This asks the
 * opposite question, of a farm that has already been built: given these pens,
 * standing in these rooms, commissioned on these dates, where does every animal
 * actually go this morning — and what happens when the answer is nowhere.
 *
 * It does what a stockperson does, in the order a stockperson does it. Pens
 * whose building work has landed are opened; pens whose washing days are up come
 * back into use; everybody who left the farm overnight is taken off the board;
 * everybody still correctly housed is left exactly where they are; whatever has
 * moved up a stage, come into the farrowing house or been born is given a place;
 * and a pen that has emptied goes on to wash.
 *
 * Two rules matter more than the rest of it put together.
 *
 * Nothing is ever moved to make the packing tidier. An animal moves because
 * something happened to it — it was weaned, it went up a stage, it is due to
 * farrow — and never because another arrangement of the same animals would
 * score a little better. Repeated regrouping costs more in fighting and checked
 * growth than an empty place is worth, and a plan that reshuffles a farm every
 * morning is not a plan anybody could follow.
 *
 * And a pen is never overfilled. Where there is no valid pen the animal is left
 * unhoused and a conflict is written naming it, the day, the house and the
 * reason. That is the honest answer, and it is the one the whole exercise is
 * for: silently putting two batches in one pen would make the housing plan look
 * right and the farm impossible.
 */

/** Floor-area arithmetic lands a hair under a whole head; this is that hair. */
const HEAD_EPSILON = 1e-6;

/** One animal, as the allocator has to think about it today. */
type Requirement = {
  animalId: string;
  housingType: HousingType;
  stage: HousedStage;
  /** The group it belongs with, which is what keeps a pen together. */
  cohortId: string;
  governingWeightKg: number;
  /** What it can share a pen with: house, floor-area band and, where kept apart, sex. */
  compatibility: string;
  /** Holding a place ahead of using it, which a sow booked into farrowing does. */
  reserved: boolean;
  /** The day a held place is expected to be used: when the sow in it is due. */
  reservedUntilDay?: number;
  /** Whether it is housed as a named animal rather than as one of a group. */
  individual: boolean;
  /** A piglet on the sow, which stands in her pen and takes none of its places. */
  suckling: boolean;
  /** The dam whose pen a suckler inherits. */
  damId?: string;
  /** Where it was standing when it was taken out of its pen this morning. */
  from?: PhysicalLocation;
  fromType?: HousingType;
  /**
   * What it was recorded as in the pen it has just left.
   *
   * Not always what it is now. A litter is the group "born on the 20th" while it
   * is on the sow and the batch "weaned on the 40th" the moment it comes off
   * her, and a gilt that is promoted stops being one of a group of gilts and
   * becomes a sow with a name. The pen it left has to be given back what it was
   * holding rather than what the animal has since become.
   */
  fromIdentity?: { individual: boolean; cohortId: string };
};

type Resident = {
  animalId: string;
  cohortId: string;
  individual: boolean;
  suckling: boolean;
};

type PenRuntime = {
  pen: PhysicalPen;
  location: PhysicalLocation;
  /** Position in the plan, which settles every tie deterministically. */
  order: number;
  status: PenStatus;
  members: Map<string, Resident>;
  /** What the batch in it is: the key an arrival has to match to join it. */
  compatibility: string | null;
  /** The group it was opened for, which is who it prefers to fill with. */
  cohortId: string | null;
  openedDay: number;
  /** The last day it takes an arrival, or null for a pen that never shuts its gate. */
  closesDay: number | null;
  cleaningUntilDay: number | null;
  reservedUntilDay: number | null;
  /** Head taking a place in it. Sucklers are counted apart. */
  occupiedHead: number;
  sucklingHead: number;
  /** What the pen did over the run, for the utilization read-out. */
  daysCommissioned: number;
  daysOccupied: number;
  daysReserved: number;
  daysCleaning: number;
  daysAvailable: number;
  headDays: number;
  peakHead: number;
  peakDay: number;
  movementsIn: number;
};

/** One move, before the day's moves are gathered into events. */
type Move = {
  animalId: string;
  cohortId: string;
  individual: boolean;
  from?: PhysicalLocation;
  to?: PhysicalLocation;
  reason: MovementReason;
  housingType: HousingType;
};

export type PhysicalAllocatorOptions = {
  /** Kept movements. A run that only wants the final state can turn them off. */
  keepHistory?: boolean;
};

/**
 * The farm's pens, day after day.
 *
 * Fed one morning at a time so that a five-year plan never holds more than one
 * morning of the herd in memory, and so that it can ride along with the run that
 * is happening anyway rather than being a second pass over it.
 */
export class PhysicalHousingAllocator {
  readonly plan: PhysicalFarmPlan;
  private readonly policy: HousingPolicy;
  private readonly weights: StageExitWeights;
  private readonly pens: PenRuntime[] = [];
  private readonly penById = new Map<string, PenRuntime>();
  private readonly byType = new Map<HousingType, PenRuntime[]>();
  /** Which pen each animal is standing in. At most one, always. */
  private readonly placement = new Map<string, PenRuntime>();
  private readonly history: HousingHistory = emptyHistory();
  private readonly conflicts: HousingConflict[] = [];
  /** Today's conflict lines by house and reason, so each is written once. */
  private conflictsToday = new Map<string, HousingConflict>();
  private readonly commissionedRooms = new Set<string>();
  private readonly keepHistory: boolean;
  /** Animals with a requirement and nowhere to stand, carried day to day. */
  private unhoused = new Map<string, HousingType>();
  private daysRun = 0;
  private firstDay = 0;
  private lastDay = 0;
  private peakUnhousedHead = 0;
  private peakUnhousedDay = 0;

  constructor(
    plan: PhysicalFarmPlan,
    policy: HousingPolicy,
    weights: StageExitWeights,
    options: PhysicalAllocatorOptions = {},
  ) {
    this.plan = plan;
    this.policy = policy;
    this.weights = weights;
    this.keepHistory = options.keepHistory !== false;

    let order = 0;
    for (const building of plan.buildings) {
      for (const room of building.rooms) {
        for (const pen of room.pens) {
          const runtime: PenRuntime = {
            pen,
            location: { buildingId: building.id, roomId: room.id, penId: pen.id },
            order: order++,
            status: "NOT_COMMISSIONED",
            members: new Map(),
            compatibility: null,
            cohortId: null,
            openedDay: 0,
            closesDay: null,
            cleaningUntilDay: null,
            reservedUntilDay: null,
            occupiedHead: 0,
            sucklingHead: 0,
            daysCommissioned: 0,
            daysOccupied: 0,
            daysReserved: 0,
            daysCleaning: 0,
            daysAvailable: 0,
            headDays: 0,
            peakHead: 0,
            peakDay: 0,
            movementsIn: 0,
          };
          this.pens.push(runtime);
          this.penById.set(pen.id, runtime);
          const pool = this.byType.get(pen.housingType);
          if (pool) pool.push(runtime);
          else this.byType.set(pen.housingType, [runtime]);
        }
      }
    }
  }

  /** One morning of the run, as the engine left the herd. */
  observe(day: number, herd: HousingHerdView): void {
    this.step(day, housingSnapshots(day, herd), herd.departures ?? []);
  }

  /**
   * One morning, from the herd already read.
   *
   * Taken as snapshots rather than as the herd so that a caller running the
   * needs planner alongside this one reads the animals once and houses them
   * twice, which on a long plan is the difference between one pass over the herd
   * a day and two.
   */
  step(
    day: number,
    animals: readonly HousingAnimalSnapshot[],
    departures: readonly HerdDeparture[] = [],
  ): void {
    if (this.daysRun === 0) this.firstDay = day;
    this.lastDay = day;
    this.daysRun += 1;
    this.conflictsToday = new Map();

    const statusBefore = this.pens.map((pen) => pen.status);
    const moves: Move[] = [];

    this.commission(day);
    this.endCleaning(day);

    const requirements = this.requirementsOf(day, animals);
    this.releaseDeparted(requirements, departures, moves);
    const waiting = this.releaseMoved(requirements);
    this.place(day, waiting, moves);
    this.washEmptied(day);
    this.settleStatus(requirements);

    this.recordMoves(moves);
    this.recordStatus(day, statusBefore);
    this.recordDay(day);
  }

  /** Everything the run did with the housing, once the last day has been stepped. */
  finish(): HousingSimulationResult {
    const pens: Record<string, PenHousingState> = {};
    for (const pen of this.pens) pens[pen.pen.id] = this.penStateOf(pen);
    const derived = deriveFromPens(this.plan, pens);
    const unhoused: UnhousedOccupant[] = [...this.unhoused.entries()]
      .map(([animalId, housingType]) => ({ animalId, housingType }))
      .sort((a, b) => (a.animalId < b.animalId ? -1 : 1));

    const finalState: PhysicalFarmState = {
      day: this.lastDay,
      pens,
      rooms: derived.rooms,
      buildings: derived.buildings,
      entityLocations: this.locationsNow(),
      unhoused,
    };

    let housed = 0;
    let capacity = 0;
    for (const pen of this.pens) {
      housed += pen.occupiedHead + pen.sucklingHead;
      capacity += pen.pen.maxHead;
    }

    return {
      plan: this.plan,
      firstDay: this.firstDay,
      lastDay: this.lastDay,
      days: this.daysRun,
      movements: this.history.movements,
      conflicts: this.conflicts,
      statusChanges: this.history.statusChanges,
      commissionings: this.history.commissionings,
      finalState,
      penUtilization: this.penUtilization(),
      roomUtilization: this.roomUtilization(),
      totals: {
        movements: this.history.movements.length,
        conflicts: this.conflicts.length,
        daysWithConflicts: new Set(this.conflicts.map((conflict) => conflict.day)).size,
        peakUnhousedHead: this.peakUnhousedHead,
        peakUnhousedDay: this.peakUnhousedDay,
        finalHousedHead: housed,
        designHeadCapacity: capacity,
      },
    };
  }

  /** The farm as it stands, for a test or a caller watching it run. */
  state(): PhysicalFarmState {
    const pens: Record<string, PenHousingState> = {};
    for (const pen of this.pens) pens[pen.pen.id] = this.penStateOf(pen);
    const derived = deriveFromPens(this.plan, pens);
    return {
      day: this.lastDay,
      pens,
      rooms: derived.rooms,
      buildings: derived.buildings,
      entityLocations: this.locationsNow(),
      unhoused: [...this.unhoused.entries()]
        .map(([animalId, housingType]) => ({ animalId, housingType }))
        .sort((a, b) => (a.animalId < b.animalId ? -1 : 1)),
    };
  }

  /** The events as they stand. The record; everything else is a fold of it. */
  get events(): HousingHistory {
    return this.history;
  }

  // ------------------------------------------------------------ the morning

  /** Building work that has landed. A room opens whole, with all of its pens. */
  private commission(day: number): void {
    for (const building of this.plan.buildings) {
      for (const room of building.rooms) {
        if (room.commissionedDay > day) continue;
        if (this.commissionedRooms.has(room.id)) continue;
        this.commissionedRooms.add(room.id);
        let head = 0;
        for (const pen of room.pens) {
          const runtime = this.penById.get(pen.id);
          if (!runtime || runtime.status !== "NOT_COMMISSIONED") continue;
          runtime.status = "AVAILABLE";
          head += pen.maxHead;
        }
        if (this.keepHistory) {
          this.history.commissionings.push({
            day,
            buildingId: building.id,
            roomId: room.id,
            housingType: room.housingType,
            pens: room.pens.length,
            headCapacity: head,
          });
        }
      }
    }
  }

  /** A pen whose washing days are up comes back into the pool. */
  private endCleaning(day: number): void {
    for (const pen of this.pens) {
      if (pen.status !== "CLEANING") continue;
      if (pen.cleaningUntilDay !== null && day < pen.cleaningUntilDay) continue;
      pen.status = "AVAILABLE";
      pen.cleaningUntilDay = null;
      pen.compatibility = null;
      pen.cohortId = null;
      pen.closesDay = null;
    }
  }

  /**
   * What every animal on the farm needs this morning.
   *
   * The house each one belongs in is read off the needs planner's own demand
   * builder rather than worked out again here. Two answers to "where does this
   * sow belong today" is one answer too many: the planner that sized the farm
   * and the allocator that fills it have to agree, and the only way to be sure
   * of that is for there to be one of them.
   */
  private requirementsOf(
    day: number,
    animals: readonly HousingAnimalSnapshot[],
  ): Map<string, Requirement> {
    const demand = housingDemandOf(day, animals, this.policy, this.weights);
    const snapshots = new Map<string, HousingAnimalSnapshot>();
    const idByTag = new Map<string, string>();
    for (const animal of animals) {
      snapshots.set(animal.id, animal);
      if (animal.tag) idByTag.set(animal.tag, animal.id);
    }

    const requirements = new Map<string, Requirement>();
    for (const occupant of demand.occupants) {
      const animal = snapshots.get(occupant.animalId);
      if (!animal) continue;
      requirements.set(occupant.animalId, {
        animalId: occupant.animalId,
        housingType: occupant.housingType,
        stage: stageOf(animal),
        cohortId: occupant.cohortId,
        governingWeightKg: occupant.governingWeightKg,
        compatibility: occupant.compatibility,
        reserved: occupant.reserved,
        reservedUntilDay: occupant.reserved ? animal.expectedFarrowDay : undefined,
        individual: animal.kind === "sow" || animal.kind === "boar",
        suckling: false,
      });
    }

    // Sucklers take no place of their own: they are where their dam is, which
    // is the one housing rule in the model that is about two animals at once.
    for (const animal of animals) {
      if (animal.kind !== "pig" || animal.stage !== "piglet") continue;
      const damId = animal.damTag ? idByTag.get(animal.damTag) : undefined;
      requirements.set(animal.id, {
        animalId: animal.id,
        housingType: "farrowing",
        stage: "piglet",
        cohortId: animal.cohortId ?? "",
        governingWeightKg: animal.weightKg,
        compatibility: "farrowing|suckling",
        reserved: false,
        individual: false,
        suckling: true,
        damId,
      });
    }
    return requirements;
  }

  /** Everything that left the farm overnight comes off the board. */
  private releaseDeparted(
    requirements: ReadonlyMap<string, Requirement>,
    departures: readonly HerdDeparture[],
    moves: Move[],
  ): void {
    const reasons = new Map<string, MovementReason>();
    for (const departure of departures) reasons.set(departure.id, exitReasonOf(departure.reason));

    for (const [animalId, pen] of [...this.placement]) {
      if (requirements.has(animalId)) continue;
      const resident = pen.members.get(animalId);
      this.removeFrom(pen, animalId);
      moves.push({
        animalId,
        cohortId: resident?.cohortId ?? "",
        individual: resident?.individual ?? false,
        from: pen.location,
        reason: reasons.get(animalId) ?? "MANUAL",
        housingType: pen.pen.housingType,
      });
    }
    // An animal that had nowhere to stand can leave the farm too, and it is no
    // longer a conflict once it has.
    for (const animalId of [...this.unhoused.keys()]) {
      if (!requirements.has(animalId)) this.unhoused.delete(animalId);
    }
  }

  /**
   * Everybody already correctly housed stays exactly where they are.
   *
   * The commonest thing that happens to a pig on any given day is nothing, and
   * that is what this is for. An animal is taken out of its pen only when the
   * pen is no longer the right place for it: it has gone up a stage, it is due
   * to farrow, it has been weaned, or its dam has moved and it is still on her.
   */
  private releaseMoved(requirements: ReadonlyMap<string, Requirement>): Requirement[] {
    for (const [animalId, pen] of [...this.placement]) {
      const requirement = requirements.get(animalId);
      if (!requirement) continue;
      if (this.stillRight(pen, requirement)) continue;
      // Where it came from is carried on the requirement rather than written
      // out now, so that one animal walking from one pen to another is one
      // movement in the log instead of a departure and an arrival.
      requirement.from = pen.location;
      requirement.fromType = pen.pen.housingType;
      const resident = pen.members.get(animalId);
      if (resident) {
        requirement.fromIdentity = {
          individual: resident.individual,
          cohortId: resident.cohortId,
        };
      }
      this.removeFrom(pen, animalId);
    }

    const waiting: Requirement[] = [];
    for (const requirement of requirements.values()) {
      if (!this.placement.has(requirement.animalId)) waiting.push(requirement);
    }
    return waiting;
  }

  /** Whether the pen an animal is standing in is still the right pen for it. */
  private stillRight(pen: PenRuntime, requirement: Requirement): boolean {
    if (pen.status === "OUT_OF_SERVICE") return false;
    if (requirement.suckling) {
      // A litter is where its dam is, and moves when she does. An orphan — a
      // litter whose dam died or was culled off it — stays in the pen it is
      // standing in, because that is what happens to it: it is reared where it
      // lies or fostered on, and it is certainly not carried out of the
      // farrowing house on the morning she goes.
      const dam = requirement.damId ? this.placement.get(requirement.damId) : undefined;
      if (dam !== undefined) return dam.pen.id === pen.pen.id;
      return pen.pen.housingType === "farrowing";
    }
    if (pen.pen.housingType !== requirement.housingType) return false;
    // A pen is poured for the weight the stage leaves at, and a batch that has
    // grown a kilogram past it does not get moved: the floor-area rule binds on
    // the way in, which is the only moment it can be obeyed by choosing a
    // different pen. Rechecking it every morning would empty a settled pen over
    // a rounding, which is exactly the shuffling this allocator exists not to do.
    return penAccepts(pen.pen.housingType, requirement.stage);
  }

  /**
   * Somewhere for everybody who has moved.
   *
   * Grouped before it is placed, so a cohort coming up out of the weaner house
   * arrives as a group rather than as thirty pigs handled in whatever order the
   * herd array happened to hold them. The order is fixed — group key, then
   * animal id — so the same run always fills the same pens.
   */
  private place(day: number, waiting: readonly Requirement[], moves: Move[]): void {
    if (waiting.length === 0) return;

    // Dams before their litters, so a piglet always has somewhere to follow to.
    const sucklers = waiting.filter((requirement) => requirement.suckling);
    const rest = waiting.filter((requirement) => !requirement.suckling);

    const groups = new Map<string, Requirement[]>();
    for (const requirement of rest) {
      const key = requirement.compatibility + " " + requirement.cohortId;
      const group = groups.get(key);
      if (group) group.push(requirement);
      else groups.set(key, [requirement]);
    }

    for (const key of [...groups.keys()].sort()) {
      const group = groups.get(key) as Requirement[];
      group.sort((a, b) => (a.animalId < b.animalId ? -1 : a.animalId > b.animalId ? 1 : 0));
      for (const requirement of group) {
        const pen = this.findPen(day, requirement);
        if (pen === null) {
          this.noteConflict(day, requirement, moves);
          continue;
        }
        this.admit(day, pen, requirement, moves);
      }
    }

    sucklers.sort((a, b) => (a.animalId < b.animalId ? -1 : a.animalId > b.animalId ? 1 : 0));
    for (const requirement of sucklers) {
      const dam = requirement.damId ? this.placement.get(requirement.damId) : undefined;
      if (dam === undefined) {
        // An orphan, or a litter whose dam has nowhere to stand. It is not put
        // in a pen of its own: a suckler that is not on a sow is not a housing
        // arrangement, it is a conflict.
        this.noteConflict(day, requirement, moves);
        continue;
      }
      this.admit(day, dam, requirement, moves);
    }
  }

  /**
   * The pen this animal goes in.
   *
   * The order of preference is the order a stockperson would walk it. A pen
   * already holding this animal's own group comes first, because a group that
   * has settled is worth keeping together. Then a part-filled compatible pen,
   * fullest first, so what is standing open is finished before anything else is
   * opened. Then an empty pen in a room that is already in use, because filling
   * the room you are in beats opening one you would then have to run, heat and
   * walk. Only then is a room opened, and the first one in the plan is taken so
   * that the same farm always fills the same way.
   */
  private findPen(day: number, requirement: Requirement): PenRuntime | null {
    let best: PenRuntime | null = null;
    let bestKey: number[] | null = null;
    const activeRooms = this.activeRooms(requirement.housingType);

    for (const pen of this.byType.get(requirement.housingType) ?? []) {
      if (!this.canTake(day, pen, requirement)) continue;
      const free = this.limitOf(pen, requirement.governingWeightKg) - pen.members.size;
      const key = [
        pen.cohortId === requirement.cohortId && pen.members.size > 0 ? 0 : 1,
        pen.members.size > 0 ? 0 : 1,
        activeRooms.has(pen.location.roomId) ? 0 : 1,
        free,
        pen.order,
      ];
      if (bestKey === null || less(key, bestKey)) {
        best = pen;
        bestKey = key;
      }
    }
    return best;
  }

  /** Rooms of this house with animals already in them. */
  private activeRooms(housingType: HousingType): Set<string> {
    const rooms = new Set<string>();
    for (const pen of this.byType.get(housingType) ?? []) {
      if (pen.members.size > 0) rooms.add(pen.location.roomId);
    }
    return rooms;
  }

  /** Whether one pen could take this animal today, rule by rule. */
  private canTake(day: number, pen: PenRuntime, requirement: Requirement): boolean {
    if (pen.status === "NOT_COMMISSIONED") return false;
    if (pen.status === "CLEANING" || pen.status === "OUT_OF_SERVICE") return false;
    // A place held for a sow that is not using it yet is not a place going
    // spare: the whole reason a farrowing pen is booked a week early is that
    // nobody else may have it in the meantime.
    if (pen.status === "RESERVED") return false;
    if (pen.pen.housingType !== requirement.housingType) return false;
    if (!penAccepts(pen.pen.housingType, requirement.stage)) return false;
    if (pen.members.size > 0) {
      if (pen.compatibility !== requirement.compatibility) return false;
      // The gate on this batch is shut. A farm fills a pen over a few days and
      // then leaves it alone; a pen that never closes never empties to be washed.
      if (pen.closesDay !== null && day > pen.closesDay) return false;
    }
    return this.limitOf(pen, requirement.governingWeightKg) - pen.members.size > 0;
  }

  /** How many head this pen holds at a given occupant weight. */
  private limitOf(pen: PenRuntime, governingWeightKg: number): number {
    const perHead = areaPerHeadOf(this.policy, pen.pen.housingType, governingWeightKg).m2PerHead;
    const byArea =
      perHead > 0
        ? Math.floor(pen.pen.floorAreaM2 / perHead + HEAD_EPSILON)
        : Number.MAX_SAFE_INTEGER;
    return Math.max(1, Math.min(pen.pen.maxHead, byArea));
  }

  private admit(day: number, pen: PenRuntime, requirement: Requirement, moves: Move[]): void {
    pen.members.set(requirement.animalId, {
      animalId: requirement.animalId,
      cohortId: requirement.cohortId,
      individual: requirement.individual,
      suckling: requirement.suckling,
    });
    if (requirement.suckling) pen.sucklingHead += 1;
    else pen.occupiedHead += 1;
    this.placement.set(requirement.animalId, pen);
    this.unhoused.delete(requirement.animalId);
    pen.movementsIn += 1;

    if (!requirement.suckling && pen.members.size - pen.sucklingHead === 1) {
      // The first place-taker opens the batch: it sets what the pen holds and
      // how long it goes on taking arrivals.
      pen.compatibility = requirement.compatibility;
      pen.cohortId = requirement.cohortId;
      pen.openedDay = day;
      pen.closesDay = this.fillWindowOf(pen.pen.housingType, day);
    }
    if (pen.status === "AVAILABLE") pen.status = requirement.reserved ? "RESERVED" : "OCCUPIED";

    const reason =
      requirement.fromType === undefined
        ? "INITIAL_PLACEMENT"
        : reasonFor(requirement.fromType, requirement);

    if (requirement.from !== undefined && changedIdentity(requirement)) {
      // The thing that left is not the thing that arrived. A litter comes off
      // the sow and becomes a weaner batch; a gilt is promoted and becomes a
      // sow with a name of her own. Written as two lines on the same day, which
      // is what actually happened: one group ended and another began.
      const identity = requirement.fromIdentity as { individual: boolean; cohortId: string };
      moves.push({
        animalId: requirement.animalId,
        cohortId: identity.cohortId,
        individual: identity.individual,
        from: requirement.from,
        reason,
        housingType: requirement.fromType as HousingType,
      });
      moves.push({
        animalId: requirement.animalId,
        cohortId: requirement.cohortId,
        individual: requirement.individual,
        to: pen.location,
        reason,
        housingType: requirement.housingType,
      });
      return;
    }

    moves.push({
      animalId: requirement.animalId,
      cohortId: requirement.cohortId,
      individual: requirement.individual,
      from: requirement.from,
      to: pen.location,
      reason,
      housingType: requirement.housingType,
    });
  }

  /** The day a pen of this type stops taking arrivals, or null if it never does. */
  private fillWindowOf(type: HousingType, day: number): number | null {
    if (cleaningDaysOf(this.policy, type) <= 0) return null;
    return day + this.policy.structure.penFillWindowDays;
  }

  private removeFrom(pen: PenRuntime, animalId: string): void {
    const resident = pen.members.get(animalId);
    if (!resident) return;
    pen.members.delete(animalId);
    if (resident.suckling) pen.sucklingHead = Math.max(0, pen.sucklingHead - 1);
    else pen.occupiedHead = Math.max(0, pen.occupiedHead - 1);
    this.placement.delete(animalId);
  }

  /** A batch has gone; the pen is out of use until it has been washed down. */
  private washEmptied(day: number): void {
    for (const pen of this.pens) {
      if (pen.status !== "OCCUPIED" && pen.status !== "RESERVED") continue;
      if (pen.members.size > 0) continue;
      const days = cleaningDaysOf(this.policy, pen.pen.housingType);
      pen.compatibility = null;
      pen.cohortId = null;
      pen.closesDay = null;
      if (days <= 0) {
        pen.status = "AVAILABLE";
        pen.cleaningUntilDay = null;
        continue;
      }
      pen.status = "CLEANING";
      pen.cleaningUntilDay = day + days;
    }
  }

  /**
   * Which pens are being held rather than used.
   *
   * Settled every morning rather than when an animal walks in, because what
   * changes it is the animal changing: the sow moved into the farrowing house a
   * week early holds a reserved place until the morning she farrows, and nobody
   * moves her to mark the difference.
   */
  private settleStatus(requirements: ReadonlyMap<string, Requirement>): void {
    for (const pen of this.pens) {
      if (pen.status !== "OCCUPIED" && pen.status !== "RESERVED") continue;
      if (pen.members.size === 0) continue;
      let held = true;
      let until: number | null = null;
      for (const animalId of pen.members.keys()) {
        const requirement = requirements.get(animalId);
        if (requirement?.reserved !== true) {
          held = false;
          break;
        }
        // The day the place stops being held and starts being used, which for a
        // farrowing pen is the day the sow in it is due.
        if (requirement.reservedUntilDay !== undefined) {
          until = until === null ? requirement.reservedUntilDay : Math.min(until, requirement.reservedUntilDay);
        }
      }
      pen.status = held ? "RESERVED" : "OCCUPIED";
      pen.reservedUntilDay = held ? until : null;
    }
  }

  // ------------------------------------------------------------- the record

  private noteConflict(day: number, requirement: Requirement, moves: Move[]): void {
    this.unhoused.set(requirement.animalId, requirement.housingType);
    // An animal that had a pen and has been taken out of it leaves the log with
    // a movement out and no destination. Leaving it standing in a pen of the
    // wrong kind would be the one thing this model must never report: a pig in
    // housing it cannot be in.
    if (requirement.from !== undefined && requirement.fromType !== undefined) {
      moves.push({
        animalId: requirement.animalId,
        cohortId: requirement.fromIdentity?.cohortId ?? requirement.cohortId,
        individual: requirement.fromIdentity?.individual ?? requirement.individual,
        from: requirement.from,
        reason: reasonFor(requirement.fromType, requirement),
        housingType: requirement.housingType,
      });
    }

    const { reason, availableHeadCapacity } = this.diagnose(day, requirement);
    const key = day + "|" + requirement.housingType + "|" + reason;
    const existing = this.conflictsToday.get(key);
    // One line a house a morning. A finishing house short of a pen turns away
    // every pig in the batch, and forty identical lines would say no more than
    // one line saying forty does.
    if (existing !== undefined) {
      existing.requiredHead += 1;
      existing.availableHeadCapacity = Math.min(
        existing.availableHeadCapacity,
        availableHeadCapacity,
      );
      return;
    }
    const conflict: HousingConflict = {
      day,
      housingType: requirement.housingType,
      requiredHead: 1,
      availableHeadCapacity,
      occupantId: requirement.animalId,
      reason,
    };
    this.conflictsToday.set(key, conflict);
    this.conflicts.push(conflict);
  }

  /** Why there was nowhere to put this animal, and what was standing spare. */
  private diagnose(
    day: number,
    requirement: Requirement,
  ): { reason: HousingConflict["reason"]; availableHeadCapacity: number } {
    if (requirement.suckling) {
      return { reason: "NO_COMMISSIONED_PEN", availableHeadCapacity: 0 };
    }
    const pens = this.byType.get(requirement.housingType) ?? [];
    let commissioned = 0;
    let cleaning = 0;
    let reserved = 0;
    let free = 0;
    let blockedByGroup = 0;
    for (const pen of pens) {
      if (pen.status === "NOT_COMMISSIONED" || pen.status === "OUT_OF_SERVICE") continue;
      commissioned += 1;
      if (pen.status === "CLEANING") {
        cleaning += 1;
        continue;
      }
      if (pen.status === "RESERVED") {
        reserved += 1;
        continue;
      }
      const room = this.limitOf(pen, requirement.governingWeightKg) - pen.members.size;
      if (room > 0) {
        free += room;
        // Space that exists and cannot be had: the batch standing in the pen is
        // not one this animal may join, or the pen does not take its kind at
        // all. Either way it is a place the house has and this animal has not,
        // which is a different complaint from a house that is simply full.
        if (!this.canTake(day, pen, requirement)) blockedByGroup += room;
      }
    }
    if (commissioned === 0) return { reason: "NO_COMMISSIONED_PEN", availableHeadCapacity: 0 };
    if (cleaning === commissioned) {
      return { reason: "ALL_COMPATIBLE_PENS_CLEANING", availableHeadCapacity: 0 };
    }
    if (reserved + cleaning === commissioned) {
      return { reason: "ALL_COMPATIBLE_PENS_RESERVED", availableHeadCapacity: 0 };
    }
    if (free > 0 && blockedByGroup === free) {
      return { reason: "GROUP_CANNOT_FIT", availableHeadCapacity: free };
    }
    return { reason: "ALL_COMPATIBLE_PENS_FULL", availableHeadCapacity: free };
  }

  /**
   * The day's moves, written as events.
   *
   * A named animal gets a line of its own. A group gets one line for each place
   * it came from and went to, with the head that made that move — thirty lines
   * saying the same thing about thirty weaners would not be a more precise
   * record of one batch walking down a passage.
   */
  private recordMoves(moves: readonly Move[]): void {
    if (!this.keepHistory || moves.length === 0) return;
    const grouped = new Map<string, HousingMovementEvent>();
    const events: HousingMovementEvent[] = [];

    for (const move of moves) {
      if (move.individual) {
        events.push({
          day: this.lastDay,
          occupant: { type: "animal", animalId: move.animalId },
          from: move.from,
          to: move.to,
          reason: move.reason,
          housingType: move.housingType,
        });
        continue;
      }
      const key = [
        move.cohortId,
        move.from?.penId ?? "",
        move.to?.penId ?? "",
        move.reason,
        move.housingType,
      ].join("|");
      const existing = grouped.get(key);
      if (existing && existing.occupant.type === "cohort") {
        existing.occupant.head += 1;
        continue;
      }
      const event: HousingMovementEvent = {
        day: this.lastDay,
        occupant: { type: "cohort", cohortId: move.cohortId, head: 1 },
        from: move.from,
        to: move.to,
        reason: move.reason,
        housingType: move.housingType,
      };
      grouped.set(key, event);
      events.push(event);
    }

    // A fixed order, so two runs of the same plan write the same log.
    events.sort((a, b) => movementKey(a).localeCompare(movementKey(b)));
    this.history.movements.push(...events);
  }

  private recordStatus(day: number, before: readonly PenStatus[]): void {
    if (!this.keepHistory) return;
    for (let index = 0; index < this.pens.length; index += 1) {
      const pen = this.pens[index];
      if (pen.status === before[index]) continue;
      const event: PenStatusEvent = { day, penId: pen.pen.id, status: pen.status };
      if (pen.status === "CLEANING" && pen.cleaningUntilDay !== null) {
        event.untilDay = pen.cleaningUntilDay;
      }
      if (pen.status === "RESERVED" && pen.reservedUntilDay !== null) {
        event.untilDay = pen.reservedUntilDay;
      }
      this.history.statusChanges.push(event);
    }
  }

  /** What the day cost in pens, for the utilization read-out. */
  private recordDay(day: number): void {
    for (const pen of this.pens) {
      if (pen.status === "NOT_COMMISSIONED") continue;
      pen.daysCommissioned += 1;
      if (pen.status === "OCCUPIED") pen.daysOccupied += 1;
      else if (pen.status === "RESERVED") pen.daysReserved += 1;
      else if (pen.status === "CLEANING") pen.daysCleaning += 1;
      else pen.daysAvailable += 1;
      pen.headDays += pen.occupiedHead;
      if (pen.occupiedHead > pen.peakHead) {
        pen.peakHead = pen.occupiedHead;
        pen.peakDay = day;
      }
    }
    const unhoused = this.unhoused.size;
    if (unhoused > this.peakUnhousedHead) {
      this.peakUnhousedHead = unhoused;
      this.peakUnhousedDay = day;
    }
  }

  // ------------------------------------------------------------- read-outs

  private penStateOf(pen: PenRuntime): PenHousingState {
    return {
      penId: pen.pen.id,
      roomId: pen.location.roomId,
      buildingId: pen.location.buildingId,
      name: pen.pen.name,
      housingType: pen.pen.housingType,
      status: pen.status,
      occupants: occupantsOf(pen),
      occupiedHead: pen.occupiedHead,
      sucklingHead: pen.sucklingHead,
      maxHead: pen.pen.maxHead,
      cleaningUntilDay: pen.cleaningUntilDay ?? undefined,
      reservedUntilDay: pen.reservedUntilDay ?? undefined,
    };
  }

  private locationsNow(): Record<string, PhysicalLocation> {
    const locations: Record<string, PhysicalLocation> = {};
    for (const [animalId, pen] of this.placement) locations[animalId] = pen.location;
    return locations;
  }

  private penUtilization(): PenUtilizationSummary[] {
    return this.pens.map((pen) => ({
      penId: pen.pen.id,
      roomId: pen.location.roomId,
      buildingId: pen.location.buildingId,
      housingType: pen.pen.housingType,
      name: pen.pen.name,
      maxHead: pen.pen.maxHead,
      commissionedDay: pen.pen.commissionedDay,
      daysCommissioned: pen.daysCommissioned,
      daysOccupied: pen.daysOccupied,
      daysReserved: pen.daysReserved,
      daysCleaning: pen.daysCleaning,
      daysAvailable: pen.daysAvailable,
      headDays: pen.headDays,
      averageHead: round2(pen.headDays / Math.max(1, pen.daysCommissioned)),
      peakHead: pen.peakHead,
      peakDay: pen.peakDay,
      occupancyPct: round2(
        (pen.headDays / Math.max(1, pen.daysCommissioned * Math.max(1, pen.pen.maxHead))) * 100,
      ),
      movementsIn: pen.movementsIn,
    }));
  }

  private roomUtilization(): RoomUtilizationSummary[] {
    const rooms: RoomUtilizationSummary[] = [];
    for (const building of this.plan.buildings) {
      for (const room of building.rooms) {
        let capacity = 0;
        let headDays = 0;
        let days = 0;
        let peakHead = 0;
        let peakDay = 0;
        for (const pen of room.pens) {
          const runtime = this.penById.get(pen.id);
          if (!runtime) continue;
          capacity += pen.maxHead;
          headDays += runtime.headDays;
          days = Math.max(days, runtime.daysCommissioned);
          if (runtime.peakHead > peakHead) {
            peakHead = runtime.peakHead;
            peakDay = runtime.peakDay;
          }
        }
        rooms.push({
          roomId: room.id,
          buildingId: building.id,
          name: room.name,
          housingType: room.housingType,
          pens: room.pens.length,
          capacityHead: capacity,
          commissionedDay: room.commissionedDay,
          daysCommissioned: days,
          headDays,
          averageHead: round2(headDays / Math.max(1, days)),
          peakHead,
          peakDay,
          occupancyPct: round2((headDays / Math.max(1, days * Math.max(1, capacity))) * 100),
        });
      }
    }
    return rooms;
  }
}

// --------------------------------------------------------------------- bits

/** Who is in a pen, as the state records it: named animals, then groups. */
function occupantsOf(pen: PenRuntime): PenOccupant[] {
  const occupants: PenOccupant[] = [];
  const cohorts = new Map<string, number>();
  for (const resident of pen.members.values()) {
    if (resident.individual) occupants.push({ type: "animal", animalId: resident.animalId });
    else cohorts.set(resident.cohortId, (cohorts.get(resident.cohortId) ?? 0) + 1);
  }
  occupants.sort((a, b) =>
    a.type === "animal" && b.type === "animal" ? a.animalId.localeCompare(b.animalId) : 0,
  );
  for (const cohortId of [...cohorts.keys()].sort()) {
    occupants.push({ type: "cohort", cohortId, head: cohorts.get(cohortId) as number });
  }
  return occupants;
}

/** Which of the housed stages an animal is in this morning. */
function stageOf(animal: HousingAnimalSnapshot): HousedStage {
  if (animal.kind === "boar") return "boar";
  if (animal.kind === "gilt") return "gilt";
  if (animal.kind === "sow") {
    if (animal.reproductiveState === "lactating") return "lactating-sow";
    if (animal.reproductiveState === "gestating") return "gestating-sow";
    return "open-sow";
  }
  switch (animal.stage) {
    case "weaner":
      return "weaner";
    case "grower":
      return "grower";
    case "finisher":
      return "finisher";
    default:
      return "piglet";
  }
}

/**
 * Why an animal is moving, read off the two houses rather than off the biology.
 *
 * The move is the consequence of something the farm already did — a sow was
 * served, a litter was weaned, a batch went up a stage — and naming it from the
 * houses it is between is how the housing model stays out of the way of the
 * biological one. Nothing here can change a date; it can only say what the date
 * meant for where the animal stands.
 */
function reasonFor(from: HousingType, requirement: Requirement): MovementReason {
  const to = requirement.housingType;
  if (from === to) return "MANUAL";
  if (to === "farrowing") return "PRE_FARROW";
  if (from === "farrowing") return "WEANING";
  if (to === "gestation") return "GESTATION";
  if (to === "service_sow") return "SERVICE";
  return "STAGE_TRANSITION";
}

function exitReasonOf(reason: HerdDeparture["reason"]): MovementReason {
  switch (reason) {
    case "sold":
    case "sold-as-gilt":
      return "SALE";
    case "culled":
      return "CULL";
    case "died":
      return "MORTALITY";
    default:
      return "MANUAL";
  }
}

/** A stable sort key for a movement, so two identical runs write one log. */
function movementKey(event: HousingMovementEvent): string {
  const who =
    event.occupant.type === "animal" ? "a:" + event.occupant.animalId : "c:" + event.occupant.cohortId;
  return [who, event.from?.penId ?? "", event.to?.penId ?? "", event.reason].join("|");
}

/**
 * Whether the occupant that left a pen is recorded as a different thing from
 * the one that is arriving: a litter that has become a batch, or one of a group
 * that has become an animal with a name.
 */
function changedIdentity(requirement: Requirement): boolean {
  const identity = requirement.fromIdentity;
  if (identity === undefined) return false;
  return (
    identity.individual !== requirement.individual || identity.cohortId !== requirement.cohortId
  );
}

/** Lexicographic comparison of two ranking keys. */
function less(a: readonly number[], b: readonly number[]): boolean {
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return a[index] < b[index];
  }
  return false;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Houses a whole run of days through a fresh allocator. The streaming entry
 * point is the class above; this is for tests and for anything that already
 * holds the days it wants to house.
 */
export function allocatePhysicalHousing(
  plan: PhysicalFarmPlan,
  days: readonly { day: number; animals: readonly HousingAnimalSnapshot[]; departures?: readonly HerdDeparture[] }[],
  policy: HousingPolicy,
  weights: StageExitWeights,
): HousingSimulationResult {
  const allocator = new PhysicalHousingAllocator(plan, policy, weights);
  for (const entry of days) allocator.step(entry.day, entry.animals, entry.departures ?? []);
  return allocator.finish();
}
