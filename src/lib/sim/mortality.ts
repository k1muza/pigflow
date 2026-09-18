import type { PlannerConfig } from "../config";
import type { GrowingPig, PigStage } from "./animals";

/**
 * Mortality, booked in advance rather than rolled every morning.
 *
 * Testing every pig against a hazard each day is honest arithmetic and quite
 * wrong at the scale a small piggery works at. A twelve-pig litter carrying a
 * 10% pre-weaning loss owes 1.2 deaths; independent coin flips hand it nought
 * one time and four the next, and on a two-sow plan that swing is larger than
 * most of the decisions the plan exists to weigh up.
 *
 * So the losses are placed instead of drawn. When a cohort enters a stage the
 * scheduler works out what that stage owes on it, keeps the fraction back for
 * the cohorts behind it, settles which pigs it falls on, and writes each one a
 * day to die on that follows the stage's own risk curve. The plan's mortality
 * percentages come out of the far end as very nearly what was typed in.
 *
 * Every number it needs is read off the animal it applies to — the plan seed,
 * the stage, the pig's birth cohort and its tag — and never off a counter or a
 * shared stream. That is what keeps the losses still when something unrelated
 * changes: a running position would shift for every pig behind it the moment
 * one more pig was alive on some earlier day, which is the fault this replaced.
 */

/** A stretch of a stage, and the share of that stage's deaths that land in it. */
export type MortalityBand = {
  /** Last day of the band, counted from the day the pig entered the stage. */
  throughDay: number;
  /** Share of the stage's deaths falling inside it. Shares sum to 1. */
  share: number;
};

/**
 * When losses actually happen, which is not evenly.
 *
 * Most pre-weaning deaths are crushing, chilling and starvation in the first
 * days of life, so more than half of a litter's losses land before day three.
 * Weaning is the other shock — feed and water intake stall over the change, and
 * the losses follow it within the fortnight. A grower or a finisher dies at a
 * fairly even rate unless there is disease pressure, which this does not model.
 */
export const MORTALITY_PROFILES: Record<PigStage, readonly MortalityBand[]> = {
  piglet: [
    { throughDay: 3, share: 0.55 },
    { throughDay: 7, share: 0.2 },
    { throughDay: Infinity, share: 0.25 },
  ],
  weaner: [
    { throughDay: 7, share: 0.45 },
    { throughDay: 14, share: 0.25 },
    { throughDay: Infinity, share: 0.3 },
  ],
  grower: [{ throughDay: Infinity, share: 1 }],
  finisher: [{ throughDay: Infinity, share: 1 }],
  gilt: [{ throughDay: Infinity, share: 1 }],
};

/** Losses spread flat across every stage, for a plan that wants no shape at all. */
const EVEN_PROFILE: readonly MortalityBand[] = [{ throughDay: Infinity, share: 1 }];

const EVEN_PROFILES: Record<PigStage, readonly MortalityBand[]> = {
  piglet: EVEN_PROFILE,
  weaner: EVEN_PROFILE,
  grower: EVEN_PROFILE,
  finisher: EVEN_PROFILE,
  gilt: EVEN_PROFILE,
};

/** Stands in for the seed on a settled plan, where the seed means nothing. */
const SETTLED_KEY = 0;

/** Rounding slack, so 0.9999999 deaths owed counts as the one it plainly is. */
const FLOAT_SLACK = 1e-9;

/** Separator for hash keys: no tag, stage name or day number contains it. */
const KEY_SEPARATOR = "|";

/**
 * A stable number in [0, 1) for a set of keys — the whole of what makes this
 * deterministic. It replaces a draw off a shared stream, whose value depends on
 * how many times everything else happened to have called it first. A pig's
 * number is its own, so it does not move when the herd around it does.
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

/**
 * How well an animal stands up to a stage, as a fixed number of its own. Low is
 * frail: the deaths a stage owes fall on its weakest first. It is drawn from the
 * plan seed, the stage, the animal's birth cohort and its tag, so the same pig
 * is equally hardy in two plans that differ somewhere else entirely.
 */
export function frailty(seed: number, stage: string, cohort: number, tag: string): number {
  return hashUnit(seed, stage, cohort, tag);
}

