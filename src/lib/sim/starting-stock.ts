import {
  BIRTH_WEIGHT_KG,
  DAYS_PER_MONTH,
  MATURE_SOW_WEIGHT_KG,
  STARTING_PIG_TYPES,
  type PlannerConfig,
  type StartingBoarEntry,
  type StartingPigEntry,
  type StartingPigType,
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
 * from a farm that is not this one. So a plan describes what it actually has,
 * one animal at a time, each with the value its owner puts on it.
 *
 * Three things are asked of every animal alike — what it is, what it is worth,
 * and how old it is — and age does the work a weight used to: it says what a
 * pig weighs and how far through its stage it stands, in units a farmer has on
 * a card on the pen.
 *
 * Age is biology and stops there. A sow is asked separately for her parity and
 * where she stands in her cycle, and a boar for the months he has worked,
 * because none of that can be read off a birthday: a three-year-old sow may be
 * parity 2 or parity 6, open or carrying, and a boar of the same age may have
 * eighteen months of service behind him or none. Those facts decide when she
 * farrows, when she is culled, what is left to write off him, and when he is
 * rotated out — so they are asked for rather than inferred.
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
  /** Books an animal onto the mortality slate for the stage it is standing in. */
  enterStage(pigs: readonly GrowingPig[], stage: PigStage, day: number): void;
  /** Counts a piglet suckling on an opening sow, which the herd tables read. */
  noteBirth(generation: number): void;
  /**
   * Pens a group, for the engine that has pens. 2.0 moves and sells a batch
   * rather than an animal, so the animals placed in one stage here are penned
   * together there; 1.x has nothing to pen and leaves this out.
   */
  penCohort?(pigs: readonly GrowingPig[], stage: PigStage): void;
};

function isSowEntry(entry: StartingStockEntry): entry is StartingSowEntry {
  return entry.type === "sow";
}

function isBoarEntry(entry: StartingStockEntry): entry is StartingBoarEntry {
  return entry.type === "boar";
}

function isPigEntry(entry: StartingStockEntry): entry is StartingPigEntry {
  return entry.type !== "sow" && entry.type !== "boar";
}

/**
 * Piglets entered with no sow to suckle them, if any.
 *
 * Read by the plan warnings as well as by the seeding, so that what the farm
 * does about it is said on screen rather than only done.
 */
export function orphanStartingPiglets(config: PlannerConfig): number {
  const entries = config.stock.starting;
  const piglets = entries.filter((entry) => entry.type === "piglet").length;
  if (piglets === 0) return 0;
  const suckling = entries.filter(
    (entry) => isSowEntry(entry) && entry.reproductiveState === "lactating",
  ).length;
  return suckling > 0 ? 0 : piglets;
}

