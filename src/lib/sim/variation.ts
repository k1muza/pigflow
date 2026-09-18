import { IRREGULAR_RETURN_DAYS, REGULAR_RETURN_DAYS } from "../config";
import type { Sex } from "./animals";
import { keyedChance, keyedInt, keyedIntAround, keyedNormal } from "./rng";

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
/**
 * What a draw is about: the animal it concerns and the occasion it concerns her
 * on — a tag and a day, usually. Every drawn figure takes one.
 *
 * It is the key to a hash rather than a position in a sequence, which is what
 * makes a plan stable under its own development. A stream hands out values in
 * call order, so adding a draw anywhere shifts every draw after it and a change
 * to the mortality rules comes back as different litter sizes. Keyed, this sow's
 * conception on this day is hers whatever else the farm did that morning.
 *
 * The key has to be unique per occasion or two questions share an answer: a tag
 * alone is right for a lifetime trait and wrong for anything she does twice.
 * Each method adds its own label, so keys never have to be told apart by hand.
 */
export type DrawKey = readonly (string | number)[];

export interface Variation {
  /** Whether this plan is drawn or settled — for anything that must report it. */
  readonly settled: boolean;
  /** The sex of one piglet. Keyed on the dam, the day and its place in the litter. */
  sex(key: DrawKey): Sex;
  /** How many are born alive to one sow. Keyed on the dam and the farrowing. */
  litterSize(mean: number, key: DrawKey): number;
  /** Whether one service holds. Keyed on the female and the day she was served. */
  conceives(rate: number, key: DrawKey): boolean;
  /** Whether this standing heat was spotted at all. Keyed on the female and day. */
  heatSpotted(rate: number, key: DrawKey): boolean;
  /** Whether this service goes to AI rather than to the boar team. */
  usesAi(sharePct: number, key: DrawKey): boolean;
  /** Whether a service that did not hold comes back late rather than on cue. */
  returnsIrregular(sharePct: number, key: DrawKey): boolean;
  /** How many days until she is back in heat, given which kind of return it is. */
  returnDays(irregular: boolean, key: DrawKey): number;
  /** How long this sow carries. */
  gestationDays(mean: number, key: DrawKey): number;
  /** How long this sow takes to come back into heat after weaning. */
  weanToServiceDays(mean: number, key: DrawKey): number;
  /** One pig's own thriftiness, around 1. Keyed on the pig, and fixed for life. */
  growthFactor(deviation: number, key: DrawKey): number;
  /** Days past the service minimum before a gilt shows a standing heat. */
  estrusOffsetDays(window: number, key: DrawKey): number;
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

/**
 * Everything drawn, each figure keyed to the animal and occasion it belongs to.
 *
 * There is no sequence here and nothing is consumed. Two plans that differ
 * somewhere else entirely give the same sow the same conception on the same day,
 * a figure can be read twice without moving, and a draw added to the model years
 * from now will not disturb one of these. What a seed selects is not a position
 * in a stream but which farm, out of all the farms this plan could be, you are
 * looking at — and that is unchanged.
 */
export class ChanceVariation implements Variation {
  readonly settled = false;
  private readonly seed: number;
  private readonly litterDeviation: number;
  private readonly gestationDeviation: number;
  private readonly weanToServiceDeviation: number;

  constructor(
    seed: number,
    deviations: { litter: number; gestation: number; weanToService: number },
  ) {
    this.seed = seed;
    this.litterDeviation = deviations.litter;
    this.gestationDeviation = deviations.gestation;
    this.weanToServiceDeviation = deviations.weanToService;
  }

  /** This plan's seed, then what the draw is, then who and when it is about. */
  private keys(label: string, key: DrawKey): (string | number)[] {
    return [this.seed, label, ...key];
  }

  sex(key: DrawKey): Sex {
    return keyedChance(0.5, this.keys("sex", key)) ? "female" : "male";
  }

  litterSize(mean: number, key: DrawKey): number {
    return keyedIntAround(mean, this.litterDeviation, 1, 25, this.keys("litter-size", key));
  }

  conceives(rate: number, key: DrawKey): boolean {
    return keyedChance(rate, this.keys("conception", key));
  }

  heatSpotted(rate: number, key: DrawKey): boolean {
    return keyedChance(rate, this.keys("heat-spotted", key));
  }

  usesAi(sharePct: number, key: DrawKey): boolean {
    return keyedChance(sharePct / 100, this.keys("uses-ai", key));
  }

  returnsIrregular(sharePct: number, key: DrawKey): boolean {
    return keyedChance(sharePct / 100, this.keys("irregular-return", key));
  }

  returnDays(irregular: boolean, key: DrawKey): number {
    const band = irregular ? IRREGULAR_RETURN_DAYS : REGULAR_RETURN_DAYS;
    return keyedInt(band.min, band.max, this.keys("return-days", key));
  }

  gestationDays(mean: number, key: DrawKey): number {
    return keyedNormal(mean, this.gestationDeviation, this.keys("gestation", key));
  }

  weanToServiceDays(mean: number, key: DrawKey): number {
    return keyedNormal(mean, this.weanToServiceDeviation, this.keys("wean-to-service", key));
  }

  growthFactor(deviation: number, key: DrawKey): number {
    const drawn = keyedNormal(1, deviation, this.keys("growth-factor", key));
    return Math.min(1.3, Math.max(0.7, drawn));
  }

  estrusOffsetDays(window: number, key: DrawKey): number {
    return keyedInt(0, Math.max(0, window - 1), this.keys("estrus-offset", key));
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
 *
 * These methods take no key, which is deliberate rather than an oversight — a
 * key says which draw this is, and there are no draws here. What there is is a
 * running slate per figure, and the order calls arrive in is exactly what makes
 * it come out at the stated rate: at 85% conception the seventh service is the
 * one that fails because the six before it carried the shortfall to a whole
 * miss. Keying these would not make a settled plan more stable, it would stop it
 * being settled.
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