/**
 * Which pigs a stage's losses fall on, as a fixed number per animal: the lowest
 * goes first. Frailty on its own is not enough, because two pigs entering a
 * stage together are not equally exposed to it — a thrifty pig is through the
 * grower house in five weeks where a poor one takes seven, and starting stock is
 * put on the farm spread right across a stage, some of it a day from leaving.
 * Dividing each animal's own remaining risk into its frailty races those
 * exposures against one another: a pig with twice as much of the stage still to
 * go is twice as likely to be the one that goes, and its number is still its own
 * rather than drawn.
 */
function exposureScore(seed: number, stage: PigStage, pig: GrowingPig, risk: number): number {
  if (risk <= 0) return Number.POSITIVE_INFINITY;
  const own = frailty(seed, stage, pig.cohort, pig.tag);
  return -Math.log(Math.max(own, Number.EPSILON)) / risk;
}

/** The bare identity a breeding animal is ranked by; Sow and Boar both fit it. */
export type BreedingAnimal = { tag: string; birthDay: number };

/**
 * How much risk this breeder takes before it goes. Paired with the exposure it
 * has actually accrued, it is what stops a boar bought on Tuesday dying on
 * Wednesday for risk that a sow culled last year ran up: a farm-level slate says
 * how many go, but who goes has to be read off how long each of them has stood.
 */
function breedingTolerance(seed: number, animal: BreedingAnimal): number {
  const own = frailty(seed, "breeding", animal.birthDay, animal.tag);
  return -Math.log(Math.max(own, Number.EPSILON));
}

/** How long a pig is in a stage on the plan's own figures. */
export function stageDurationDays(stage: PigStage, config: PlannerConfig): number {
  switch (stage) {
    case "piglet":
      return config.reproduction.weaningAgeDays;
    case "weaner":
      return (
        (config.growth.growerStartWeightKg - config.growth.weaningWeightKg) /
        config.growth.weanerDailyGainKg
      );
    case "grower":
      return (
        (config.growth.finisherStartWeightKg - config.growth.growerStartWeightKg) /
        config.growth.growerDailyGainKg
      );
    case "finisher":
      return (
        (config.growth.saleWeightKg - config.growth.finisherStartWeightKg) /
        config.growth.finisherDailyGainKg
      );
    case "gilt":
      return 60;
  }
}

/**
 * The part of a whole-stage risk that falls in a fraction of that stage. A pig
 * put on the farm halfway through its growing stage carries half the stage's
 * loss, not all of it — compounded rather than halved, because surviving two
 * halves of a stage is surviving the whole of it.
 */
export function partialRisk(rate: number, fraction: number): number {
  if (rate <= 0 || fraction <= 0) return 0;
  if (rate >= 1) return 1;
  if (fraction >= 1) return rate;
  return 1 - Math.pow(1 - rate, fraction);
}

/** What a stage's mortality input comes to over the whole of that stage. */
export function stageMortalityRate(stage: PigStage, config: PlannerConfig): number {
  switch (stage) {
    case "piglet":
      return config.reproduction.preWeanMortalityPct / 100;
    case "weaner":
      return config.growth.weanerMortalityPct / 100;
    case "grower":
      return config.growth.growerMortalityPct / 100;
    case "finisher":
      return config.growth.finisherMortalityPct / 100;
    case "gilt":
      // A gilt being reared is carried at the breeding herd's annual risk for
      // as long as she is in the pipeline, which is how she is costed too.
      return partialRisk(
        config.herd.sowAnnualMortalityPct / 100,
        stageDurationDays("gilt", config) / 365,
      );
  }
}

/** A band of one pig's own stage, with the share of its losses it carries. */
export type StageBand = { from: number; to: number; weight: number };

/**
 * The risk curve clipped to one pig's own stage length and re-weighted to sum to
 * one, so a short stage still carries all of the losses it is owed. The days are
 * counted from the day the pig was born into the stage, not from the day it was
 * booked — which for starting stock already partway through are not the same day.
 */
export function stageBands(
  bands: readonly MortalityBand[],
  stageDays: number,
): StageBand[] {
  const span = Math.max(1, stageDays);
  const clipped: { from: number; to: number; share: number }[] = [];
  let from = 0;
  for (const band of bands) {
    if (from >= span) break;
    const to = Math.min(band.throughDay + 1, span);
    if (to <= from) continue;
    clipped.push({ from, to, share: band.share });
    from = to;
  }
  if (clipped.length === 0) return [{ from: 0, to: span, weight: 1 }];
  const total = clipped.reduce((sum, band) => sum + band.share, 0);
  if (total <= 0) return [{ from: 0, to: span, weight: 1 }];
  return clipped.map((band) => ({ from: band.from, to: band.to, weight: band.share / total }));
}

