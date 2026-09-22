import type { HousingPolicy, HousingType } from "./rules";

/**
 * What the daily requirement series is worth once you have it.
 *
 * The allocator produces one number a day for each kind of housing: how many
 * pens had to exist that morning. Everything here is a question asked of that
 * series that a peak cannot answer.
 *
 * A peak says thirty-four finishing pens. It does not say that thirty-four were
 * wanted on three mornings in five years and thirty on all the rest, that the
 * thirty-fourth was not needed until the spring of 2030, or what would actually
 * have gone wrong if only twenty-eight had been built. Those are the three
 * questions a farmer asks when the quotation comes back, and they are all here.
 *
 * Nothing in this file decides anything. It measures.
 */

/**
 * How hard a house is worked, against the capacity actually proposed for it.
 *
 * The average is taken from the day the house was first wanted, not from the
 * first day of the plan. A finishing house on a farm that starts with sows
 * stands empty for the better part of a year while the first pigs grow into it,
 * and counting those mornings would say more about the stocking policy than
 * about the building.
 */
export type HousingUtilizationMetrics = {
  averageOccupiedPct: number;
  peakOccupiedPct: number;
  daysAbove80Pct: number;
  daysAbove90Pct: number;
  daysAt100Pct: number;
  /** Days the requirement sat at its own peak: how brief the worst case was. */
  peakDurationDays: number;
};

/** What building less than the minimum would have cost, in pigs with nowhere to go. */
export type HousingCapacityFailure = {
  firstShortageDay?: number;
  shortageDays: number;
  maximumShortagePens: number;
};

/** One step of building work, and the day it has to be finished by. */
export type HousingConstructionPhase = {
  phase: number;
  buildByDay: number;
  buildByDate?: string;
  housingType: HousingType;
  pensAdded: number;
  roomsAdded: number;
  buildingsAdded?: number;
  /** Pens standing once this phase is done. */
  resultingCapacity: number;
};

/** The daily requirement, with the day its first entry belongs to. */
export type DemandSeries = {
  firstDay: number;
  pensInUse: readonly number[];
};

/**
 * The first day this many pens were needed at once, or null if never.
 *
 * The whole basis of phasing. A house sized on a morning in 2030 does not have
 * to exist in 2026, and the difference between those two dates is money that
 * stays in the bank for four years.
 */
export function firstRequiredDay(series: DemandSeries, pens: number): number | null {
  if (pens <= 0) return series.pensInUse.length > 0 ? series.firstDay : null;
  for (let index = 0; index < series.pensInUse.length; index += 1) {
    if (series.pensInUse[index] >= pens) return series.firstDay + index;
  }
  return null;
}

/**
 * The reserve this run justifies, which is very often none.
 *
 * A reserve is for the surges a house has to absorb: the next batch coming in
 * bigger than the last, a week's farrowings falling together, a cohort that
 * grows slowly and holds its pens while the next one arrives. So that is what is
 * measured — the rise in requirement inside one intake window — with two things
 * ruled out that a naive reading of the same series would wrongly count.
 *
 * The first is growth. A house that climbed from one pen to two and stayed there
 * did not absorb a surge, it grew, and the growth is already in the peak. Only a
 * rise the requirement later came back down from counts.
 *
 * The second is the one-off. Fifty sows are stocked on the same morning and want
 * a service place each; that fortnight is in the minimum already and is no guide
 * at all to the margin the house needs for the other five years. Taking a high
 * percentile of the daily surges rather than the worst of them keeps the surges
 * that recur and drops the ones that happened once.
 *
 * What is left is capped, and a house whose requirement never moves gets
 * nothing — which is the whole difference between this and a percentage.
 */
