import {
  BIRTH_WEIGHT_KG,
  BOAR_WEIGHT_KG,
  ESTRUS_CYCLE_DAYS,
  GILT_DAILY_GAIN_KG,
  IRREGULAR_RETURN_DAYS,
  MAINTENANCE_SHARE,
  MATURE_SOW_WEIGHT_KG,
  REGULAR_RETURN_DAYS,
  type PlannerConfig,
} from "../../config";
import { dailyFeedKg, maturityFactor } from "../../growth-curve";
import {
  sexFactor,
  type Destination,
  type FeedRation,
  type PigStage,
  type Sex,
  type SowState,
} from "../../sim/animals";
import { STORE_IDS, type StoreId } from "../../sim/haulage";
import {
  lactationDemandOf,
  pigletSupportFactor,
  potentialPigletGainKg,
  type LactationDemand,
} from "../../sim/lactation";
import { stageDurationDays, stageMortalityRate } from "../../sim/mortality";
import { placesOf } from "../housing";

/**
 * What the farm standing here this morning is going to want out of its stores.
 *
 * This is the half of the rolling planner that has nothing to do with lorries.
 * It answers one question — how many kilograms will each store be asked for on
 * each of the next N days — and it answers it from what a stockman can see by
 * walking the place: the animals that are here, what they weigh, which stage
 * they are in, which sows are in pig and when they are due, and the rates the
 * plan was drawn on.
 *
 * Three things it is deliberately not.
 *
 * It is not the simulation. It carries expected head — 9.4 piglets, 0.38 of a
 * sow in the farrowing house — because an expectation is what a forecast is.
 * The authoritative world goes on containing whole animals; nothing in here
 * touches it, and nothing in here is able to.
 *
 * It is not a Monte Carlo. There are no draws. The same farm and the same
 * configuration give the same curve every time, which is what lets today's
 * order be explained and re-derived tomorrow.
 *
 * And it is not clairvoyant. It may read the present — including the farm's own
 * calendar, because a due date written on a service card is present knowledge —
 * and it may not read the future: not the scheduled deaths, not the variation's
 * next draw, not a probe run. That boundary is enforced by what it is given: an
 * {@link ExpectedFarmState}, which is a copy of observable facts, rather than
 * the `World` those facts were read off.
 */

/** Kilograms below which a figure is noise rather than demand. */
const CRUMB_KG = 1e-9;

export type DemandForecast = Readonly<Record<StoreId, readonly number[]>>;

/** Where one slice of forecast demand came from, for the explanation. */
export type DemandForecastSource =
  | "breeding"
  | "growing"
  | "suckling"
  | "heating"
  | "bedding";

export type DemandForecastLine = {
  store: StoreId;
  source: DemandForecastSource;
  kg: number;
  note: string;
};

export type DemandForecastResult = {
  /** First day of the curve, which is always today. */
  fromDay: number;
  /** Last day it covers, inclusive. */
  throughDay: number;
  demandKg: DemandForecast;
  explanation: readonly DemandForecastLine[];
};

// ---------------------------------------------------------------- the context

/**
 * One group of growing pigs as the forecaster sees them: head, what they weigh,
 * where they are and where they are going. Pigs are grouped rather than copied —
 * a hundred weaners of the same age, sex and weight have one forecast between
 * them, which is the difference between a planner that runs in a millisecond and
 * one that clones five thousand animals every morning.
 */
export type ExpectedGrowingGroup = {
  head: number;
  stage: PigStage;
  destination: Destination;
  sex: Sex;
  weightKg: number;
  ageDays: number;
  /**
   * Mean observed thriftiness of the live pigs represented by this group.
   *
   * It is optional because expected future cohorts have no realised performance
   * yet, and tests/older callers may only describe visible stage and weight. A
   * missing value therefore means the population mean of 1, never a new draw.
   */
  growthFactor?: number;
  /**
   * Crates this group is standing in while it is still suckling. A heat lamp is
   * lit per crate and not per pig, so the count of them matters and the head
   * alone does not.
   */
  litters: number;
  /** The day the litter comes off the sow, where the farm already knows it. */
  weanDay: number | null;
};

/** A breeding female, or a group of them sharing a state and a calendar. */
export type ExpectedSowGroup = {
  head: number;
  weightKg: number;
  state: SowState;
  parity: number;
  /** Known due date for a sow already in pig. */
  dueDay: number | null;
  /** Known weaning date for a sow with a litter on her. */
  weanDay: number | null;
  /** Her next observable service opportunity. */
  nextServiceDay: number;
};

