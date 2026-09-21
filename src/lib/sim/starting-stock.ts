import {
  BIRTH_WEIGHT_KG,
  DAYS_PER_MONTH,
  GILT_ENTRY_AGE_DAYS,
  MATURE_SOW_WEIGHT_KG,
  STARTING_PIG_TYPES,
  expectedGiltServiceAgeDays,
  type PlannerConfig,
  type StartingBoarEntry,
  type StartingPigEntry,
  type StartingSowEntry,
  type StartingStockEntry,
} from "../config";
import { Boar, GrowingPig, Sow, type CostStage, type PigStage } from "./animals";
import type { Variation } from "./variation";

/**
 * Putting the farm's own opening stock on the farm.
 *
 * A plan that says only "twenty sows, sixty growers" leaves the model to invent
 * what those animals are worth, and there is no honest way to do it: the growers
 * open at nothing, which makes the first lorry-load look like pure margin, and
 * the sows are priced at what a replacement gilt costs here, which is a figure
 * from a farm that is not this one. So a plan can instead describe what it
 * actually has, group by group, each group with the value its owner puts on it.
 *
 * That value is an opening balance and is treated as one throughout. Nothing
 * here posts to the ledger, touches the cash book or records a movement in the
 * second set of books: the animals simply exist, carrying what they are worth,
 * before the first day runs. The farm is worth more for having them, and no
 * month is charged for them.
 *
 * Both engines seed through here, because the alternative is two descriptions
 * of the same farm that can drift apart.
 */

/**
 * What this module needs of a farm in order to put animals on it.
 *
 * `Farm` and `World` keep their animals, their tags and their draws in their own
 * ways. Each hands over a small object shaped like this rather than this module
 * knowing either of them.
 */
export type StartingStockHost = {
  readonly config: PlannerConfig;
  readonly variation: Variation;
  readonly pigs: GrowingPig[];
  readonly sows: Sow[];
  readonly boars: Boar[];
  nextPigTag(): string;
  nextSowTag(): string;
  nextBoarTag(): string;
  /** This animal's own thriftiness and first-heat timing, keyed to its tag. */
  growthDraw(tag: string): { growthFactor: number; estrusOffsetDays: number };
  /** Marks a pig as already through the vaccinations its age has passed. */
  catchUpVaccinations(pig: GrowingPig, day: number): void;
  /** Books a group onto the mortality slate for the stage it is standing in. */
  enterStage(pigs: readonly GrowingPig[], stage: PigStage, day: number): void;
  /** Counts a piglet suckling on an opening sow, which the herd tables read. */
  noteBirth(generation: number): void;
  /**
   * Pens a group, for the engine that has pens. 2.0 moves and sells a batch
   * rather than an animal, so a group entered here is a batch there; 1.x has
   * nothing to pen and leaves this out.
   */
  penCohort?(pigs: readonly GrowingPig[], stage: PigStage): void;
};

/** A boar's age when he starts work, which is what the plain counts assume. */
const BOAR_SERVICE_ENTRY_AGE_DAYS = GILT_ENTRY_AGE_DAYS + 60;

function isSowEntry(entry: StartingStockEntry): entry is StartingSowEntry {
  return entry.type === "sow";
}

function isBoarEntry(entry: StartingStockEntry): entry is StartingBoarEntry {
  return entry.type === "boar";
}

function isPigEntry(entry: StartingStockEntry): entry is StartingPigEntry {
  return entry.type !== "sow" && entry.type !== "boar";
}

/** A count is a head count: a third of an animal stands nowhere. */
function headOf(entry: StartingStockEntry): number {
  return Math.max(0, Math.round(entry.count));
}

/**
 * Piglets entered with no sow to suckle them, if any.
 *
 * Read by the plan warnings as well as by the seeding, so that what the farm
 * does about it is said on screen rather than only done.
 */
export function orphanStartingPiglets(config: PlannerConfig): number {
  const entries = config.stock.starting;
  const piglets = entries
    .filter(isPigEntry)
    .filter((entry) => entry.type === "piglet")
    .reduce((total, entry) => total + headOf(entry), 0);
  if (piglets === 0) return 0;
  const suckling = entries
    .filter(isSowEntry)
    .filter((entry) => entry.reproductiveState === "lactating")
    .reduce((total, entry) => total + headOf(entry), 0);
  return suckling > 0 ? 0 : piglets;
}

/** What the whole of the opening stock is worth: every group, counted out. */
export function openingStockValue(config: PlannerConfig): number {
  return config.stock.starting.reduce(
    (total, entry) => total + headOf(entry) * entry.openingValuePerHead,
    0,
  );
}