export function derivedReservePens(
  series: DemandSeries,
  minimumPens: number,
  policy: HousingPolicy,
): number {
  const demand = series.pensInUse;
  const count = demand.length;
  if (count === 0) return 0;
  const window = Math.max(1, Math.round(policy.structure.reserveWindowDays));

  // The lowest the requirement ever gets from each day onwards, so that "did it
  // come back down?" is one lookup rather than a scan.
  const suffixMin = new Array<number>(count);
  let lowest = Number.POSITIVE_INFINITY;
  for (let index = count - 1; index >= 0; index -= 1) {
    lowest = Math.min(lowest, demand[index]);
    suffixMin[index] = lowest;
  }

  const surges: number[] = [];
  for (let index = 0; index < count; index += 1) {
    let base = demand[index];
    for (let back = Math.max(0, index - window); back < index; back += 1) {
      base = Math.min(base, demand[back]);
    }
    const rise = demand[index] - base;
    const cameBackDown = index + 1 < count && suffixMin[index + 1] <= base;
    surges.push(rise > 0 && cameBackDown ? rise : 0);
  }

  surges.sort((a, b) => a - b);
  const at = Math.min(
    surges.length - 1,
    Math.floor(surges.length * Math.min(1, Math.max(0, policy.structure.reservePercentile))),
  );
  const cap = Math.ceil(minimumPens * Math.max(0, policy.structure.reserveMaxPct));
  return Math.max(0, Math.min(surges[at], cap));
}

/** The reserve under whichever mode the policy is set to. */
export function reservePensFor(
  series: DemandSeries,
  minimumPens: number,
  policy: HousingPolicy,
): number {
  switch (policy.structure.reserveMode) {
    case "none":
      return 0;
    case "percentage":
      return Math.max(0, Math.ceil(minimumPens * policy.structure.reservePct));
    case "simulation-derived":
      return derivedReservePens(series, minimumPens, policy);
  }
}

/** In one sentence, why the reserve is the size it is. */
export function reserveExplanation(
  series: DemandSeries,
  minimumPens: number,
  policy: HousingPolicy,
  unit: string,
): string {
  const pens = reservePensFor(series, minimumPens, policy);
  switch (policy.structure.reserveMode) {
    case "none":
      return `No operational reserve: the plan builds what the simulation required and nothing more.`;
    case "percentage":
      return `${Math.round(policy.structure.reservePct * 100)}% operational reserve: ${minimumPens} × ${policy.structure.reservePct} → ${pens} ${unit}.`;
    case "simulation-derived":
      return pens > 0
        ? `Reserve of ${pens} ${unit}, derived from the run: on its busiest weeks this house absorbed a rise of ${pens} ${unit} inside ${policy.structure.reserveWindowDays} days and gave it back again.`
        : `No reserve: the requirement never surged and came back inside a ${policy.structure.reserveWindowDays}-day window, so nothing in the simulation justifies one. Any rise it did show it grew into, and that is already in the minimum.`;
  }
}

/** How hard the proposed capacity gets worked over the run. */
export function utilizationOf(
  series: DemandSeries,
  capacityPens: number,
): HousingUtilizationMetrics {
  const demand = series.pensInUse;
  const empty: HousingUtilizationMetrics = {
    averageOccupiedPct: 0,
    peakOccupiedPct: 0,
    daysAbove80Pct: 0,
    daysAbove90Pct: 0,
    daysAt100Pct: 0,
    peakDurationDays: 0,
  };
  if (demand.length === 0 || capacityPens <= 0) return empty;

  const opened = demand.findIndex((pens) => pens > 0);
  if (opened < 0) return empty;
  let total = 0;
  let peak = 0;
  for (let index = opened; index < demand.length; index += 1) {
    total += demand[index];
    peak = Math.max(peak, demand[index]);
  }
  const inUseDays = demand.length - opened;
  let above80 = 0;
  let above90 = 0;
  let at100 = 0;
  let atPeak = 0;
  for (const pens of demand) {
    if (pens > capacityPens * 0.8 + 1e-9) above80 += 1;
    if (pens > capacityPens * 0.9 + 1e-9) above90 += 1;
    if (pens >= capacityPens) at100 += 1;
    if (pens === peak) atPeak += 1;
  }
  return {
    averageOccupiedPct: round2((total / inUseDays / capacityPens) * 100),
    peakOccupiedPct: round2((peak / capacityPens) * 100),
    daysAbove80Pct: above80,
    daysAbove90Pct: above90,
    daysAt100Pct: at100,
    peakDurationDays: atPeak,
  };
}