export type ExpectedBoarGroup = { head: number; weightKg: number };

/**
 * Everything the forecaster is allowed to know, copied out of the world once.
 *
 * Passing this rather than the `World` is the information boundary written in
 * code rather than in a comment: there is no route from here to a scheduled
 * death, a future random draw or a completed probe run, because none of them is
 * in the record.
 */
export type ExpectedFarmState = {
  day: number;
  growing: readonly ExpectedGrowingGroup[];
  sows: readonly ExpectedSowGroup[];
  boars: readonly ExpectedBoarGroup[];
};

// ------------------------------------------------------------- the arithmetic

/** Expected days a service that did not hold costs before she stands again. */
export function expectedReturnDays(config: PlannerConfig): number {
  const regular = (REGULAR_RETURN_DAYS.min + REGULAR_RETURN_DAYS.max) / 2;
  const irregular = (IRREGULAR_RETURN_DAYS.min + IRREGULAR_RETURN_DAYS.max) / 2;
  const share = config.reproduction.irregularReturnSharePct / 100;
  return regular * (1 - share) + irregular * share;
}

/**
 * The share of services that hold, blended across the channels the farm
 * actually uses. Semen bought in may conceive better or worse than the boar
 * team, and a plan putting half its services to AI should be forecast on half of
 * each rather than on whichever one the code happened to reach for.
 */
export function expectedConceptionRate(config: PlannerConfig): number {
  const natural = config.reproduction.farrowingSuccessPct / 100;
  if (!config.service.useAi) return natural;
  const ai = Math.min(
    1,
    Math.max(
      0,
      (config.reproduction.farrowingSuccessPct + config.service.aiConceptionDeltaPct) / 100,
    ),
  );
  const share = config.service.aiSharePct / 100;
  return natural * (1 - share) + ai * share;
}

/** Daily survival across a stage, so a group thins out as the stage goes on. */
function dailySurvival(stage: PigStage, config: PlannerConfig): number {
  const rate = Math.min(0.999, Math.max(0, stageMortalityRate(stage, config)));
  const days = Math.max(1, stageDurationDays(stage, config));
  return Math.pow(1 - rate, 1 / days);
}

/** The bin a growing pig of this stage draws its ration from. */
function rationFor(stage: PigStage): FeedRation {
  if (stage === "weaner") return "weaner";
  if (stage === "grower") return "grower";
  if (stage === "finisher") return "finisher";
  return "sow";
}

/** What a gilt on a restricted developer ration gets, scaled by her size. */
function giltRationKg(weightKg: number, config: PlannerConfig): number {
  const midWeightKg = (config.growth.saleWeightKg + config.herd.giltServiceWeightKg) / 2;
  const ratio = weightKg / Math.max(midWeightKg, 0.1);
  const scale = 1 - MAINTENANCE_SHARE + MAINTENANCE_SHARE * Math.pow(ratio, 0.75);
  return config.feed.gestationKgDay * scale;
}

/** The litter an expected lactating sow is carrying, as the ration needs it. */
type ExpectedLitter = { sucklers: number; creepKg: number; ageDays: number };

/**
 * What a breeding female of this weight eats in the state she is in.
 *
 * A lactating sow is fed for her litter and not for herself, so her ration is
 * asked of the same calculation the engine uses — `lib/sim/lactation` — rather
 * than of a flat figure. A forecast that went on predicting the flat ration
 * would under-order sow feed on exactly the farms this change is about: the
 * ones whose litters are trying to grow faster than the old number fed them.
 */
function sowRationKg(
  weightKg: number,
  state: SowState,
  config: PlannerConfig,
  litter: ExpectedLitter,
): number {
  if (state !== "lactating") {
    return config.feed.gestationKgDay * Math.pow(weightKg / MATURE_SOW_WEIGHT_KG, 0.75);
  }
  return expectedLactation(weightKg, litter, config).offeredKg;
}

/**
 * What the litter under a forecast sow is asking of her, and what she is
 * allowed to answer with.
 *
 * Both halves of that matter, and they are not the same number. The ration is
 * what the store has to hold; the gap between what she was asked for and what
 * the ration lets her give is what the litter does not grow. Reading them off
 * one calculation is what keeps the forecast's piglets the same size as the
 * engine's.
 */