/** The plural name of a kind of starting animal, for a heading or a label. */
export const STARTING_STOCK_LABELS: Record<StartingStockEntry["type"], string> = {
  piglet: "Piglets",
  weaner: "Weaners",
  grower: "Growers",
  finisher: "Finishers",
  gilt: "Maiden gilts",
  sow: "Breeding sows",
  boar: "Boars",
};

/**
 * One group in a few words: what the animals are and what tells this group
 * apart from the next one of the same kind.
 *
 * Shared by the workbook and the screen so that a plan reads the same in both.
 */
export function describeStartingStock(entry: StartingStockEntry): string {
  const name = STARTING_STOCK_LABELS[entry.type];
  if (isSowEntry(entry)) {
    return `${name}, parity ${entry.parity}, ${entry.reproductiveState}`;
  }
  if (isBoarEntry(entry)) {
    const months = entry.monthsInService ?? 0;
    return months > 0 ? `${name}, ${months} months in service` : `${name}, newly in service`;
  }
  const marks: string[] = [];
  if (entry.averageWeightKg !== undefined) marks.push(`${entry.averageWeightKg} kg`);
  if (entry.averageAgeDays !== undefined) marks.push(`${entry.averageAgeDays} days old`);
  return marks.length > 0 ? `${name}, ${marks.join(", ")}` : name;
}

/**
 * Places every group the plan was given, in one settled order.
 *
 * Sows before boars before pigs, and the pigs youngest stage first, which is
 * the order the plain head counts are placed in. The order is what settles the
 * tags, and every draw is keyed to a tag, so it is fixed here rather than left
 * to however the rows happen to be sorted on screen.
 */
export function seedStartingStock(host: StartingStockHost): void {
  const entries = host.config.stock.starting;

  const lactating: Sow[] = [];
  for (const entry of entries.filter(isSowEntry)) placeSows(host, entry, lactating);
  for (const entry of entries.filter(isBoarEntry)) placeBoars(host, entry);

  const pigs = entries.filter(isPigEntry);
  for (const type of STARTING_PIG_TYPES) {
    for (const entry of pigs.filter((candidate) => candidate.type === type)) {
      if (type === "gilt") placeGilts(host, entry);
      else if (type === "piglet") placePiglets(host, entry, lactating);
      else placeGrowingPigs(host, entry, type);
    }
  }
}

// ------------------------------------------------------------- breeding stock

/** The days a sow takes to get from one service to the next. */
function cycleDaysOf(config: PlannerConfig): number {
  const { reproduction } = config;
  return (
    reproduction.gestationDays + reproduction.weaningAgeDays + reproduction.weanToServiceDays
  );
}

/**
 * How far through her cycle the nth sow of a group is.
 *
 * A group is spread across the part of the cycle its state covers, so three
 * gestating sows are three farrowings on three days rather than one crowd on
 * one. The spread is even and by position rather than drawn: two plans that say
 * the same thing get the same farm.
 */
function phaseFor(
  entry: StartingSowEntry,
  index: number,
  count: number,
  config: PlannerConfig,
): number {
  const { reproduction } = config;
  const within = (span: number) => (count <= 1 ? 0 : Math.floor((index * span) / count));
  if (entry.reproductiveState === "gestating") return within(reproduction.gestationDays);
  if (entry.reproductiveState === "lactating") {
    return reproduction.gestationDays + within(reproduction.weaningAgeDays);
  }
  return (
    reproduction.gestationDays +
    reproduction.weaningAgeDays +
    within(reproduction.weanToServiceDays)
  );
}

function placeSows(host: StartingStockHost, entry: StartingSowEntry, lactating: Sow[]): void {
  const { config } = host;
  const { reproduction } = config;
  const cycleDays = cycleDaysOf(config);
  const count = headOf(entry);
  // A sow suckling a litter has reared at least one, whatever the row says.
  const parity =
    entry.reproductiveState === "lactating" ? Math.max(1, entry.parity) : entry.parity;

  for (let index = 0; index < count; index += 1) {
    const phase = phaseFor(entry, index, count, config);
    const tag = host.nextSowTag();
    const sow = new Sow({
      id: tag,
      tag,
      birthDay: -(GILT_ENTRY_AGE_DAYS + parity * cycleDays + phase),
      weightKg: Math.min(MATURE_SOW_WEIGHT_KG + parity * 6, 250),
    });
    sow.parity = parity;

    if (entry.reproductiveState === "gestating") {
      sow.state = "gestating";
      sow.dueDay = Math.round(reproduction.gestationDays - phase);
    } else if (entry.reproductiveState === "lactating") {
      sow.state = "lactating";
      sow.weanDay = Math.round(
        reproduction.gestationDays + reproduction.weaningAgeDays - phase,
      );
      lactating.push(sow);
    } else {
      sow.state = "open";
      sow.nextServiceDay = Math.round(cycleDays - phase);
    }

    // What she is worth today, with the parities she has behind her already
    // reflected in it. `valuedAfter` is what stops the books writing her down a
    // second time for litters she reared before this plan opened.
    sow.breedingValue = entry.openingValuePerHead;
    sow.valuedAfter = parity;
    host.sows.push(sow);
  }
}