/**
 * What building only this many pens would have cost.
 *
 * Analysis and nothing else. It does not re-house anybody, move a sale or change
 * a growth curve — it reports the days the herd wanted more pens than this and
 * by how many, which is the honest answer to "what happens if I build 28?" and
 * is a long way short of simulating the farm that actually did build 28.
 */
export function analyzeHousingCapacity(
  series: DemandSeries,
  pens: number,
): HousingCapacityFailure {
  let first: number | undefined;
  let days = 0;
  let worst = 0;
  for (let index = 0; index < series.pensInUse.length; index += 1) {
    const short = series.pensInUse[index] - pens;
    if (short <= 0) continue;
    if (first === undefined) first = series.firstDay + index;
    days += 1;
    worst = Math.max(worst, short);
  }
  return { firstShortageDay: first, shortageDays: days, maximumShortagePens: worst };
}

export type PhasingRequest = {
  housingType: HousingType;
  series: DemandSeries;
  pensPerRoom: number;
  roomCount: number;
  policy: HousingPolicy;
  /** Turns a day index into a date for the plan, where one is wanted. */
  dateOf?: (day: number) => string;
};

/**
 * The building work, split into the order it actually has to happen in.
 *
 * Nobody builds five years of capacity on the morning they open. A room is
 * needed the first day the herd wants a pen the rooms already standing cannot
 * give it, and it has to be commissioned a lead time before that. Rooms wanted
 * on the same day are one phase, so this produces the two or three pieces of
 * work a builder would recognise rather than a line for every pen.
 *
 * Rooms the run never needs — the spare capacity that comes of rounding up to a
 * whole module, and of any reserve — are put in with the last phase that is
 * needed, because a module is built whole or not at all.
 */
export function constructionPhasesFor(request: PhasingRequest): HousingConstructionPhase[] {
  const { housingType, series, pensPerRoom, roomCount, policy, dateOf } = request;
  if (pensPerRoom <= 0 || roomCount <= 0) return [];
  const lead = Math.max(0, Math.round(policy.structure.constructionLeadDays));
  const perBuilding = Math.max(1, policy.structure.maxRoomsPerBuilding);

  // When each room has to be standing, one entry a room.
  const buildBy: number[] = [];
  for (let room = 1; room <= roomCount; room += 1) {
    const standing = (room - 1) * pensPerRoom;
    const needed = firstRequiredDay(series, standing + 1);
    if (needed === null) {
      // Never wanted: spare capacity. It goes up with the room before it.
      buildBy.push(buildBy[buildBy.length - 1] ?? series.firstDay);
      continue;
    }
    buildBy.push(Math.max(series.firstDay, needed - lead));
  }

  // Rooms falling due close together are one piece of work, dated at the first
  // of them so that the capacity is standing when it is first wanted. A
  // construction programme has two or three steps in it, not one a pen.
  const spacing = Math.max(0, Math.round(policy.structure.minPhaseSpacingDays));
  const phases: HousingConstructionPhase[] = [];
  let rooms = 0;
  let previousBuildings = 0;
  let phaseStart = buildBy[0];
  for (let index = 0; index < buildBy.length; index += 1) {
    rooms += 1;
    const next = buildBy[index + 1];
    if (next !== undefined && next - phaseStart <= spacing) continue;

    const buildings = Math.ceil(rooms / perBuilding);
    const roomsAdded = rooms - phases.reduce((total, phase) => total + phase.roomsAdded, 0);
    phases.push({
      phase: phases.length + 1,
      buildByDay: phaseStart,
      buildByDate: dateOf?.(phaseStart),
      housingType,
      pensAdded: roomsAdded * pensPerRoom,
      roomsAdded,
      buildingsAdded: buildings - previousBuildings,
      resultingCapacity: rooms * pensPerRoom,
    });
    previousBuildings = buildings;
    if (next !== undefined) phaseStart = next;
  }
  return phases;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