function expectedLactation(
  weightKg: number,
  litter: ExpectedLitter,
  config: PlannerConfig,
): LactationDemand {
  return lactationDemandOf(
    {
      weightKg,
      sucklers: litter.sucklers,
      potentialGainKg:
        litter.sucklers * potentialPigletGainKg(config, litter.ageDays),
      creepOfferedKg: litter.creepKg,
    },
    config,
  );
}

/**
 * One cohort walking forward through the forecast: the growing group plus the
 * bookkeeping the walk needs. It is mutated freely because it is the
 * forecaster's own copy and nothing outside this function can see it.
 */
type Walker = {
  head: number;
  stage: PigStage;
  destination: Destination;
  sexFactor: number;
  growthFactor: number;
  weightKg: number;
  ageDays: number;
  litters: number;
  weanDay: number | null;
  survival: number;
};

/**
 * The share of its potential a litter coming off on this day can be milked to.
 *
 * Mass-weighted across the weight bands the forecaster carries the herd in,
 * because a gilt and a fourth-parity sow suckling litters that wean on the same
 * morning are allowed different amounts of feed. A litter whose dam is not in
 * the tracks — one already on the farm when the forecast opens, weaning before
 * any of the modelled sows farrow — is left at its potential, which is what the
 * observed farm handed over.
 */
function supportUnder(
  weanDay: number | null,
  support: ReadonlyMap<number, { weighted: number; mass: number }>,
): number {
  if (weanDay === null) return 1;
  const entry = support.get(weanDay);
  if (entry === undefined || entry.mass <= CRUMB_KG) return 1;
  return entry.weighted / entry.mass;
}

/** The day's potential gain for a growing cohort, on the plan's own rates. */
function expectedGainKg(walker: Walker, config: PlannerConfig): number {
  const { growth } = config;
  // The potential, which is what a forecast of demand wants: the sow has to be
  // offered the feed to milk it whether or not the store turns out to hold it.
  //
  // No thriftiness on a suckler, because there is none on a suckler in the
  // engine either: what a piglet puts on before weaning is how much milk it got
  // and not how well it converts. A factor here and not there would be the
  // ordering policy buying sow feed for a litter the farm is not feeding.
  if (walker.stage === "piglet") return potentialPigletGainKg(config, walker.ageDays);
  const maturity = maturityFactor(walker.weightKg, growth);
  if (walker.stage === "gilt") return GILT_DAILY_GAIN_KG * walker.growthFactor * maturity;
  const base =
    walker.stage === "weaner"
      ? growth.weanerDailyGainKg
      : walker.stage === "grower"
        ? growth.growerDailyGainKg
        : growth.finisherDailyGainKg;
  return base * walker.sexFactor * walker.growthFactor * maturity;
}

/**
 * The mean weight of each market cohort, by the age it is standing at.
 *
 * The farm does not sell a pig, it sells a pen: the draw goes when the group's
 * average is at weight, and until it does every pig in it is still being fed —
 * including the ones that got there first. Walkers are slices of those pens,
 * split by sex and by the thriftiness the farm has already observed, so asking
 * a slice whether it is heavy enough would retire the good half of a pen a
 * fortnight before the lorry comes and leave the forecast ordering for a
 * finishing house emptier than the one being fed.
 */
function marketCohortWeights(walkers: readonly Walker[]): Map<number, number> {
  const totals = new Map<number, { kg: number; head: number }>();
  for (const walker of walkers) {
    if (walker.head <= CRUMB_KG || walker.destination !== "market") continue;
    if (walker.stage === "piglet") continue;
    const entry = totals.get(walker.ageDays) ?? { kg: 0, head: 0 };
    entry.kg += walker.weightKg * walker.head;
    entry.head += walker.head;
    totals.set(walker.ageDays, entry);
  }
  const mean = new Map<number, number>();
  for (const [age, total] of totals) {
    if (total.head > CRUMB_KG) mean.set(age, total.kg / total.head);
  }
  return mean;
}

/** What the pen this walker is a slice of weighs, or its own weight alone. */
function cohortWeightKg(walker: Walker, cohorts: ReadonlyMap<number, number>): number {
  return cohorts.get(walker.ageDays) ?? walker.weightKg;
}