/** What the whole of the opening stock is worth: every animal, counted out. */
export function openingStockValue(config: PlannerConfig): number {
  return config.stock.starting.reduce((total, entry) => total + entry.openingValue, 0);
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

/** The name of one animal of a kind, for a card or a line of a list. */
export const STARTING_STOCK_NAMES: Record<StartingStockEntry["type"], string> = {
  piglet: "Piglet",
  weaner: "Weaner",
  grower: "Grower",
  finisher: "Finisher",
  gilt: "Maiden gilt",
  sow: "Breeding sow",
  boar: "Boar",
};

/**
 * Places every animal the plan was given, in one settled order.
 *
 * Sows before boars before pigs, and the pigs youngest stage first, which is
 * the order the plain head counts are placed in. The order is what settles the
 * tags, and every draw is keyed to a tag, so it is fixed here rather than left
 * to however the animals happen to be sorted on screen.
 */
export function seedStartingStock(host: StartingStockHost): void {
  const entries = host.config.stock.starting;

  // Sows of one state are spread across the part of the cycle that state covers,
  // so a herd of gestating sows farrows across the weeks rather than all on one
  // day. A sow who said where in her state she is takes no part in the spread.
  const sows = entries.filter(isSowEntry);
  const placedOfState = new Map<StartingSowEntry["reproductiveState"], number>();
  const ofState = (state: StartingSowEntry["reproductiveState"]) =>
    sows.filter((entry) => entry.reproductiveState === state).length;
  const lactating: LactatingSow[] = [];
  for (const entry of sows) {
    const index = placedOfState.get(entry.reproductiveState) ?? 0;
    placedOfState.set(entry.reproductiveState, index + 1);
    placeSow(host, entry, index, ofState(entry.reproductiveState), lactating);
  }
  for (const entry of entries.filter(isBoarEntry)) placeBoar(host, entry);

  const pigs = entries.filter(isPigEntry);
  for (const type of STARTING_PIG_TYPES) {
    const ofType = pigs.filter((candidate) => candidate.type === type);
    if (ofType.length === 0) continue;
    if (type === "gilt") placeGilts(host, ofType);
    else if (type === "piglet") placePiglets(host, ofType, lactating);
    else placeGrowingPigs(host, ofType, type);
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

/** A sow suckling on day one, and whether she said herself when she weans. */
type LactatingSow = { sow: Sow; statedTiming: boolean };

/**
 * How far through her cycle a starting sow is, counted from her last service.
 *
 * A sow who said where she is in her state is taken at her word: days pregnant
 * is days since service, and days since farrowing is that much past the end of
 * gestation. A sow who did not is spread evenly across the part of the cycle
 * her state covers, along with the others in the same state — so three
 * gestating sows are three farrowings on three days rather than one crowd on
 * one, and a plan that says the same thing twice gets the same farm.
 */
function phaseFor(
  entry: StartingSowEntry,
  index: number,
  count: number,
  config: PlannerConfig,
): number {
  const { reproduction } = config;
  const within = (span: number) => (count <= 1 ? 0 : Math.floor((index * span) / count));
  if (entry.reproductiveState === "gestating") {
    const stated = entry.daysPregnant;
    return stated === undefined
      ? within(reproduction.gestationDays)
      : Math.min(stated, reproduction.gestationDays);
  }
  if (entry.reproductiveState === "lactating") {
    const stated = entry.daysSinceFarrowing;
    const into =
      stated === undefined
        ? within(reproduction.weaningAgeDays)
        : Math.min(stated, reproduction.weaningAgeDays);
    return reproduction.gestationDays + into;
  }
  return (
    reproduction.gestationDays +
    reproduction.weaningAgeDays +
    within(reproduction.weanToServiceDays)
  );
}

function placeSow(
  host: StartingStockHost,
  entry: StartingSowEntry,
  index: number,
  count: number,
  lactating: LactatingSow[],
): void {
  const { config } = host;
  const { reproduction } = config;
  const cycleDays = cycleDaysOf(config);
  const phase = phaseFor(entry, index, count, config);
  // A sow suckling a litter has reared at least one, whatever the entry says.
  const parity =
    entry.reproductiveState === "lactating" ? Math.max(1, entry.parity) : entry.parity;

  const tag = host.nextSowTag();
  const sow = new Sow({
    id: tag,
    tag,
    // Her age is her age. It used to be built out of her parity because there
    // was nothing else to build it from; now she is asked, and the two facts
    // are kept apart — a parity-6 sow of four years and one of two years are
    // both farms that exist.
    birthDay: -Math.round(entry.ageDays),
    weightKg: Math.min(MATURE_SOW_WEIGHT_KG + parity * 6, 250),
  });
  sow.parity = parity;

  if (entry.reproductiveState === "gestating") {
    sow.state = "gestating";
    sow.dueDay = Math.round(reproduction.gestationDays - phase);
  } else if (entry.reproductiveState === "lactating") {
    sow.state = "lactating";
    sow.weanDay = Math.round(reproduction.gestationDays + reproduction.weaningAgeDays - phase);
    lactating.push({ sow, statedTiming: entry.daysSinceFarrowing !== undefined });
  } else {
    sow.state = "open";
    sow.nextServiceDay = Math.round(cycleDays - phase);
  }

  // What she is worth today, with the parities she has behind her already
  // reflected in it. `valuedAfter` is what stops the books writing her down a
  // second time for litters she reared before this plan opened.
  sow.breedingValue = entry.openingValue;
  sow.valuedAfter = parity;
  host.sows.push(sow);
}

function placeBoar(host: StartingStockHost, entry: StartingBoarEntry): void {
  const tag = host.nextBoarTag();
  const servedDays = Math.round(Math.max(0, entry.monthsInService) * DAYS_PER_MONTH);
  // Two different facts, kept apart: he is as old as he was entered, and he
  // joined the team however long ago he was put to work. The rotation and the
  // write-off are counted from the joining — a boar six months into a two-year
  // working life has eighteen left, whatever his birthday says.
  const boar = new Boar({
    id: tag,
    tag,
    birthDay: -Math.round(entry.ageDays),
    joinedDay: -servedDays,
  });
  boar.breedingValue = entry.openingValue;
  boar.valuedAfter = servedDays;
  host.boars.push(boar);
}

// -------------------------------------------------------------- growing stock

/** Where a starting animal's opening value is booked on its own slate. */
function costStageOf(type: StartingPigType): CostStage {
  return type;
}

/**
 * Writes what an animal is worth onto its slate.
 *
 * A market pig's book value is what has been spent on it and nothing else, so
 * its opening value is simply a line on its own slate: it rides along through
 * every move the animal makes, and on the day the pig is sold it is the first
 * line of what that sale cost. It is booked as a purchase because that is the
 * nearest true thing — the farm has the animal and this is what it stands at —
 * and against the stage the animal is in on day zero, so that a bill read
 * against a pig's age puts it where the animal actually was.
 */
function openAt(pig: GrowingPig, entry: StartingStockEntry): void {
  pig.costs.add("purchase", costStageOf(entry.type as StartingPigType), entry.openingValue);
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

/** The age a pig growing as this plan says reaches the bottom of a stage at. */
function stageEntryAgeDays(
  config: PlannerConfig,
  stage: "weaner" | "grower" | "finisher",
): number {
  const { growth, reproduction } = config;
  const weanerDays =
    (growth.growerStartWeightKg - growth.weaningWeightKg) / growth.weanerDailyGainKg;
  const growerDays =
    (growth.finisherStartWeightKg - growth.growerStartWeightKg) / growth.growerDailyGainKg;
  if (stage === "weaner") return reproduction.weaningAgeDays;
  if (stage === "grower") return reproduction.weaningAgeDays + weanerDays;
  return reproduction.weaningAgeDays + weanerDays + growerDays;
}

/**
 * What a pig of this age weighs, held inside the stage it was entered as.
 *
 * The farmer said which house the animal is standing in and how old it is, and
 * where those two disagree the house is believed: a pig entered as a finisher
 * at sixty days is a small finisher rather than a weaner filed in the wrong
 * place. Age then says how far up the stage it has grown.
 */
function weightAtAge(
  config: PlannerConfig,
  stage: "weaner" | "grower" | "finisher",
  ageDays: number,
): number {
  const { startWeight, endWeight, dailyGain } = stageSpan(config, stage);
  const stageDays = dailyGain > 0 ? (endWeight - startWeight) / dailyGain : 0;
  const grown = Math.min(Math.max(ageDays - stageEntryAgeDays(config, stage), 0), stageDays);
  return startWeight + grown * dailyGain;
}

/**
 * Weaners, growers and finishers: one pig each, at the weight its age says.
 *
 * They are entered into their stage together because the mortality slate and
 * the pens of the 2.0 engine both work on a group standing in a house, and on
 * day zero every animal in one house is exactly that.
 */
function placeGrowingPigs(
  host: StartingStockHost,
  entries: readonly StartingStockEntry[],
  stage: "weaner" | "grower" | "finisher",
): void {
  const { config } = host;

  const placed: GrowingPig[] = [];
  for (const entry of entries) {
    const ageDays = Math.round(entry.ageDays);
    const weightKg = weightAtAge(config, stage, ageDays);
    const tag = host.nextPigTag();
    const pig = new GrowingPig({
      id: tag,
      tag,
      sex: host.variation.sex([tag]),
      birthDay: -ageDays,
      weightKg,
      stage,
      ...host.growthDraw(tag),
    });
    pig.weanedOnDay = -Math.max(0, ageDays - Math.round(config.reproduction.weaningAgeDays));
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
function placeGilts(host: StartingStockHost, entries: readonly StartingStockEntry[]): void {
  const { config } = host;
  const { growth, herd, reproduction } = config;

  const placed: GrowingPig[] = [];
  for (const entry of entries) {
    const ageOnDayZero = Math.round(entry.ageDays);
    // Past the finishing house she goes on gaining, and she is held at service
    // condition rather than grown through it while she waits for her heat.
    const grown = weightAtAge(config, "finisher", ageOnDayZero);
    const beyondSale = Math.max(0, ageOnDayZero - saleAgeDays(config));
    const weightKg = Math.min(
      grown + beyondSale * growth.finisherDailyGainKg,
      herd.giltServiceWeightKg,
    );
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

/** The age a pig growing as this plan says reaches its sale weight at. */
function saleAgeDays(config: PlannerConfig): number {
  const { growth } = config;
  return (
    stageEntryAgeDays(config, "finisher") +
    (growth.saleWeightKg - growth.finisherStartWeightKg) / growth.finisherDailyGainKg
  );
}

/**
 * Suckling piglets, put onto the opening sows that are rearing a litter.
 *
 * Milk is paid for through the sow's lactation ration rather than by the head,
 * so a piglet on a sow is fed exactly as one farrowed here would be. A piglet on
 * no sow would be fed by nobody and would grow for nothing, which is why these
 * are spread across the lactating sows rather than left standing on their own —
 * and why a piglet entered with no lactating sow to go to is taken as just
 * weaned instead, at the weight its age gives it, and said so in the plan
 * warnings rather than quietly put right.
 */
function placePiglets(
  host: StartingStockHost,
  entries: readonly StartingStockEntry[],
  lactating: readonly LactatingSow[],
): void {
  const { config } = host;
  const { growth, reproduction } = config;
  const gainPerDay = (growth.weaningWeightKg - BIRTH_WEIGHT_KG) / reproduction.weaningAgeDays;

  const placed: GrowingPig[] = [];
  entries.forEach((entry, index) => {
    const ageDays = Math.min(Math.round(entry.ageDays), Math.round(reproduction.weaningAgeDays));
    const weightKg = BIRTH_WEIGHT_KG + gainPerDay * ageDays;
    const nursing = lactating.length > 0 ? lactating[index % lactating.length] : null;
    const dam = nursing?.sow ?? null;
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
      // — at the weight their age gives them, not at a weaning weight they
      // never reached.
      piglet.weanedOnDay = 0;
    } else {
      host.noteBirth(piglet.generation);
      dam.litter.push(piglet);
      // Her litter's age is what says when she weans it — unless she said when
      // she farrowed, in which case she is the better evidence of the two and
      // the piglet does not overrule her.
      if (!nursing?.statedTiming) {
        dam.weanDay = Math.max(1, Math.round(reproduction.weaningAgeDays - ageDays));
      }
    }
    host.catchUpVaccinations(piglet, 0);
    openAt(piglet, entry);
    host.pigs.push(piglet);
    placed.push(piglet);
  });
  // Booked for only the part of the stage still ahead of them.
  const stage = lactating.length > 0 ? "piglet" : "weaner";
  host.enterStage(placed, stage, 0);
  if (stage === "weaner") host.penCohort?.(placed, stage);
}
