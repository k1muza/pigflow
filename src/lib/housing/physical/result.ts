import type { HousingType } from "../rules";
import type {
  HousingConflict,
  HousingMovementEvent,
  PenStatusEvent,
  RoomCommissionedEvent,
} from "./history";
import type { PhysicalFarmPlan } from "./model";
import type { PhysicalFarmState } from "./state";

/**
 * What the run did with the housing, in the shape a page and a report read.
 *
 * It rides on the one simulation the rest of the product already pays for.
 * Nothing here is worked out by running the farm a second time: the allocator
 * watches the same run that produces the cashflow and the herd plan, one
 * morning at a time, and this is what it had to say afterwards.
 */

/** How hard one pen was worked, and when. */
export type PenUtilizationSummary = {
  penId: string;
  roomId: string;
  buildingId: string;
  housingType: HousingType;
  name: string;
  maxHead: number;
  commissionedDay: number;
  /** Days the pen existed inside the run. */
  daysCommissioned: number;
  daysOccupied: number;
  daysReserved: number;
  daysCleaning: number;
  daysAvailable: number;
  /** Animal-days, over the days it existed. Sucklers are not places. */
  headDays: number;
  averageHead: number;
  peakHead: number;
  peakDay: number;
  /** Average head as a share of the pen's own capacity, once it existed. */
  occupancyPct: number;
  /** Occupants moved in: how often the pen turned over. */
  movementsIn: number;
};

/** The same for a room, added up off its pens. */
export type RoomUtilizationSummary = {
  roomId: string;
  buildingId: string;
  name: string;
  housingType: HousingType;
  pens: number;
  capacityHead: number;
  commissionedDay: number;
  daysCommissioned: number;
  headDays: number;
  averageHead: number;
  peakHead: number;
  peakDay: number;
  occupancyPct: number;
};

/**
 * What the farm could not house, added up over the whole run.
 *
 * A conflict is written one house at a time on the morning it happens, which is
 * the right unit for reading a day and the wrong one for deciding whether there
 * is a problem. This is the same record asked the other question: over the
 * whole plan, on how many mornings was there an animal with nowhere to go, how
 * bad did it get, and in which house.
 */
export type HousingShortageSummary = {
  /** Mornings on which at least one animal had nowhere to stand. */
  days: number;
  /** The most head turned away on any one morning, and which morning. */
  peakHead: number;
  peakDay: number;
  /** The house that ran short on the most mornings, which is where to look. */
  worstHousingType: HousingType | null;
  byType: { housingType: HousingType; days: number; peakHead: number }[];
};

export type HousingSimulationTotals = {
  movements: number;
  conflicts: number;
  /** Days on which at least one animal had nowhere to go. */
  daysWithConflicts: number;
  /** The most head that stood unhoused on any one day, and when. */
  peakUnhousedHead: number;
  peakUnhousedDay: number;
  /** Head the farm was holding at the end, and the places it had for them. */
  finalHousedHead: number;
  designHeadCapacity: number;
};

/**
 * The housing half of a finished run.
 *
 * The events are the record and `finalState` is a convenience: every other day
 * of the plan is reconstructed from the events by `farmStateOnDay`, and this one
 * is kept whole only because the last day is the one a reader asks for first.
 */
export type HousingSimulationResult = {
  /** The layout the run was housed in, as it was saved into the plan. */
  plan: PhysicalFarmPlan;
  firstDay: number;
  lastDay: number;
  days: number;
  movements: HousingMovementEvent[];
  conflicts: HousingConflict[];
  statusChanges: PenStatusEvent[];
  commissionings: RoomCommissionedEvent[];
  finalState: PhysicalFarmState;
  penUtilization: PenUtilizationSummary[];
  roomUtilization: RoomUtilizationSummary[];
  totals: HousingSimulationTotals;
};