/** The legacy, unconstrained stage walk retained for 1.x projections. */
function advanceLegacyStage(
  walker: Walker,
  config: PlannerConfig,
  day: number,
  cohorts: ReadonlyMap<number, number>,
): void {
  const { growth } = config;
  if (walker.stage === "piglet") {
    if (walker.weanDay !== null && day >= walker.weanDay) {
      // Off at the weight it reached on its dam, not lifted to the reference.
      walker.stage = "weaner";
      walker.litters = 0;
      walker.weanDay = null;
      walker.survival = dailySurvival("weaner", config);
    }
    return;
  }
  if (walker.stage === "gilt") return;
  if (walker.destination === "breeding") {
    // She leaves the growing herd at selection weight and goes onto the
    // developer ration. Until she gets there she is a growing pig like the ones
    // she was picked out of, standing in the same houses and eating out of the
    // same bins — a replacement at 70 kg is on finisher feed, because that is
    // what the farm has in front of her.
    if (walker.weightKg >= growth.saleWeightKg) {
      walker.stage = "gilt";
      walker.survival = dailySurvival("gilt", config);
      return;
    }
  } else if (cohortWeightKg(walker, cohorts) >= growth.saleWeightKg) {
    // A market pig leaves on the day its cohort reaches sale weight. What the
    // farm does about a full finishing house is the farm's business; the demand
    // this cohort stands for stops either way.
    walker.head = 0;
    return;
  }
  const earned: PigStage =
    walker.weightKg >= growth.finisherStartWeightKg
      ? "finisher"
      : walker.weightKg >= growth.growerStartWeightKg
        ? "grower"
        : "weaner";
  if (earned !== walker.stage) {
    walker.stage = earned;
    walker.survival = dailySurvival(earned, config);
  }
}

type GrowingRoom = "weaner" | "grower" | "finisher";

const NEXT_GROWING_ROOM: Partial<Record<PigStage, GrowingRoom>> = {
  weaner: "grower",
  grower: "finisher",
};

function growingOccupancy(walkers: readonly Walker[]): Record<GrowingRoom, number> {
  const occupancy: Record<GrowingRoom, number> = { weaner: 0, grower: 0, finisher: 0 };
  for (const walker of walkers) {
    if (walker.head <= CRUMB_KG) continue;
    if (walker.stage === "weaner" || walker.stage === "grower" || walker.stage === "finisher") {
      occupancy[walker.stage] += walker.head;
    }
  }
  return occupancy;
}

function crowdingGainFactor(
  stage: PigStage,
  occupancy: Readonly<Record<GrowingRoom, number>>,
  config: PlannerConfig,
  /**
   * The places each room has, read once by the caller.
   *
   * Passed in rather than looked up, because this is asked once a walker once a
   * day over the whole forecast horizon — and the lookup is no longer a field
   * read. A plan with physical housing has its places counted off its pens, and
   * counting them a hundred thousand times to answer the same question is the
   * whole cost of a forecast on a farm that enforces its capacity.
   */
  rooms: Readonly<Record<GrowingRoom, number>>,
): number {
  if (!config.housing.enforceCapacity) return 1;
  if (stage !== "weaner" && stage !== "grower" && stage !== "finisher") return 1;
  const places = Math.max(1, rooms[stage]);
  const excess = Math.max(0, occupancy[stage] / places - 1);
  return Math.max(0.2, 1 - (config.housing.crowdingGainPenaltyPct / 100) * excess);
}

/**
 * Moves expected head through the constrained growing houses after the day's
 * gain. A cohort may split fractionally because this is an expectation, but no
 * share skips a house. Pigs at sale weight leave only from the finisher house.
 */
function advanceConstrainedHousing(walkers: Walker[], config: PlannerConfig): void {
  const occupancy = growingOccupancy(walkers);
  const rooms = placesOf(config);
  const places: Record<GrowingRoom, number> = {
    weaner: rooms.weaner,
    grower: rooms.grower,
    finisher: rooms.finisher,
  };

  // A selected replacement leaves the growing accommodation when she reaches
  // the plan's selection exit weight. She does not consume a downstream place.
  for (const walker of walkers) {
    if (
      walker.head > CRUMB_KG &&
      walker.destination === "breeding" &&
      walker.stage !== "piglet" &&
      walker.stage !== "gilt" &&
      walker.weightKg >= config.growth.saleWeightKg
    ) {
      occupancy[walker.stage] -= walker.head;
      walker.stage = "gilt";
      walker.survival = dailySurvival("gilt", config);
    }
  }

  // Downstream first: head moving out of the grower house can release places
  // for weaners on the same stock round. A moved share is not visited again, so
  // it can advance only one house per day just as an actual batch does.
  for (const from of ["grower", "weaner"] as const) {
    const to = NEXT_GROWING_ROOM[from];
    if (!to) continue;
    const candidates = walkers.filter((walker) => {
      if (walker.head <= CRUMB_KG || walker.stage !== from) return false;
      const threshold =
        from === "weaner"
          ? config.growth.growerStartWeightKg
          : config.growth.finisherStartWeightKg;
      return walker.weightKg >= threshold;
    });
    for (const walker of candidates) {
      const free = Math.max(0, places[to] - occupancy[to]);
      const moving = Math.min(walker.head, free);
      if (moving <= CRUMB_KG) continue;
      const moved: Walker = {
        ...walker,
        head: moving,
        stage: to,
        survival: dailySurvival(to, config),
      };
      walker.head -= moving;
      occupancy[from] -= moving;
      occupancy[to] += moving;
      walkers.push(moved);
    }
  }

  // The draw goes when the pen's average is at weight, not when the best pig in
  // it is, so the cohort is weighed after the day's moves and released whole.
  const cohorts = marketCohortWeights(walkers);
  for (const walker of walkers) {
    if (
      walker.head > CRUMB_KG &&
      walker.stage === "finisher" &&
      walker.destination === "market" &&
      cohortWeightKg(walker, cohorts) >= config.growth.saleWeightKg
    ) {
      walker.head = 0;
    }
  }
}

