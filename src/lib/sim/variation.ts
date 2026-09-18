import { IRREGULAR_RETURN_DAYS, REGULAR_RETURN_DAYS } from "../config";
import type { Sex } from "./animals";
import { Rng } from "./rng";

/**
 * The two ways a plan can be made to come out.
 *
 * Every figure a herd model needs that is not simply arithmetic — how many
 * piglets are born, whether a service holds, how long a sow carries, which pigs
 * are male — has to come from somewhere. There are two honest answers, and a
 * plan says which one it wants.
 *
 * **Chance** rolls for each one. One run is a plausible farm rather than the
 * average of many, so the plan shows what a real year of luck looks like — and
 * two runs of the same plan on different seeds differ, which is the point.
 *
 * **Settled** never rolls. Each figure is taken at the rate the plan states, and
 * where that rate does not come to a whole animal the remainder is carried to
 * the next one until it does: a herd at 12.4 born alive farrows 12, 12, 13, 12,
 * 13, and averages exactly what was typed in. Nothing is drawn, so the plan has
 * one answer rather than a spread of them, and two plans can be set side by side
 * and read off directly. What it will not show you is a bad year.
 *
 * Both are reproducible. The difference is that chance reproduces one roll of
 * the dice and settled has no dice to roll.
 */
export interface Variation {
  /** Whether this plan is drawn or settled — for anything that must report it. */
  readonly settled: boolean;
  /** The sex of one piglet. */
  sex(): Sex;
  /** How many are born alive to one sow. */
  litterSize(mean: number): number;
  /** Whether one service holds. */
  conceives(rate: number): boolean;
  /** Whether this standing heat was spotted at all. */
  heatSpotted(rate: number): boolean;
  /** Whether this service goes to AI rather than to the boar team. */
  usesAi(sharePct: number): boolean;
  /** Whether a service that did not hold comes back late rather than on cue. */
  returnsIrregular(sharePct: number): boolean;
  /** How many days until she is back in heat, given which kind of return it is. */
  returnDays(irregular: boolean): number;
  /** How long this sow carries. */
  gestationDays(mean: number): number;
  /** How long this sow takes to come back into heat after weaning. */
  weanToServiceDays(mean: number): number;
  /** One pig's own thriftiness, around 1. */
  growthFactor(deviation: number): number;
  /** Days past the service minimum before a gilt shows a standing heat. */
  estrusOffsetDays(window: number): number;
}

/** Rounding slack, so 0.9999999 of an animal counts as the one it plainly is. */
const SLACK = 1e-9;

/**
 * A slate opens halfway rather than at nothing. Starting at zero would make the
 * first of everything come out low — the first service of a plan would always
 * fail, the first litter would always be the small one — which is an artefact of
 * where the counting started rather than anything about the herd.
 */
const OPENING = 0.5;

/** Everything drawn, off one seeded generator. The behaviour plans have always had. */
export class ChanceVariation implements Variation {
  readonly settled = false;
  private readonly rng: Rng;
  private readonly litterDeviation: number;
  private readonly gestationDeviation: number;
  private readonly weanToServiceDeviation: number;

  constructor(
    seed: number,
    deviations: { litter: number; gestation: number; weanToService: number },
  ) {
    this.rng = new Rng(seed);
    this.litterDeviation = deviations.litter;
    this.gestationDeviation = deviations.gestation;
    this.weanToServiceDeviation = deviations.weanToService;
  }

  sex(): Sex {
    return this.rng.chance(0.5) ? "female" : "male";
  }

  litterSize(mean: number): number {
    return this.rng.intAround(mean, this.litterDeviation, 1, 25);
  }

  conceives(rate: number): boolean {
    return this.rng.chance(rate);
  }

  heatSpotted(rate: number): boolean {
    return this.rng.chance(rate);
  }

  usesAi(sharePct: number): boolean {
    return this.rng.chance(sharePct / 100);
  }

  returnsIrregular(sharePct: number): boolean {
    return this.rng.chance(sharePct / 100);
  }

  returnDays(irregular: boolean): number {
    const band = irregular ? IRREGULAR_RETURN_DAYS : REGULAR_RETURN_DAYS;
    return band.min + Math.floor(this.rng.next() * (band.max - band.min + 1));
  }

  gestationDays(mean: number): number {
    return this.rng.normal(mean, this.gestationDeviation);
  }

  weanToServiceDays(mean: number): number {
    return this.rng.normal(mean, this.weanToServiceDeviation);
  }

  growthFactor(deviation: number): number {
    return Math.min(1.3, Math.max(0.7, this.rng.normal(1, deviation)));
  }

  estrusOffsetDays(window: number): number {
    return Math.floor(this.rng.next() * window);
  }
}

/**
 * Eight points on a normal curve, one per eighth of it, which between them have
 * exactly its mean and very nearly its spread. Handing these out in turn gives a
 * litter the range of thriftiness the plan describes without drawing for it, so
 * litter mates still do not all reach sale weight on one day.
 *
 * They are handed out in a scrambled order rather than lightest first, so that
 * nothing downstream can read a pig's thriftiness off its place in the litter —
 * gilt selection takes the ones that reach weight first, and a litter sorted
 * weakest to strongest would hand it the same position every time.
 */
