import type { Boar, GrowingPig, Sow } from "../../sim/animals";
import type {
  ExpectedBoarGroup,
  ExpectedFarmState,
  ExpectedGrowingGroup,
  ExpectedSowGroup,
} from "./forecast";

/**
 * Reading the farm the way a stockman reads it: by walking round it and writing
 * down what is standing there this morning.
 *
 * This is the only place the planner touches live animals, and all it does with
 * them is copy the facts that are visible today into a record that cannot reach
 * back. Nothing downstream of here holds a `GrowingPig`, a `Sow` or a `World`,
 * so nothing downstream can read a scheduled death, a pending random draw or
 * anything else the farm has no way of knowing yet. The information boundary is
 * the type signature.
 *
 * Animals are grouped rather than copied one by one. Five thousand growing pigs
 * make a few hundred groups of the same stage, sex, age and size, and a forecast
 * over a group is the same arithmetic as a forecast over each of its members
 * added up — with the head count as a multiplier instead of a loop.
 */

/** Weight band a growing group is collected into, in kilograms. */
const PIG_WEIGHT_BAND_KG = 2;
/** Weight band a breeding group is collected into. Sows vary less and eat more. */
const SOW_WEIGHT_BAND_KG = 5;

function band(weightKg: number, size: number): number {
  return Math.round(weightKg / size);
}

/**
 * Collects rows into groups, keeping a head-weighted mean weight for each. The
 * band decides who is grouped with whom; the mean decides what the group weighs.
 * Banding without the mean would quietly round the whole herd's feed.
 */
function collect<T extends { head: number; weightKg: number }>(
  rows: readonly (T & { key: string })[],
): T[] {
  const groups = new Map<string, { row: T; weightSum: number }>();
  for (const { key, ...rest } of rows) {
    const row = rest as unknown as T;
    const already = groups.get(key);
    if (already) {
      already.row.head += row.head;
      already.weightSum += row.weightKg * row.head;
    } else {
      groups.set(key, { row: { ...row }, weightSum: row.weightKg * row.head });
    }
  }
  return [...groups.values()].map(({ row, weightSum }) => ({
    ...row,
    weightKg: row.head > 0 ? weightSum / row.head : row.weightKg,
  }));
}

/**
 * The growing herd as groups.
 *
 * Sucklers are grouped by the crate they are in rather than by their size,
 * because a heat lamp is lit per litter: two litters of six do not share one
 * lamp however alike the piglets are. Their weaning date comes off their dam's
 * card, which is a thing the farm knows today and not a guess about tomorrow.
 */
function growingGroups(
  pigs: readonly GrowingPig[],
  day: number,
  weanDayByDam: ReadonlyMap<string, number>,
): ExpectedGrowingGroup[] {
  const rows: (ExpectedGrowingGroup & { key: string })[] = [];
  for (const pig of pigs) {
    if (!pig.alive) continue;
    const suckling = pig.stage === "piglet";
    const weanDay = suckling ? (weanDayByDam.get(pig.damTag ?? "") ?? null) : null;
    const key = suckling
      ? "crate|" + (pig.damTag ?? "?") + "@" + pig.birthDay
      : [
          pig.stage,
          pig.destination,
          pig.sex,
          band(pig.weightKg, PIG_WEIGHT_BAND_KG),
          pig.ageDays(day),
        ].join("|");
    rows.push({
      key,
      head: 1,
      stage: pig.stage,
      destination: pig.destination,
      sex: pig.sex,
      weightKg: pig.weightKg,
      ageDays: pig.ageDays(day),
      litters: 0,
      weanDay,
    });
  }
  const grouped = collect(rows);
  // One crate, however many piglets are standing in it — so the litter count is
  // the number of groups, not the head that went into them.
  for (const group of grouped) {
    if (group.stage === "piglet") group.litters = 1;
  }
  return grouped;
}

/**
 * The breeding herd as groups. A sow's own calendar is part of her key: two sows
 * due on different days are two different forecasts however alike they look.
 */
function sowGroups(sows: readonly Sow[]): ExpectedSowGroup[] {
  const rows: (ExpectedSowGroup & { key: string })[] = [];
  for (const sow of sows) {
    if (!sow.alive) continue;
    rows.push({
      key: [
        sow.state,
        sow.dueDay ?? "-",
        sow.weanDay ?? "-",
        sow.nextServiceDay,
        sow.parity,
        band(sow.weightKg, SOW_WEIGHT_BAND_KG),
      ].join("|"),
      head: 1,
      weightKg: sow.weightKg,
      state: sow.state,
      parity: sow.parity,
      dueDay: sow.dueDay,
      weanDay: sow.weanDay,
      nextServiceDay: sow.nextServiceDay,
    });
  }
  return collect(rows);
}

function boarGroups(boars: readonly Boar[]): ExpectedBoarGroup[] {
  const rows: (ExpectedBoarGroup & { key: string })[] = [];
  for (const boar of boars) {
    if (!boar.alive) continue;
    rows.push({
      key: String(band(boar.weightKg, SOW_WEIGHT_BAND_KG)),
      head: 1,
      weightKg: boar.weightKg,
    });
  }
  return collect(rows);
}

/** Everything observable about the herd today, and nothing else. */
export function observeFarm(
  day: number,
  herd: { sows: readonly Sow[]; boars: readonly Boar[]; pigs: readonly GrowingPig[] },
): ExpectedFarmState {
  const weanDayByDam = new Map<string, number>();
  for (const sow of herd.sows) {
    if (!sow.alive || sow.weanDay === null) continue;
    weanDayByDam.set(sow.tag, sow.weanDay);
  }
  return {
    day,
    growing: growingGroups(herd.pigs, day, weanDayByDam),
    sows: sowGroups(herd.sows),
    boars: boarGroups(herd.boars),
  };
}