/**
 * The share of a stage's losses already behind a pig that has been in it a while.
 * A piglet three weeks old is past the days that carry most of the risk, so what
 * it has left is a quarter of the stage's losses rather than the quarter of its
 * days that a flat reading would give.
 */
export function shareBefore(bands: readonly StageBand[], day: number): number {
  let share = 0;
  for (const band of bands) {
    if (day >= band.to) {
      share += band.weight;
      continue;
    }
    if (day > band.from && band.to > band.from) {
      share += band.weight * ((day - band.from) / (band.to - band.from));
    }
    break;
  }
  return Math.min(1, Math.max(0, share));
}

/** The day of a stage by which a given share of its losses has been reached. */
export function dayAtShare(bands: readonly StageBand[], share: number): number {
  if (bands.length === 0) return 0;
  const last = bands[bands.length - 1];
  let walked = 0;
  for (const band of bands) {
    if (share <= walked + band.weight || band === last) {
      const within = band.weight > 0 ? (share - walked) / band.weight : 0;
      const across = Math.min(1, Math.max(0, within));
      return band.from + across * (band.to - band.from);
    }
    walked += band.weight;
  }
  return last.to;
}

/**
 * What is left of a stage's risk for an animal that has already survived part of
 * it. Prorating by time would be wrong wherever the curve is not flat: a piglet
 * four days old has six sevenths of the suckling stage ahead of it but well under
 * half of its danger, because most of that was in the days it has just lived
 * through. What matters is the share of the losses still to come, conditioned on
 * having got this far.
 */
export function riskStillToCome(rate: number, sharePast: number): number {
  if (rate <= 0) return 0;
  if (rate >= 1) return 1;
  const past = rate * Math.min(1, Math.max(0, sharePast));
  const survived = 1 - past;
  return survived > 0 ? (rate - past) / survived : 0;
}

/** How much of a stage an animal has behind it, and how much still to run. */
export type StageSpan = { elapsed: number; remaining: number };

/** Deaths a stage owes but has not yet been able to place, carried forward. */
type StageDebt = Record<PigStage, number>;

export class MortalityScheduler {
  private readonly config: PlannerConfig;
  private readonly seed: number;
  private readonly profiles: Record<PigStage, readonly MortalityBand[]>;
  private readonly owed: StageDebt;
  /** The breeding herd is individuals rather than cohorts, so it owes by the day. */
  private breedingOwed: number;
  private readonly breedingDailyRisk: number;
  /** Risk each breeder standing today has run up, by tag. */
  private breedingExposure = new Map<string, number>();

  constructor(config: PlannerConfig) {
    this.config = config;
    // A settled plan is meant to have one answer, so nothing in it may turn on
    // the seed — not even which of two equally placed pigs the loss falls on.
    this.seed = config.project.variation === "settled" ? SETTLED_KEY : config.project.seed;
    this.profiles =
      config.health.mortalityTiming === "even" ? EVEN_PROFILES : MORTALITY_PROFILES;
    this.breedingDailyRisk = partialRisk(config.herd.sowAnnualMortalityPct / 100, 1 / 365);

    // Every slate opens part-written. Starting each one at nothing would hand
    // every plan a stretch at the beginning with no losses in it at all — three
    // breeders at 8% take four years to owe their first whole death, so a
    // three-year plan would report none, on any seed. A fixed opening balance
    // drawn from the plan seed puts the first loss where it belongs on average
    // while leaving the run exactly as reproducible as it was.
    const phase = (key: string) => hashUnit(this.seed, "opening-balance", key);
    this.owed = {
      piglet: phase("piglet"),
      weaner: phase("weaner"),
      grower: phase("grower"),
      finisher: phase("finisher"),
      gilt: phase("gilt"),
    };
    this.breedingOwed = phase("breeding");
  }

  /** What a stage still owes — for tests, and for reading the books after a run. */
  debt(stage: PigStage): number {
    return this.owed[stage];
  }