/** One state a share of the breeding herd can be in, and the date that moves it. */
type SowMass = { state: SowState; keyDay: number; parity: number; mass: number };

function massKey(entry: SowMass): string {
  return entry.state + ":" + entry.keyDay + ":" + entry.parity;
}

/**
 * Forecasts expected consumption, store by store and day by day.
 *
 * `throughDay` is inclusive: the curve runs from today to that day, which is
 * what the coverage arithmetic in {@link ./procurement} indexes into.
 */
export function forecastDemand(
  farm: ExpectedFarmState,
  config: PlannerConfig,
  throughDay: number,
): DemandForecastResult {
  const fromDay = farm.day;
  const days = Math.max(0, throughDay - fromDay + 1);
  const demandKg = Object.fromEntries(
    STORE_IDS.map((store) => [store, new Array<number>(days).fill(0)]),
  ) as Record<StoreId, number[]>;

  const totals = new Map<string, DemandForecastLine>();
  const note = (store: StoreId, source: DemandForecastSource, kg: number, text: string) => {
    if (kg <= CRUMB_KG) return;
    const key = store + "/" + source;
    const line = totals.get(key);
    if (line) line.kg += kg;
    else totals.set(key, { store, source, kg, note: text });
  };

  const { health, housing, feed, reproduction, herd } = config;
  // The rooms, read once for the whole forecast rather than once a walker a day.
  const places = placesOf(config);
  const perLamp = Math.max(health.pigletsPerHeater, 1);
  const heating = health.heatedUntilAgeDays > 0 && health.gasKgPerHeaterDay > 0;
  const conception = expectedConceptionRate(config);
  const detection = reproduction.enforceEstrusWindows
    ? reproduction.heatDetectionPct / 100
    : 1;
  const returnDays = Math.round(expectedReturnDays(config));
  const gestationDays = Math.round(reproduction.gestationDays);
  const weaningAgeDays = Math.round(reproduction.weaningAgeDays);
  const pigletSurvival = dailySurvival("piglet", config);

  /**
   * The litter under a lactating sow, from her own calendar rather than from
   * the growing groups.
   *
   * Her ration is worked out from what her litter is trying to grow, so the
   * forecast has to know what is under her on the morning she is fed — and on
   * the morning she farrows her litter does not yet exist as a group. Her
   * weaning date says how far through lactation she is, which is all this
   * needs: how many are still on her, and whether they are old enough to be
   * picking at the creep feeder.
   */
  const litterUnder = (
    weanDay: number,
    day: number,
    standing: ReadonlyMap<number, ExpectedLitter>,
  ): ExpectedLitter => {
    // The litter actually on her, where the farm can see one. A forecast that
    // decayed a litter smoothly while the farm lost whole piglets would order
    // sow feed for a herd slightly different from the one being fed, and the
    // difference lands in the largest store on the place.
    const known = standing.get(weanDay);
    if (known !== undefined) return known;

    // Nothing to see yet: she farrows this morning, and the litter joins the
    // growing groups behind her. What she will be nursing is the plan's own
    // litter, which is what the rest of this forecaster runs on.
    const ageDays = Math.min(weaningAgeDays, Math.max(0, weaningAgeDays - (weanDay - day)));
    const sucklers = reproduction.bornAlivePerLitter * Math.pow(pigletSurvival, ageDays);
    return {
      sucklers,
      creepKg: ageDays >= feed.creepStartAgeDays ? sucklers * feed.creepKgPerPigDay : 0,
      ageDays,
    };
  };
  const weanToServiceDays = Math.max(1, Math.round(reproduction.weanToServiceDays));
  const sowDailySurvival = Math.pow(Math.max(0, 1 - herd.sowAnnualMortalityPct / 100), 1 / 365);

  // ---- the growing herd, and the litters it has not had yet ----------------
  //
  // Expected litters walk through exactly the same code as the pigs already
  // standing here. A piglet the farm has not had yet eats creep feed on the day
  // it is old enough to and weaner feed three weeks later, and there is no
  // reason for the forecaster to have two ways of saying so.
  const walkers: Walker[] = farm.growing.map((group) => ({
    head: group.head,
    stage: group.stage,
    destination: group.destination,
    sexFactor: sexFactor(group.sex),
    // Existing pigs carry the performance the farm has already observed. This
    // is present-state information, not a peek at a future random draw.
    growthFactor: group.growthFactor ?? 1,
    weightKg: group.weightKg,
    ageDays: group.ageDays,
    litters: group.litters,
    weanDay: group.weanDay,
    survival: dailySurvival(group.stage, config),
  }));

  /** Cohorts that join partway through, keyed by the day they are born. */
  const arrivals = new Map<number, Walker[]>();
  const expectLitter = (bornDay: number, litters: number) => {
    const head = litters * reproduction.bornAlivePerLitter;
    if (head <= CRUMB_KG) return;
    const walker: Walker = {
      head,
      stage: "piglet",
      destination: "market",
      // A litter is half of each sex, so the mean of the two factors is right
      // for the cohort even though it is right for none of the pigs in it.
      sexFactor: (sexFactor("male") + sexFactor("female")) / 2,
      // A litter that has not been born has no realised thriftiness to observe.
      growthFactor: 1,
      weightKg: BIRTH_WEIGHT_KG,
      ageDays: 0,
      litters,
      weanDay: bornDay + weaningAgeDays,
      survival: dailySurvival("piglet", config),
    };
    const waiting = arrivals.get(bornDay);
    if (waiting) waiting.push(walker);
    else arrivals.set(bornDay, [walker]);
  };

  // ---- the breeding herd ---------------------------------------------------
  //
  // A sow is not forecast as a sow but as a distribution over the states she
  // could be in. She is in pig or she is not; a service is seen or it is not,
  // and it holds or it does not. Carrying the shares rather than branching keeps
  // the whole herd's reproduction inside one small table per group, and it is
  // what lets services due inside the horizon contribute the litters they are
  // expected to produce rather than all of them or none of them.
  type SowTrack = { weightKg: number; masses: SowMass[] };
  const tracks: SowTrack[] = farm.sows.map((group) => ({
    weightKg: group.weightKg,
    masses: [
      {
        state: group.state,
        keyDay:
          group.state === "gestating"
            ? (group.dueDay ?? fromDay + gestationDays)
            : group.state === "lactating"
              ? (group.weanDay ?? fromDay + weaningAgeDays)
              : group.nextServiceDay,
        parity: group.parity,
        mass: group.head,
      },
    ],
  }));

  let boarHead = farm.boars.reduce((head, group) => head + group.head, 0);
  const boarRationKg = farm.boars.reduce(
    (kg, group) =>
      kg + group.head * feed.boarKgDay * Math.pow(group.weightKg / BOAR_WEIGHT_KG, 0.75),
    0,
  );
  const boarRationPerHead = boarHead > CRUMB_KG ? boarRationKg / boarHead : 0;

  for (let index = 0; index < days; index += 1) {
    const day = fromDay + index;
    let headOnFarm = 0;
    let crateLamps = 0;
    let heatedInPens = 0;

    // ---- the litters standing on the farm this morning ----------------------
    // Gathered by the day they come off, which is the one thing a sow and her
    // litter agree on: it is on her card and on theirs. A sow's ration follows
    // the litter under her, so the litters have to be counted before the sows
    // are fed — the same order the engine runs the two in.
    const standing = new Map<number, ExpectedLitter>();
    for (const walker of walkers) {
      if (walker.stage !== "piglet" || walker.weanDay === null || walker.head <= CRUMB_KG) continue;
      const already = standing.get(walker.weanDay) ?? {
        sucklers: 0,
        creepKg: 0,
        ageDays: walker.ageDays,
      };
      const litters = Math.max(1, walker.litters);
      already.sucklers += walker.head / litters;
      if (walker.ageDays >= feed.creepStartAgeDays) {
        already.creepKg += (walker.head / litters) * feed.creepKgPerPigDay;
      }
      standing.set(walker.weanDay, already);
    }

    // What share of what those litters wanted their dams will be able to milk,
    // filled in as the sows are fed and read back when the litters grow. A
    // litter on a sow whose ration is capped below what it asked for grows by
    // that share and no more, which is the whole point of this change — and a
    // forecast that skipped it would walk heavier pigs forward than the farm
    // will have, order for them, and be short of the feed the real ones want.
    const support = new Map<number, { weighted: number; mass: number }>();

    // ---- the breeding herd -------------------------------------------------
    for (const track of tracks) {
      const next = new Map<string, SowMass>();
      const carry = (entry: SowMass) => {
        if (entry.mass <= CRUMB_KG) return;
        const key = massKey(entry);
        const already = next.get(key);
        if (already) already.mass += entry.mass;
        else next.set(key, entry);
      };

      for (const entry of track.masses) {
        if (entry.mass <= CRUMB_KG) continue;
        headOnFarm += entry.mass;
        const alive = entry.mass * sowDailySurvival;
        // What she is today, settled before she is fed. A sow farrows in the
        // morning and eats a lactation ration that afternoon, and the engine
        // runs reproduction before nutrition for exactly that reason — so the
        // forecast has to move her first too, or every farrowing on the farm
        // buys its sow feed a day late.
        let state = entry.state;

        if (entry.state === "gestating" && day >= entry.keyDay) {
          state = "lactating";
          expectLitter(day, alive * (1 - reproduction.pregnancyLossPct / 100));
          carry({
            state: "lactating",
            keyDay: day + weaningAgeDays,
            parity: entry.parity + 1,
            mass: alive,
          });
        } else if (entry.state === "lactating" && day >= entry.keyDay) {
          state = "open";
          carry({
            state: "open",
            keyDay: day + weanToServiceDays,
            parity: entry.parity,
            mass: alive,
          });
        } else if (entry.state === "open" && day >= entry.keyDay) {
          if (entry.parity < herd.cullAfterParity) {
            // A heat nobody sees is a cycle gone, so detection shifts expected
            // service timing rather than being folded into the hold rate. Every
            // outcome of the morning eats the same ration this evening, which is
            // why the split does not touch what she is charged for today.
            const seen = alive * detection;
            const unseen = alive - seen;
            carry({
              state: "gestating",
              keyDay: day + gestationDays,
              parity: entry.parity,
              mass: seen * conception,
            });
            carry({
              state: "open",
              keyDay: day + returnDays,
              parity: entry.parity,
              mass: seen * (1 - conception),
            });
            carry({
              state: "open",
              keyDay: day + ESTRUS_CYCLE_DAYS,
              parity: entry.parity,
              mass: unseen,
            });
          }
          // Otherwise she is culled: her last litter is weaned and she goes, and
          // what replaces her is already in the growing groups as a gilt.
        } else {
          carry({ ...entry, mass: alive });
        }

        // A sow that farrowed this morning is nursing today's litter, and her
        // new weaning date is a day old; one already lactating carries hers on
        // the entry. Either way the ration follows the litter under her.
        const weanDay = entry.state === "lactating" ? entry.keyDay : day + weaningAgeDays;
        let kg: number;
        if (state === "lactating") {
          const demand = expectedLactation(track.weightKg, litterUnder(weanDay, day, standing), config);
          kg = entry.mass * demand.offeredKg;
          // The forecast is of a farm whose stores hold what it ordered, so the
          // only thing that can hold her litter back here is the ration itself.
          const share = pigletSupportFactor(demand, demand.offeredKg, demand.creepOfferedKg, config);
          const already = support.get(weanDay) ?? { weighted: 0, mass: 0 };
          already.weighted += share * entry.mass;
          already.mass += entry.mass;
          support.set(weanDay, already);
        } else {
          kg =
            entry.mass *
            sowRationKg(track.weightKg, state, config, {
              sucklers: 0,
              creepKg: 0,
              ageDays: 0,
            });
        }
        demandKg.sow[index] += kg;
        note("sow", "breeding", kg, "the breeding females standing on the farm");
      }
      track.masses = [...next.values()];
    }

    // ---- boars -------------------------------------------------------------
    if (boarHead > CRUMB_KG) {
      headOnFarm += boarHead;
      const kg = boarHead * boarRationPerHead;
      demandKg.sow[index] += kg;
      note("sow", "breeding", kg, "the working boars");
      boarHead *= sowDailySurvival;
    }

    // A litter farrowed this morning is fed this morning, so the breeding herd
    // is stepped before the growing one and the day's new cohorts are taken up
    // between the two. Reading them before the sows had farrowed would drop the
    // one cohort whose arrival the planner most needs to see coming.
    const joining = arrivals.get(day);
    if (joining) {
      for (const walker of joining) walkers.push(walker);
      arrivals.delete(day);
    }

    // ---- growing pigs ------------------------------------------------------
    // Weaning is unavoidable and may overflow the weaner house. All other
    // moves are requested after feeding and growth, when their destination has
    // a known free-place count.
    if (housing.enforceCapacity) {
      for (const walker of walkers) {
        if (
          walker.head > CRUMB_KG &&
          walker.stage === "piglet" &&
          walker.weanDay !== null &&
          day >= walker.weanDay
        ) {
          // Off at the weight it reached on its dam, not lifted to the reference.
          walker.stage = "weaner";
          walker.litters = 0;
          walker.weanDay = null;
          walker.survival = dailySurvival("weaner", config);
        }
      }
    }
    const occupancy = growingOccupancy(walkers);
    const cohorts = marketCohortWeights(walkers);
    for (const walker of walkers) {
      if (walker.head <= CRUMB_KG) continue;
      if (!housing.enforceCapacity) advanceLegacyStage(walker, config, day, cohorts);
      if (walker.head <= CRUMB_KG) continue;

      headOnFarm += walker.head;

      if (walker.stage === "piglet") {
        if (walker.ageDays >= feed.creepStartAgeDays) {
          const kg = walker.head * feed.creepKgPerPigDay;
          demandKg.creep[index] += kg;
          note("creep", "suckling", kg, "creep offered to piglets still on the sow");
        }
      } else if (walker.stage === "gilt") {
        const kg = walker.head * giltRationKg(walker.weightKg, config);
        demandKg.sow[index] += kg;
        note("sow", "growing", kg, "replacement gilts on the developer ration");
      } else {
        const gain = expectedGainKg(walker, config);
        const kg = walker.head * dailyFeedKg(walker.weightKg, gain, config.growth);
        const ration = rationFor(walker.stage);
        demandKg[ration][index] += kg;
        note(ration, "growing", kg, "growing pigs: upkeep and the day's gain");
      }

      if (heating && walker.ageDays < health.heatedUntilAgeDays) {
        if (walker.stage === "piglet" && walker.litters > CRUMB_KG) {
          // A suckler is in its dam's crate and cannot share a lamp with the
          // crate next door, so every litter lights at least one of its own.
          crateLamps += walker.litters * Math.ceil(walker.head / walker.litters / perLamp);
        } else {
          heatedInPens += walker.head;
        }
      }

      // Potential is what the stores were asked to cover; what the animal
      // actually puts on is potential less whatever it went without. For a
      // suckler that is its dam's ration, worked out when she was fed a few
      // lines above; for everything else it is the pen it is standing in.
      const gain =
        expectedGainKg(walker, config) *
        crowdingGainFactor(walker.stage, occupancy, config, places) *
        (walker.stage === "piglet" ? supportUnder(walker.weanDay, support) : 1);
      walker.weightKg += gain;
      walker.ageDays += 1;
      walker.head *= walker.survival;
    }
    if (housing.enforceCapacity) advanceConstrainedHousing(walkers, config);

    // ---- gas and bedding ---------------------------------------------------
    if (heating && (crateLamps > 0 || heatedInPens > CRUMB_KG)) {
      const lamps = crateLamps + Math.ceil(heatedInPens / perLamp);
      const kg = lamps * health.gasKgPerHeaterDay;
      demandKg.gas[index] += kg;
      note("gas", "heating", kg, "heat lamps over piglets young enough to want them");
    }
    if (housing.beddingKgPerHeadDay > 0 && headOnFarm > CRUMB_KG) {
      const kg = headOnFarm * housing.beddingKgPerHeadDay;
      demandKg.bedding[index] += kg;
      note("bedding", "bedding", kg, "every head housed on the farm");
    }
  }

  const explanation = [...totals.values()].sort(
    (a, b) => STORE_IDS.indexOf(a.store) - STORE_IDS.indexOf(b.store) || b.kg - a.kg,
  );
  return { fromDay, throughDay, demandKg, explanation };
}
