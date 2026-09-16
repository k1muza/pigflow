/**
 * Small deterministic generator (mulberry32). Every simulated outcome comes from
 * here, so the same plan and seed always reproduce the same farm.
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