function placeBoars(host: StartingStockHost, entry: StartingBoarEntry): void {
  const count = headOf(entry);
  const servedDays = Math.round(Math.max(0, entry.monthsInService ?? 0) * DAYS_PER_MONTH);

  for (let index = 0; index < count; index += 1) {
    const tag = host.nextBoarTag();
    // He joined before the plan opened, and that is what his rotation is counted
    // from: a boar six months into a two-year working life has eighteen left.
    const joinedDay = -servedDays;
    const boar = new Boar({
      id: tag,
      tag,
      birthDay: joinedDay - BOAR_SERVICE_ENTRY_AGE_DAYS,
      joinedDay,
    });
    boar.breedingValue = entry.openingValuePerHead;
    boar.valuedAfter = servedDays;
    host.boars.push(boar);
  }
}

// -------------------------------------------------------------- growing stock

/** Where a starting group's opening value is booked on an animal's slate. */
function costStageOf(type: StartingPigEntry["type"]): CostStage {
  return type;
}

/**
 * Writes what a group is worth onto each animal in it.
 *
 * A market pig's book value is what has been spent on it and nothing else, so
 * its opening value is simply a line on its own slate: it rides along through
 * every move the animal makes, and on the day the pig is sold it is the first
 * line of what that sale cost. It is booked as a purchase because that is the
 * nearest true thing — the farm has the animal and this is what it stands at —
 * and against the stage the animal is in on day zero, so that a bill read
 * against a pig's age puts it where the animal actually was.
 */
function openAt(pig: GrowingPig, entry: StartingPigEntry): void {
  pig.costs.add("purchase", costStageOf(entry.type), entry.openingValuePerHead);
}

/** The weight range and daily gain of one growing stage. */
function stageSpan(
  config: PlannerConfig,
  stage: "weaner" | "grower" | "finisher",
): { startWeight: number; endWeight: number; dailyGain: number } {
  const { growth } = config;
  if (stage === "weaner") {
    return {
      startWeight: growth.weaningWeightKg,
      endWeight: growth.growerStartWeightKg,
      dailyGain: growth.weanerDailyGainKg,
    };
  }
  if (stage === "grower") {
    return {
      startWeight: growth.growerStartWeightKg,
      endWeight: growth.finisherStartWeightKg,
      dailyGain: growth.growerDailyGainKg,
    };
  }
  return {
    startWeight: growth.finisherStartWeightKg,
    endWeight: growth.saleWeightKg,
    dailyGain: growth.finisherDailyGainKg,
  };
}

/**
 * A pen of weaners, growers or finishers.
 *
 * With a weight given, every pig in the group starts at it: a pen bought or
 * weaned together is a cohort, and it moves on and is drawn together. With no
 * weight given the group is spread evenly through its stage, which is how
 * opening pigs have always been placed and keeps a plan that names no weights
 * looking like a farm rather than like one delivery.
 */
function placeGrowingPigs(
  host: StartingStockHost,
  entry: StartingPigEntry,
  stage: "weaner" | "grower" | "finisher",
): void {
  const count = headOf(entry);
  if (count === 0) return;
  const { config } = host;
  const { startWeight, endWeight, dailyGain } = stageSpan(config, stage);

  const placed: GrowingPig[] = [];
  for (let index = 0; index < count; index += 1) {
    const progress = count === 1 ? 0 : index / count;
    const weightKg =
      entry.averageWeightKg ?? startWeight + progress * (endWeight - startWeight);
    const daysInStage = Math.max(0, (weightKg - startWeight) / dailyGain);
    const ageDays =
      entry.averageAgeDays ??
      config.reproduction.weaningAgeDays +
        (startWeight - config.growth.weaningWeightKg) / config.growth.weanerDailyGainKg +
        daysInStage;
    const tag = host.nextPigTag();
    const pig = new GrowingPig({
      id: tag,
      tag,
      sex: host.variation.sex([tag]),
      birthDay: -Math.round(ageDays),
      weightKg,
      stage,
      ...host.growthDraw(tag),
    });
    pig.weanedOnDay = -Math.round(daysInStage);
    host.catchUpVaccinations(pig, 0);
    openAt(pig, entry);
    host.pigs.push(pig);
    placed.push(pig);
  }
  host.enterStage(placed, stage, 0);
  host.penCohort?.(placed, stage);
}