  /**
   * Books a cohort into a stage: works out the deaths that stage owes on it,
   * settles which pigs they fall on, and writes each of those a day to die.
   *
   * The fraction left over stays on the stage's slate. Five twelve-pig litters
   * at 10% owe 1.2 deaths each; they are charged one apiece and the sixth death
   * is placed on the fifth litter, where the carried fractions come to a whole.
   */
  enterStage(members: readonly GrowingPig[], stage: PigStage, day: number): void {
    if (members.length === 0) return;
    const rate = stageMortalityRate(stage, this.config);
    if (rate <= 0) return;

    const profile = this.profiles[stage];
    const entering: {
      pig: GrowingPig;
      span: StageSpan;
      bands: StageBand[];
      past: number;
      score: number;
    }[] = [];
    for (const pig of members) {
      if (!pig.alive || pig.deathStage !== null) continue;
      const span = this.spanFor(pig, stage, day);
      // A pig with under a day left in the stage cannot be killed inside it.
      if (span.remaining < 1) continue;
      // The curve is laid over the whole of this pig's own stage, and the part it
      // has already lived through is taken off both what it owes and where its
      // death can fall. Starting stock booked partway through a stage is not a
      // newborn, and must not be charged or timed as though it were one.
      const bands = stageBands(profile, span.elapsed + span.remaining);
      const past = shareBefore(bands, span.elapsed);
      const risk = riskStillToCome(rate, past);
      this.owed[stage] += risk;
      entering.push({
        pig,
        span,
        bands,
        past,
        score: exposureScore(this.seed, stage, pig, risk),
      });
    }
    if (entering.length === 0) return;

    let due = Math.floor(this.owed[stage] + FLOAT_SLACK);
    if (due <= 0) return;
    // More owed than there are pigs to take it: the rest waits for the next lot.
    if (due > entering.length) due = entering.length;
    this.owed[stage] -= due;

    entering.sort((a, b) => a.score - b.score);
    for (let i = 0; i < due; i += 1) {
      const { pig, span, bands, past } = entering[i];
      // Where on the curve this death falls is the pig's own number too, not its
      // place in the queue. Working it out from position in the cohort would put
      // every single-death litter's loss on the same day of life — one death can
      // only sit in one spot, and a curve with three bands in it would never use
      // two of them. Reading it off the pig spreads the losses along the curve
      // across the farm, and keeps them where they are when the herd changes.
      //
      // The draw runs over the share of the curve still ahead of this pig, so a
      // piglet already three weeks old is placed in the late band it is actually
      // living in rather than back at the start of the risky first days.
      const own = hashUnit(this.seed, "death-time", stage, pig.cohort, pig.tag);
      const dayOfStage = dayAtShare(bands, past + own * (1 - past));
      const lastDay = Math.max(0, Math.ceil(span.remaining) - 1);
      const offset = Math.max(0, Math.floor(dayOfStage - span.elapsed));
      pig.deathStage = stage;
      pig.deathDay = day + Math.min(offset, lastDay);
    }
  }

/**
   * Where in a stage this pig stands: how much of it is behind it and how much is
   * still to run. Read off its own growth rather than the plan's average, so a
   * thrifty pig — which is through the stage sooner — carries proportionately
   * less of it, and so starting stock placed partway through a stage is charged
   * and timed on the part of it still to come.
   */
  private spanFor(pig: GrowingPig, stage: PigStage, day: number): StageSpan {
    const { growth, herd, reproduction } = this.config;
    if (stage === "piglet") {
      const age = Math.max(0, pig.ageDays(day));
      return { elapsed: age, remaining: Math.max(0, reproduction.weaningAgeDays - age) };
    }
    const from =
      stage === "weaner"
        ? growth.weaningWeightKg
        : stage === "grower"
          ? growth.growerStartWeightKg
          : stage === "finisher"
            ? growth.finisherStartWeightKg
            : growth.saleWeightKg;
    const to =
      stage === "weaner"
        ? growth.growerStartWeightKg
        : stage === "grower"
          ? growth.finisherStartWeightKg
          : stage === "finisher"
            ? growth.saleWeightKg
            : herd.giltServiceWeightKg;
    const gain = pig.dailyGainKg(this.config);
    if (gain <= 0) {
      return { elapsed: 0, remaining: Math.max(1, stageDurationDays(stage, this.config)) };
    }
    return {
      elapsed: Math.max(0, (pig.weightKg - from) / gain),
      remaining: Math.max(0, (to - pig.weightKg) / gain),
    };
  }

