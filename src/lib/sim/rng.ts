/**
 * Where every uncertain number in a plan comes from.
 *
 * There are two ways to get one, and the difference between them is the whole
 * point of this file.
 *
 * A **stream** hands out values in the order they are asked for. It is
 * reproducible — the same seed replays the same sequence — but each value
 * depends on how many times everything else happened to have called it first.
 * Add a draw anywhere and every draw after it shifts along, so a change to the
 * mortality rules moves litter sizes, and a plan's output stops being readable
 * as the consequence of the rule you changed.
 *
 * A **keyed draw** is a pure function of the seed and what the draw is about:
 * this sow, this day, this question. Nothing is consumed, so nothing has an
 * order to be disturbed. Two plans that differ somewhere else entirely give the
 * same sow the same number, a draw can be taken twice or not at all, and adding
 * a new kind of draw moves nothing that already existed.
 *
 * Keyed is what the model uses. {@link Rng} is kept because a stream is still
 * the right tool where the sequence itself is the point rather than an accident.
 */

/** Separator for hash keys: no tag, stage name or day number contains it. */
const KEY_SEPARATOR = "|";

/**
 * A stable number in [0, 1) for a set of keys — the whole of what makes this
 * deterministic. A pig's number is its own, so it does not move when the herd
 * around it does.
 */
export function hashUnit(...keys: (string | number)[]): number {
  const text = keys.join(KEY_SEPARATOR);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  // A finishing round, so neighbouring tags do not land next to one another.
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0x5bd1e995);
  hash ^= hash >>> 15;
  return (hash >>> 0) / 4294967296;
}

/** True with the given probability, for this key and no other. */
export function keyedChance(probability: number, keys: readonly (string | number)[]): boolean {
  if (probability <= 0) return false;
  if (probability >= 1) return true;
  return hashUnit(...keys) < probability;
}

/**
 * A normal deviate for a key.
 *
 * Box-Muller needs two uniforms. A stream takes the next two off the sequence
 * and caches the second, which is what made {@link Rng.normal} the worst of the
 * stream draws to disturb: whether a call consumed two values or none depended
 * on how many normal draws had come before it, so adding one re-paired every
 * later one. Here the two uniforms are simply two different keys, so there is
 * no pairing to disturb and no cache to keep.
 */
export function keyedNormal(
  mean: number,
  deviation: number,
  keys: readonly (string | number)[],
): number {
  // Nudged off zero: log(0) is not a number, and a key can hash to it.
  const u = Math.max(hashUnit(...keys, "u"), Number.MIN_VALUE);
  const v = hashUnit(...keys, "v");
  return mean + deviation * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** A rounded normal deviate clamped to a range — used for litter size. */
export function keyedIntAround(
  mean: number,
  deviation: number,
  min: number,
  max: number,
  keys: readonly (string | number)[],
): number {
  return Math.min(max, Math.max(min, Math.round(keyedNormal(mean, deviation, keys))));
}

/** A whole number in [min, max], both ends included. */
export function keyedInt(
  min: number,
  max: number,
  keys: readonly (string | number)[],
): number {
  if (max <= min) return min;
  return min + Math.floor(hashUnit(...keys) * (max - min + 1));
}

/**
 * Small deterministic generator (mulberry32), kept for the places where a
 * sequence is what is wanted. Every value depends on how many were drawn before
 * it, so anything read off it moves when the code around it changes — see the
 * note at the top of this file before reaching for it.
 */
export class Rng {
  private state: number;
  private spare: number | null = null;

  constructor(seed: number) {
    this.state = (Math.floor(seed) >>> 0) || 1;
  }

  /** Uniform value in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** True with the given probability. */
  chance(probability: number): boolean {
    if (probability <= 0) return false;
    if (probability >= 1) return true;
    return this.next() < probability;
  }

  /** Normal deviate via Box-Muller, cached in pairs. */
  normal(mean: number, deviation: number): number {
    if (this.spare !== null) {
      const value = this.spare;
      this.spare = null;
      return mean + deviation * value;
    }
    let u = 0;
    let v = 0;
    while (u === 0) u = this.next();
    while (v === 0) v = this.next();
    const radius = Math.sqrt(-2 * Math.log(u));
    const angle = 2 * Math.PI * v;
    this.spare = radius * Math.sin(angle);
    return mean + deviation * radius * Math.cos(angle);
  }

  /** Rounded normal deviate clamped to a range — used for litter size. */
  intAround(mean: number, deviation: number, min: number, max: number): number {
    const draw = Math.round(this.normal(mean, deviation));
    return Math.min(max, Math.max(min, draw));
  }

  /** Uniform pick, or undefined for an empty list. */
  pick<T>(items: readonly T[]): T | undefined {
    if (items.length === 0) return undefined;
    return items[Math.floor(this.next() * items.length)];
  }
}

/**
 * Converts a whole-period mortality rate into the daily hazard that produces it
 * over the given number of days.
 */
export function dailyHazard(periodMortalityPct: number, periodDays: number): number {
  if (periodMortalityPct <= 0 || periodDays <= 0) return 0;
  if (periodMortalityPct >= 100) return 1;
  return 1 - Math.pow(1 - periodMortalityPct / 100, 1 / periodDays);
}
