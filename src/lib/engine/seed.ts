import {
  ANCESTRY_EXCLUSION_DEPTH,
  BIRTH_WEIGHT_KG,
  GILT_ENTRY_AGE_DAYS,
  MATURE_SOW_WEIGHT_KG,
  expectedGiltServiceAgeDays,
} from "../config";
import { Boar, GrowingPig, Sow, type PigStage } from "../sim/animals";
import type { World } from "./world";

/**
 * Putting the opening herd on the farm.
 *
 * This is a faithful port of the 1.x setup and is meant to stay one: the two
 * engines have to start from the same farm or nothing downstream of them can be
 * compared. Every draw is taken in the same order for the same reason.
 */

/** Spread of individual thriftiness within a litter. */
export const GROWTH_FACTOR_DEVIATION = 0.07;
/** A gilt is served on her next standing heat, which recurs every 21 days. */
export const GILT_HEAT_WINDOW_DAYS = 21;
/** Opening age requested for a new, synchronised breeding herd. */
const SYNCHRONISED_START_AGE_DAYS = Math.round(7 * 30.4375);

/**
 * The sires standing behind a piglet of this dam: the boar or stud that got it,
 * then hers, cut off at the depth matings are barred to.
 */
export function sireLineFor(mother: Sow): string[] {
  const line = mother.lastSireTag === null ? [] : [mother.lastSireTag];
  return [...line, ...mother.sireLine].slice(0, ANCESTRY_EXCLUSION_DEPTH);
}

/** The name a bought-in stud line goes under. */
export function studTag(index: number): string {
  return "AI-" + String(index + 1).padStart(2, "0");
}

/**
 * Every pig is drawn its own thriftiness and its own first-heat timing, keyed to
 * its tag. They are traits rather than events, so the tag alone is the key: this
 * pig is this hardy in every plan that ever contains her.
 */
export function growthDraw(
  world: World,
  tag: string,
): { growthFactor: number; estrusOffsetDays: number } {
  return {
    growthFactor: world.variation.growthFactor(GROWTH_FACTOR_DEVIATION, [tag]),
    estrusOffsetDays: world.variation.estrusOffsetDays(GILT_HEAT_WINDOW_DAYS, [tag]),
  };
}

/** Marks a pig as already through the vaccinations its age has passed. */
export function catchUpVaccinations(world: World, pig: GrowingPig, day: number): void {
  const age = pig.ageDays(day);
  let given = 0;
  while (given < world.vaccinationSchedule.length && age >= world.vaccinationSchedule[given].ageDays) {
    given += 1;
  }
  pig.vaccinationsGiven = given;
}

export function createPiglet(
  world: World,
  mother: Sow,
  birthDay: number,
  weightKg: number,
): GrowingPig {
  const tag = world.nextPigTag();
  const piglet = new GrowingPig({
    id: tag,
    tag,
    sex: world.variation.sex([tag]),
    birthDay,
    weightKg,
    stage: "piglet",
    generation: mother.generation + 1,
    damTag: mother.tag,
    sireLine: sireLineFor(mother),
    ...growthDraw(world, tag),
  });
  world.noteBirth(piglet.generation);
  return piglet;
}