  /**
   * Risk a stage's occupants are carrying today over and above the plan's own
   * rate — an overcrowded room, in the only stress this model has so far.
   *
   * It is the same carried-fraction arithmetic the rest of the scheduler runs
   * on: the extra risk goes onto the stage's slate, and whenever that comes to a
   * whole animal the loss is booked for today on whichever of the pigs standing
   * there is furthest through its own tolerance. So a room a tenth over its
   * places does not kill a tenth of a pig, and a room at double stocking loses
   * measurably more than one inside its walls.
   */
  chargeStress(
    stage: PigStage,
    members: readonly GrowingPig[],
    extraDailyRisk: number,
    day: number,
  ): number {
    if (extraDailyRisk <= 0) return 0;
    const exposed = members.filter((pig) => pig.alive && pig.deathStage === null);
    if (exposed.length === 0) return 0;

    this.owed[stage] += exposed.length * extraDailyRisk;
    let due = Math.floor(this.owed[stage] + FLOAT_SLACK);
    if (due <= 0) return 0;
    if (due > exposed.length) due = exposed.length;
    this.owed[stage] -= due;

    const ranked = exposed
      .map((pig) => ({
        pig,
        score: frailty(this.seed, "crowding", pig.cohort, pig.tag),
      }))
      .sort((a, b) => a.score - b.score);
    for (let i = 0; i < due; i += 1) {
      ranked[i].pig.deathStage = stage;
      ranked[i].pig.deathDay = day;
    }
    return due;
  }

  /** Whether this pig's booked day has come. */
  isDue(pig: GrowingPig, day: number): boolean {
    return pig.deathStage !== null && pig.deathDay !== null && day >= pig.deathDay;
  }

  /** Closes a booking that has been carried out. Nothing is owed back. */
  settle(pig: GrowingPig): void {
    pig.deathStage = null;
    pig.deathDay = null;
  }

  /**
   * Hands back a death that will not now happen, because the pig left the stage
   * alive — it grew on, went to the abattoir, or took a sow place before its day
   * came. The stage keeps the debt, so the loss falls on the next cohort through
   * it rather than quietly going missing from the plan's mortality.
   */
  release(pig: GrowingPig): void {
    const stage = pig.deathStage;
    if (stage === null) return;
    this.owed[stage] += 1;
    pig.deathStage = null;
    pig.deathDay = null;
  }

  /**
   * Which of the breeding herd die today. Sows and boars are individuals rather
   * than a cohort moving through a stage, so their risk is accrued by the day and
   * settled as it comes to whole animals — the same carried-fraction arithmetic,
   * run daily instead of per cohort.
   *
   * How many go is a farm-level figure, but who goes cannot be: a slate that fell
   * due the week a replacement boar arrived would take him for risk the sow he
   * replaced had spent four years running up. So each breeder carries the
   * exposure it has actually stood, and the losses fall on whoever is furthest
   * through their own tolerance. An animal that joined yesterday has next to
   * nothing behind it and is not in the running.
   */
  claimBreedingDeaths<T extends BreedingAnimal>(breeders: readonly T[]): T[] {
    if (breeders.length === 0 || this.breedingDailyRisk <= 0) return [];

    // Another day standing is another day of risk, and only for those standing.
    // Rebuilding the tally each day also drops whoever has left the herd.
    const carried = new Map<string, number>();
    for (const animal of breeders) {
      carried.set(
        animal.tag,
        (this.breedingExposure.get(animal.tag) ?? 0) + this.breedingDailyRisk,
      );
    }
    this.breedingExposure = carried;

    this.breedingOwed += breeders.length * this.breedingDailyRisk;
    let due = Math.floor(this.breedingOwed + FLOAT_SLACK);
    if (due <= 0) return [];
    if (due > breeders.length) due = breeders.length;
    this.breedingOwed -= due;

    return breeders
      .map((animal) => ({
        animal,
        wear: (carried.get(animal.tag) ?? 0) / breedingTolerance(this.seed, animal),
      }))
      .sort((a, b) => b.wear - a.wear)
      .slice(0, due)
      .map((row) => row.animal);
  }
}