const GROWTH_LADDER = [0.157, -0.887, 1.534, -0.157, 0.887, -1.534, 0.489, -0.489];

/**
 * A stride across the heat window that is coprime with 21, so successive gilts
 * land on every day of it before any day comes round again.
 */
const HEAT_STRIDE = 8;

/**
 * Nothing drawn. Rates are taken exactly, and a rate that does not come to a
 * whole animal carries its remainder forward until it does.
 */
export class SettledVariation implements Variation {
  readonly settled = true;
  private sexOwed = OPENING;
  private litterOwed = OPENING;
  private conceptionOwed = OPENING;
  private detectionOwed = OPENING;
  private aiOwed = OPENING;
  private irregularOwed = OPENING;
  private returnCursor = 0;
  private growthCursor = 0;
  private heatCursor = 0;

  /** Females and males in turn, so the herd's sex ratio is exactly even. */
  sex(): Sex {
    this.sexOwed += 0.5;
    if (this.sexOwed >= 1 - SLACK) {
      this.sexOwed -= 1;
      return "female";
    }
    return "male";
  }

  /**
   * The plan's born-alive figure, to the pig. A herd at 12.4 cannot farrow 12.4
   * piglets, so it farrows 12 and keeps the 0.4; five litters on, the carried
   * remainders have come to two extra piglets and the average is exactly 12.4.
   */
  litterSize(mean: number): number {
    this.litterOwed += mean;
    const born = Math.floor(this.litterOwed + SLACK);
    this.litterOwed -= born;
    return Math.min(25, Math.max(1, born));
  }

  /**
   * Services hold at exactly the plan's rate. At 85%, six services in seven take,
   * because the seventh is where the carried shortfall has come to a whole miss.
   */
  conceives(rate: number): boolean {
    if (rate <= 0) return false;
    if (rate >= 1) return true;
    this.conceptionOwed += rate;
    if (this.conceptionOwed >= 1 - SLACK) {
      this.conceptionOwed -= 1;
      return true;
    }
    return false;
  }

  /**
   * Heats are spotted at exactly the rate the plan states. At 92% detection the
   * thirteenth heat is where the carried shortfall has come to a whole miss.
   */
  heatSpotted(rate: number): boolean {
    if (rate <= 0) return false;
    if (rate >= 1) return true;
    this.detectionOwed += rate;
    if (this.detectionOwed >= 1 - SLACK) {
      this.detectionOwed -= 1;
      return true;
    }
    return false;
  }

  /**
   * Services go to AI at exactly the share the plan states, the same way
   * conception is taken at exactly its rate. At 30% the fourth service in ten is
   * where the carried remainder has come to a whole one.
   */
  usesAi(sharePct: number): boolean {
    if (sharePct <= 0) return false;
    if (sharePct >= 100) return true;
    this.aiOwed += sharePct / 100;
    if (this.aiOwed >= 1 - SLACK) {
      this.aiOwed -= 1;
      return true;
    }
    return false;
  }

  /** Returns come back late at exactly the share the plan states. */
  returnsIrregular(sharePct: number): boolean {
    if (sharePct <= 0) return false;
    if (sharePct >= 100) return true;
    this.irregularOwed += sharePct / 100;
    if (this.irregularOwed >= 1 - SLACK) {
      this.irregularOwed -= 1;
      return true;
    }
    return false;
  }

  /**
   * Across its band in turn rather than drawn from it, so that a settled plan
   * still has sows coming back on different days — a herd whose every return
   * landed together would batch its farrowings in a way no real one does.
   */
  returnDays(irregular: boolean): number {
    const band = irregular ? IRREGULAR_RETURN_DAYS : REGULAR_RETURN_DAYS;
    const width = band.max - band.min + 1;
    const day = band.min + (this.returnCursor % width);
    this.returnCursor += 1;
    return day;
  }

  /** Every sow carries for exactly as long as the plan says. */
  gestationDays(mean: number): number {
    return mean;
  }

  /** And comes back into heat exactly when the plan says. */
  weanToServiceDays(mean: number): number {
    return mean;
  }

  /**
   * The spread the plan describes, handed out rather than drawn. Settled does not
   * mean every pig is identical — a litter whose members all hit sale weight on
   * one day would be a lorry-load that does not exist on any real farm — it means
   * the spread is the same every time the plan is run.
   */
  growthFactor(deviation: number): number {
    const z = GROWTH_LADDER[this.growthCursor % GROWTH_LADDER.length];
    this.growthCursor += 1;
    return Math.min(1.3, Math.max(0.7, 1 + deviation * z));
  }

  /** Gilts come into heat across the window in turn rather than all at once. */
  estrusOffsetDays(window: number): number {
    if (window <= 1) return 0;
    const offset = (this.heatCursor * HEAT_STRIDE) % Math.round(window);
    this.heatCursor += 1;
    return offset;
  }
}

/** Builds whichever the plan asked for. */
export function variationFor(
  mode: "chance" | "settled",
  seed: number,
  deviations: { litter: number; gestation: number; weanToService: number },
): Variation {
  return mode === "settled" ? new SettledVariation() : new ChanceVariation(seed, deviations);
}
