import { Boar, Sow, type Animal, type Sex } from "./sim/animals";

export type PedigreeKind = "pig" | "sow" | "boar" | "stud";
export type PedigreeOrigin = "starting" | "born" | "purchased" | "ai";

/**
 * One genetic individual seen anywhere in a simulation.
 *
 * It is intentionally immutable history rather than a live-animal roster: a pig
 * that was sold in year two must still be available when somebody opens the
 * ancestry graph in year five. A home-bred gilt keeps one tag when she becomes a
 * sow, so remembering her again upgrades the kind rather than creating a second
 * node.
 */
export type PedigreeRecord = {
  tag: string;
  kind: PedigreeKind;
  sex: Sex;
  generation: number | null;
  birthDay: number | null;
  /** Simulation day this individual first becomes part of the pedigree. */
  firstSeenDay: number;
  damTag: string | null;
  sireTag: string | null;
  origin: PedigreeOrigin;
};

function kindOf(animal: Animal): Exclude<PedigreeKind, "stud"> {
  if (animal instanceof Sow) return "sow";
  if (animal instanceof Boar) return "boar";
  return "pig";
}

function strongerKind(
  before: Exclude<PedigreeKind, "stud">,
  after: Exclude<PedigreeKind, "stud">,
): Exclude<PedigreeKind, "stud"> {
  if (after === "sow" || after === "boar") return after;
  return before;
}

/**
 * A run-long ledger of lineage.
 *
 * The engines are free to remove sold and dead animals from their live arrays;
 * this ledger is not. It stores one small row when an animal first exists and is
 * therefore proportional to animals born, not animals × days.
 */
export class PedigreeRegistry {
  private readonly animals = new Map<string, PedigreeRecord>();

  remember(
    animal: Animal,
    origin?: PedigreeOrigin,
    firstSeenDay: number = Math.max(0, animal.birthDay),
  ): void {
    const before = this.animals.get(animal.tag);
    const nextKind = kindOf(animal);
    if (before) {
      this.animals.set(animal.tag, {
        ...before,
        kind:
          before.kind === "stud"
            ? nextKind
            : strongerKind(before.kind, nextKind),
        // Seeding can first create an opening litter through the normal birth
        // path and then identify the whole opening herd as starting stock.
        origin: origin ?? before.origin,
        firstSeenDay: origin === undefined ? before.firstSeenDay : firstSeenDay,
      });
      return;
    }

    this.animals.set(animal.tag, {
      tag: animal.tag,
      kind: nextKind,
      sex: animal.sex,
      generation: animal.generation,
      birthDay: animal.birthDay,
      firstSeenDay,
      damTag: animal.damTag,
      sireTag: animal.sireTag,
      origin: origin ?? "born",
    });
  }

  rememberMany(
    animals: readonly Animal[],
    origin?: PedigreeOrigin,
    firstSeenDay = 0,
  ): void {
    for (const animal of animals) this.remember(animal, origin, firstSeenDay);
  }

  /**
   * The whole pedigree in stable order.
   *
   * AI sires are real parents even though no boar object ever stands on the
   * farm. They are materialised here from the children that name them so every
   * edge in the graph has a node at both ends.
   */
  records(): PedigreeRecord[] {
    const rows = [...this.animals.values()].map((row) => ({ ...row }));
    const known = new Set(rows.map((row) => row.tag));
    const studs = new Map<string, number>();
    for (const row of rows) {
      if (!row.sireTag?.startsWith("AI-") || known.has(row.sireTag)) continue;
      const seen = studs.get(row.sireTag);
      studs.set(row.sireTag, seen === undefined ? row.firstSeenDay : Math.min(seen, row.firstSeenDay));
    }
    for (const [tag, childDay] of studs) {
      rows.push({
        tag,
        kind: "stud",
        sex: "male",
        generation: null,
        birthDay: null,
        // Put a virtual sire slightly before the first litter it produced. The
        // exact collection day is unknown, so this is a display anchor rather
        // than invented biological history.
        firstSeenDay: Math.max(0, childDay - 30),
        damTag: null,
        sireTag: null,
        origin: "ai",
      });
    }
    return rows.sort(
      (a, b) =>
        (a.generation ?? -1) - (b.generation ?? -1) ||
        (a.birthDay ?? Number.MIN_SAFE_INTEGER) - (b.birthDay ?? Number.MIN_SAFE_INTEGER) ||
        a.tag.localeCompare(b.tag),
    );
  }
}