export function seedHerd(world: World): void {
  const { reproduction, growth, stock, herd } = world.config;
  const cycleDays =
    reproduction.gestationDays + reproduction.weaningAgeDays + reproduction.weanToServiceDays;
  const sowCount = Math.round(stock.sows);

  for (let i = 0; i < sowCount; i += 1) {
    const synchronised = herd.startMode === "synchronised";
    const phase = synchronised ? cycleDays : Math.floor((i * cycleDays) / sowCount);
    const parity = synchronised ? 0 : herd.cullAfterParity > 0 ? i % herd.cullAfterParity : 0;
    const tag = world.nextSowTag();
    const sow = new Sow({
      id: tag,
      tag,
      birthDay: synchronised
        ? -SYNCHRONISED_START_AGE_DAYS
        : -(GILT_ENTRY_AGE_DAYS + parity * cycleDays + phase),
      weightKg: Math.min(MATURE_SOW_WEIGHT_KG + parity * 6, 250),
    });
    sow.parity = parity;

    if (phase < reproduction.gestationDays) {
      sow.state = "gestating";
      sow.dueDay = Math.round(reproduction.gestationDays - phase);
    } else if (phase < reproduction.gestationDays + reproduction.weaningAgeDays) {
      const pigletAge = Math.round(phase - reproduction.gestationDays);
      sow.state = "lactating";
      sow.parity = Math.max(1, parity);
      sow.weanDay = Math.round(reproduction.gestationDays + reproduction.weaningAgeDays - phase);
      const litterSize = world.variation.litterSize(reproduction.bornAlivePerLitter, [
        sow.tag,
        "opening",
      ]);
      const gain = (growth.weaningWeightKg - BIRTH_WEIGHT_KG) / reproduction.weaningAgeDays;
      for (let p = 0; p < litterSize; p += 1) {
        const piglet = createPiglet(world, sow, -pigletAge, BIRTH_WEIGHT_KG + gain * pigletAge);
        catchUpVaccinations(world, piglet, 0);
        sow.litter.push(piglet);
        world.pigs.push(piglet);
      }
      world.mortality.enterStage(sow.litter, "piglet", 0);
    } else {
      sow.state = "open";
      sow.nextServiceDay = Math.round(cycleDays - phase);
    }
    world.sows.push(sow);
  }

  for (let i = 0; i < Math.round(stock.boars); i += 1) {
    const tag = world.nextBoarTag();
    world.boars.push(
      new Boar({
        id: tag,
        tag,
        birthDay:
          herd.startMode === "synchronised"
            ? -SYNCHRONISED_START_AGE_DAYS
            : -(GILT_ENTRY_AGE_DAYS + 60),
        joinedDay: 0,
      }),
    );
  }

  const startingGilts: GrowingPig[] = [];
  const serviceAge = expectedGiltServiceAgeDays(world.config);
  for (let i = 0; i < Math.round(stock.gilts); i += 1) {
    const tag = world.nextPigTag();
    const weightKg = Math.max(growth.saleWeightKg, herd.giltServiceWeightKg - 4 - (i % 6) * 4);
    const ageOnDayZero = Math.round(serviceAge - 10 - (i % 6) * 8);
    const gilt = new GrowingPig({
      id: tag,
      tag,
      sex: "female",
      birthDay: -ageOnDayZero,
      weightKg,
      stage: "gilt",
      ...growthDraw(world, tag),
    });
    gilt.destination = "breeding";
    gilt.weanedOnDay = -Math.round(serviceAge - 40);
    const sincePuberty = ageOnDayZero - herd.giltPubertyAgeDays - gilt.estrusOffsetDays;
    if (sincePuberty >= 0) gilt.firstHeatDay = -sincePuberty;
    catchUpVaccinations(world, gilt, 0);
    world.pigs.push(gilt);
    startingGilts.push(gilt);
  }
  world.mortality.enterStage(startingGilts, "gilt", 0);

  seedGrowingStock(world, "weaner", Math.round(stock.weaners));
  seedGrowingStock(world, "grower", Math.round(stock.growers));
  seedGrowingStock(world, "finisher", Math.round(stock.finishers));
}

/** Places starting pigs evenly through their stage rather than all on its first day. */
function seedGrowingStock(
  world: World,
  stage: Exclude<PigStage, "piglet" | "gilt">,
  count: number,
): void {
  if (count <= 0) return;
  const { growth, reproduction } = world.config;
  const startWeight =
    stage === "weaner"
      ? growth.weaningWeightKg
      : stage === "grower"
        ? growth.growerStartWeightKg
        : growth.finisherStartWeightKg;
  const endWeight =
    stage === "weaner"
      ? growth.growerStartWeightKg
      : stage === "grower"
        ? growth.finisherStartWeightKg
        : growth.saleWeightKg;
  const dailyGain =
    stage === "weaner"
      ? growth.weanerDailyGainKg
      : stage === "grower"
        ? growth.growerDailyGainKg
        : growth.finisherDailyGainKg;

  const placed: GrowingPig[] = [];
  for (let i = 0; i < count; i += 1) {
    const progress = count === 1 ? 0 : i / count;
    const weightKg = startWeight + progress * (endWeight - startWeight);
    const daysInStage = (weightKg - startWeight) / dailyGain;
    const ageDays =
      reproduction.weaningAgeDays +
      (startWeight - growth.weaningWeightKg) / growth.weanerDailyGainKg +
      daysInStage;
    const tag = world.nextPigTag();
    const pig = new GrowingPig({
      id: tag,
      tag,
      sex: world.variation.sex([tag]),
      birthDay: -Math.round(ageDays),
      weightKg,
      stage,
      ...growthDraw(world, tag),
    });
    pig.weanedOnDay = -Math.round(daysInStage);
    catchUpVaccinations(world, pig, 0);
    world.pigs.push(pig);
    placed.push(pig);
  }
  world.mortality.enterStage(placed, stage, 0);
}