/**
 * Maiden gilts: females already close to service weight and already cycling.
 *
 * A farm does not buy in gilts that have never stood, so the heats they have
 * had are put behind them — they come to service on their own cycle rather than
 * starting one on the day the plan opens.
 */
function placeGilts(host: StartingStockHost, entry: StartingPigEntry): void {
  const count = headOf(entry);
  if (count === 0) return;
  const { config } = host;
  const { growth, herd, reproduction } = config;
  const serviceAge = expectedGiltServiceAgeDays(config);

  const placed: GrowingPig[] = [];
  for (let index = 0; index < count; index += 1) {
    const weightKg =
      entry.averageWeightKg ??
      Math.max(growth.saleWeightKg, herd.giltServiceWeightKg - 4 - (index % 6) * 4);
    const ageOnDayZero =
      entry.averageAgeDays ?? Math.round(serviceAge - 10 - (index % 6) * 8);
    const tag = host.nextPigTag();
    const gilt = new GrowingPig({
      id: tag,
      tag,
      sex: "female",
      birthDay: -ageOnDayZero,
      weightKg,
      stage: "gilt",
      ...host.growthDraw(tag),
    });
    gilt.destination = "breeding";
    gilt.weanedOnDay = -Math.max(0, Math.round(ageOnDayZero - reproduction.weaningAgeDays));
    const sincePuberty = ageOnDayZero - herd.giltPubertyAgeDays - gilt.estrusOffsetDays;
    if (sincePuberty >= 0) gilt.firstHeatDay = -sincePuberty;
    host.catchUpVaccinations(gilt, 0);
    openAt(gilt, entry);
    host.pigs.push(gilt);
    placed.push(gilt);
  }
  host.enterStage(placed, "gilt", 0);
}

/**
 * Suckling piglets, put onto the opening sows that are rearing a litter.
 *
 * Milk is paid for through the sow's lactation ration rather than by the head,
 * so a piglet on a sow is fed exactly as one farrowed here would be. A piglet on
 * no sow would be fed by nobody and would grow for nothing, which is why these
 * are spread across the lactating sows rather than left standing on their own —
 * and why a group entered with no lactating sow to go to is taken as just
 * weaned instead, at the weight it was entered at, and said so in the plan
 * warnings rather than quietly put right.
 */
function placePiglets(
  host: StartingStockHost,
  entry: StartingPigEntry,
  lactating: readonly Sow[],
): void {
  const count = headOf(entry);
  if (count === 0) return;
  const { config } = host;
  const { growth, reproduction } = config;
  const gainPerDay = (growth.weaningWeightKg - BIRTH_WEIGHT_KG) / reproduction.weaningAgeDays;

  const ageDays =
    entry.averageAgeDays ??
    (entry.averageWeightKg === undefined
      ? Math.round(reproduction.weaningAgeDays / 2)
      : Math.round(
          Math.min(
            reproduction.weaningAgeDays,
            Math.max(0, (entry.averageWeightKg - BIRTH_WEIGHT_KG) / gainPerDay),
          ),
        ));
  const weightKg = entry.averageWeightKg ?? BIRTH_WEIGHT_KG + gainPerDay * ageDays;

  const placed: GrowingPig[] = [];
  for (let index = 0; index < count; index += 1) {
    const dam = lactating.length > 0 ? lactating[index % lactating.length] : null;
    const tag = host.nextPigTag();
    const piglet = new GrowingPig({
      id: tag,
      tag,
      sex: host.variation.sex([tag]),
      birthDay: -ageDays,
      weightKg,
      stage: dam === null ? "weaner" : "piglet",
      generation: dam === null ? 0 : dam.generation + 1,
      damTag: dam?.tag ?? null,
      ...host.growthDraw(tag),
    });
    if (dam === null) {
      // Nothing to suckle them, so they stand in the weaner house from day one
      // — at the weight they were entered at, not at a weaning weight they
      // never reached.
      piglet.weanedOnDay = 0;
    } else {
      host.noteBirth(piglet.generation);
      dam.litter.push(piglet);
      // Her litter's age is what says when she weans it, and the row is better
      // evidence of that than the place she was given in her own cycle.
      dam.weanDay = Math.max(1, Math.round(reproduction.weaningAgeDays - ageDays));
    }
    host.catchUpVaccinations(piglet, 0);
    openAt(piglet, entry);
    host.pigs.push(piglet);
    placed.push(piglet);
  }
  // Booked for only the part of the stage still ahead of them.
  const stage = lactating.length > 0 ? "piglet" : "weaner";
  host.enterStage(placed, stage, 0);
  if (stage === "weaner") host.penCohort?.(placed, stage);
}
