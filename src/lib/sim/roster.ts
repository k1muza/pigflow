import type { Boar, GrowingPig, Sow } from "./animals";
import type { SowRow, StockKind, StockRow } from "./farm";

/**
 * The herd written out animal by animal, for the panels that inspect a farm at a
 * point in the plan.
 *
 * It lives apart from either engine because it belongs to neither. Both keep the
 * same animals, and a roster is a way of reading them rather than a thing an
 * engine does — so the simulator shows the same rows, in the same order, with
 * the same statuses, whichever one produced them. Written twice they would drift
 * apart on the small things nobody checks, which on a roster is all of it.
 */

const STOCK_ORDER: StockKind[] = [
  "sow",
  "gilt",
  "boar",
  "piglet",
  "weaner",
  "grower",
  "finisher",
];

/** Every live animal, sorted into a stable roster for point-in-time inspection. */
export function stockRosterOf(
  sows: readonly Sow[],
  boars: readonly Boar[],
  pigs: readonly GrowingPig[],
  day: number,
): StockRow[] {
  const on = Math.max(day, 0);
  const rows: StockRow[] = [];

  for (const sow of sows) {
    if (!sow.alive) continue;
    rows.push({
      tag: sow.tag,
      kind: "sow",
      sex: sow.sex,
      ageDays: sow.ageDays(on),
      ageMonths: sow.ageMonths(on),
      weightKg: sow.weightKg,
      generation: sow.generation,
      status:
        sow.state === "gestating"
          ? "In pig"
          : sow.state === "lactating"
            ? "Suckling"
            : "Awaiting service",
    });
  }

  for (const boar of boars) {
    if (!boar.alive) continue;
    rows.push({
      tag: boar.tag,
      kind: "boar",
      sex: boar.sex,
      ageDays: boar.ageDays(on),
      ageMonths: boar.ageMonths(on),
      weightKg: boar.weightKg,
      generation: boar.generation,
      status: "Working boar",
    });
  }

  for (const pig of pigs) {
    if (!pig.alive) continue;
    rows.push({
      tag: pig.tag,
      kind: pig.stage,
      sex: pig.sex,
      ageDays: pig.ageDays(on),
      ageMonths: pig.ageMonths(on),
      weightKg: pig.weightKg,
      generation: pig.generation,
      status: pig.destination === "breeding" ? "Replacement" : "Market",
    });
  }

  return rows.sort(
    (a, b) =>
      STOCK_ORDER.indexOf(a.kind) - STOCK_ORDER.indexOf(b.kind) ||
      b.ageDays - a.ageDays ||
      a.tag.localeCompare(b.tag),
  );
}

/** The breeding females, soonest event first — what a stockman looks at first. */
export function sowRosterOf(sows: readonly Sow[], day: number): SowRow[] {
  const on = Math.max(day, 0);
  return sows
    .filter((sow) => sow.alive)
    .map((sow) => {
      const target =
        sow.state === "gestating"
          ? sow.dueDay
          : sow.state === "lactating"
            ? sow.weanDay
            : sow.nextServiceDay;
      return {
        tag: sow.tag,
        state: sow.state,
        parity: sow.parity,
        ageMonths: sow.ageMonths(on),
        weightKg: sow.weightKg,
        generation: sow.generation,
        homeBred: sow.homeBred,
        litterSize: sow.litter.filter((piglet) => piglet.alive).length,
        totalWeaned: sow.totalWeaned,
        lifetimeCost: sow.costs.total,
        nextEvent:
          sow.state === "gestating" ? "Farrows" : sow.state === "lactating" ? "Weans" : "Served",
        daysToNextEvent: target === null ? null : Math.max(0, target - on),
      };
    })
    .sort((a, b) => (a.daysToNextEvent ?? 0) - (b.daysToNextEvent ?? 0));
}
