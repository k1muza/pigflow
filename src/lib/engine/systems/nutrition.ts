import type { Vaccination } from "../../config";
import { FEED_RATIONS, type CostType, type GrowingPig } from "../../sim/animals";
import { STORE_IDS, type StoreId } from "../../sim/haulage";
import { STORE_LABELS } from "../../sim/farm";
import { emptyRations } from "../../sim/haulage";
import { zeroStores, type StoreQuantities } from "../procurement";
import type { World } from "../world";
import { RATION_CATEGORY, runEmergencyProcurement } from "./procurement";

/**
 * The nutrition system: what the herd asks for, what the stores can actually
 * give it, what that costs and who it is charged to. Vaccination and the piglet
 * processing jobs ride along here because they are the same pass over the herd
 * and the same question — what does this animal need today, at this age.
 *
 * The one rule worth stating: every draw is totted up before a kilogram is
 * handed out. A store that cannot cover the day has to be short on the whole
 * herd rather than on whichever animals the loop reached last, or a shortage
 * would be an artefact of iteration order instead of a fact about the farm.
 */

/** Whether a job on the schedule is done to this pig at all. */
function appliesTo(job: Vaccination, pig: GrowingPig): boolean {
  if (job.appliesTo === "all") return true;
  return job.appliesTo === (pig.sex === "male" ? "males" : "females");
}

/**
 * What this dose costs beyond itself. A job bought by the dose costs nothing
 * extra; one that comes in a pack costs the whole pack the moment a pack has to
 * be opened, and the doses left in it are drawn on until they run out.
 */
function packWaste(world: World, dose: Vaccination, day: number): number {
  if (dose.dosesPerPack <= 1) return 0;
  const open = world.packLeft.get(dose.id);
  // What limits a vaccine is the clock, not the shelf: a pack broached weeks ago
  // has doses left in it and none of them are any use.
  const stillGood =
    open !== undefined &&
    open.left >= 1 &&
    (dose.openPackKeepsDays <= 0 || day <= open.openedOn + dose.openPackKeepsDays);
  if (stillGood) {
    world.packLeft.set(dose.id, { left: open.left - 1, openedOn: open.openedOn });
    return 0;
  }
  world.packLeft.set(dose.id, { left: dose.dosesPerPack - 1, openedOn: day });
  return dose.costPerPig * (dose.dosesPerPack - 1);
}

/**
 * How many heaters burn tonight, and how many piglets are under them.
 *
 * A suckler is in its dam's crate, so a litter cannot share a lamp with the
 * litter next door: every litter lights at least one of its own, and a litter
 * bigger than a lamp covers lights a second. Once weaned they are penned in
 * groups, so the rest of the heated pigs share what their number needs.
 */
export function heatersAlight(world: World, day: number): { heaters: number; underHeat: number } {
  const { health } = world.config;
  if (health.heatedUntilAgeDays <= 0 || health.gasKgPerHeaterDay <= 0) {
    return { heaters: 0, underHeat: 0 };
  }
  const perLamp = Math.max(health.pigletsPerHeater, 1);

  const crates = new Map<string, number>();
  let inPens = 0;
  let underHeat = 0;
  for (const pig of world.pigs) {
    if (!pig.alive) continue;
    if (pig.ageDays(day) >= health.heatedUntilAgeDays) continue;
    underHeat += 1;
    if (pig.weanedOnDay === null) {
      const crate = (pig.damTag ?? "?") + "@" + pig.birthDay;
      crates.set(crate, (crates.get(crate) ?? 0) + 1);
    } else {
      inPens += 1;
    }
  }

  let heaters = Math.ceil(inPens / perLamp);
  for (const head of crates.values()) heaters += Math.ceil(head / perLamp);
  return { heaters, underHeat };
}

export function runNutrition(world: World): void {
  const { config, policies, supplies, ledger } = world;
  const day = world.day;
  const record = world.record;

  const { heaters, underHeat } = heatersAlight(world, day);
  record.gasHeaters = heaters;
  const head = world.countHerd().total;
  const gasPerPig = underHeat > 0 ? (heaters * config.health.gasKgPerHeaterDay) / underHeat : 0;
  const beddingWanted = head * config.housing.beddingKgPerHeadDay;

  // ---- what the herd asks for today ---------------------------------------
  const demand = zeroStores();
  const breeders: { animal: { costs: GrowingPig["costs"] }; store: StoreId; kg: number }[] = [];
  for (const sow of world.sows) {
    const { kg, ration } = sow.dailyFeed(config);
    breeders.push({ animal: sow, store: ration, kg });
    demand[ration] += kg;
  }
  for (const boar of world.boars) {
    const { kg, ration } = boar.dailyFeed(config);
    breeders.push({ animal: boar, store: ration, kg });
    demand[ration] += kg;
  }
  for (const pig of world.pigs) {
    if (!pig.alive) continue;
    const ration = pig.dailyFeed(config);
    demand[ration.ration] += ration.kg;
    const creep = pig.creepFeed(day, config);
    demand[creep.ration] += creep.kg;
    if (pig.ageDays(day) < config.health.heatedUntilAgeDays) demand.gas += gasPerPig;
  }
  demand.bedding += beddingWanted;

  // ---- what the stores can actually give it -------------------------------
  const served = zeroStores();
  const shortfall: Partial<StoreQuantities> = {};
  for (const store of STORE_IDS) {
    served[store] = 1;
    supplies.noteDemand(store, demand[store]);
    if (demand[store] <= 0) continue;
    const available = supplies.available(store);
    if (available >= demand[store]) continue;
    served[store] = Math.max(0, available / demand[store]);
    const short = demand[store] - available;
    shortfall[store] = short;
    supplies.noteShortfall(short);
    if (store !== "gas" && store !== "bedding") {
      record.feedShortfallKg += short;
      world.lifetime.feedShortfallKg += short;
    }
    world.emit(
      "StoreRanShort",
      STORE_LABELS[store] +
        " ran short by " +
        Math.round(short) +
        " kg: the herd is on " +
        Math.round(served[store] * 100) +
        "% of what it wanted",
      {
        cause: "the bin was empty before the next load landed",
        changes: { shortfallKg: short, servedShare: served[store] },
      },
    );
  }

  // ---- and what that costs -------------------------------------------------
  let sowFeedKg = 0;
  let growingFeedKg = 0;
  let gasKg = 0;
  let gasCost = 0;
  let vaccinationCost = 0;
  let processingCost = 0;
  const feedSpend = emptyRations();

  /**
   * Takes goods out of a store and says what they cost. Haulage is charged out
   * with them, so a share of the journey lands on the animal that ate the load —
   * under foresight off the schedule's own per-day table, and operationally off
   * what the journeys behind the goods now in the bin came to.
   */
  const issue = (store: StoreId, kg: number) => {
    const out = supplies.draw(store, kg);
    const haulagePerKg = policies.operationalProcurement
      ? out.haulagePerKg
      : (world.haulage.haulagePerKgByDay[store]?.[day] ?? 0);
    return { kg: out.kg, cost: out.kg * out.costPerKg, haulage: out.kg * haulagePerKg };
  };

  for (const { animal, store, kg } of breeders) {
    const out = issue(store, kg * served[store]);
    sowFeedKg += out.kg;
    if (store !== "gas" && store !== "bedding") {
      record.feedByRation[store] += out.kg;
      feedSpend[store] += out.cost;
    }
    animal.costs.add("feed", "breeding", out.cost);
    animal.costs.add("transport", "breeding", out.haulage);
    world.books.keepBreedingHerd(out.cost + out.haulage);
    world.breedingCosts.add("feed", "breeding", out.cost);
    world.breedingCosts.add("transport", "breeding", out.haulage);
  }

  for (const pig of world.pigs) {
    if (!pig.alive) continue;
    const stage = pig.costStage;
    // A pig picked out to breed is no longer a market pig: what she eats from
    // here on is the cost of replacing a sow, not of producing pork.
    const replacement = pig.destination === "breeding";
    const charge = (type: CostType, amount: number) => {
      pig.costs.add(type, stage, amount);
      if (replacement) world.breedingCosts.add(type, stage, amount);
      // The same posting, read the other way: this cost has not left the farm,
      // it has turned into part of an animal standing in a pen.
      world.books.capitalise(pig.destination, amount);
    };

    const ration = pig.dailyFeed(config);
    if (ration.kg > 0) {
      const out = issue(ration.ration, ration.kg * served[ration.ration]);
      if (pig.stage === "gilt") sowFeedKg += out.kg;
      else growingFeedKg += out.kg;
      record.feedByRation[ration.ration] += out.kg;
      feedSpend[ration.ration] += out.cost;
      charge("feed", out.cost);
      charge("transport", out.haulage);
      // A pig grows on the ration it was given, not the one it was offered.
      pig.intakeFactor = Math.min(pig.intakeFactor, served[ration.ration]);
    }

    const creep = pig.creepFeed(day, config);
    if (creep.kg > 0) {
      const out = issue(creep.ration, creep.kg * served[creep.ration]);
      growingFeedKg += out.kg;
      record.feedByRation[creep.ration] += out.kg;
      feedSpend[creep.ration] += out.cost;
      charge("feed", out.cost);
      charge("transport", out.haulage);
    }

    // A suckler lives on milk, and milk follows what its dam was given rather
    // than what it picked at in the creep feeder.
    if (pig.stage === "piglet") pig.intakeFactor = Math.min(pig.intakeFactor, served.sow);

    const ageDays = pig.ageDays(day);
    if (ageDays < config.health.heatedUntilAgeDays && gasPerPig > 0) {
      const out = issue("gas", gasPerPig * served.gas);
      gasKg += out.kg;
      gasCost += out.cost;
      charge("heating", out.cost);
      charge("transport", out.haulage);
    }

    while (
      pig.vaccinationsGiven < world.vaccinationSchedule.length &&
      ageDays >= world.vaccinationSchedule[pig.vaccinationsGiven].ageDays
    ) {
      const dose = world.vaccinationSchedule[pig.vaccinationsGiven];
      // The cursor moves past every job whether or not this pig is one it is
      // done to, so a gilt does not queue behind the castrations forever.
      pig.vaccinationsGiven += 1;
      if (!appliesTo(dose, pig)) continue;
      const cost = dose.costPerPig + packWaste(world, dose, day);
      if (dose.kind === "processing") {
        processingCost += cost;
        record.processing[dose.name] = (record.processing[dose.name] ?? 0) + 1;
      } else {
        vaccinationCost += cost;
      }
      charge("health", cost);
      record.vaccinations[pig.stage] += 1;
    }
  }

  const bedding = issue("bedding", beddingWanted * served.bedding);

  record.sowFeedKg = sowFeedKg;
  record.growingFeedKg = growingFeedKg;
  record.gasKg = gasKg;
  record.beddingKg = bedding.kg;

  // Goods eaten are a cost of the day they are eaten. Whether that is also the
  // day the bank saw them is the accounting switch: with it down the two are one
  // event, which is the 1.x behaviour; with it up the money left when the
  // supplier's terms fell due and this is the cost alone.
  const post = policies.accrualAccounting
    ? (category: Parameters<typeof ledger.charge>[0], amount: number) =>
        ledger.charge(category, amount)
    : (category: Parameters<typeof ledger.accrue>[0], amount: number) =>
        ledger.accrue(category, amount);
  for (const ration of FEED_RATIONS) post(RATION_CATEGORY[ration], feedSpend[ration]);
  post("gas", gasCost);
  post("bedding", bedding.cost);
  ledger.accrue("vaccination", vaccinationCost);
  ledger.accrue("processing", processingCost);

  // A store that ran dry today is sent for now, at a premium, and still takes a
  // day to come. That day is what a thin ordering policy really costs.
  runEmergencyProcurement(world, shortfall);

  const restricted = world.pigs.filter((pig) => pig.alive && pig.intakeFactor < 1).length;
  if (restricted > 0) {
    world.emit("IntakeRestricted", restricted + " pigs are on a restricted ration", {
      cause: "a store ran short",
      changes: { pigs: restricted },
    });
  }

  // Processing is a job done to a batch, so it is logged as one: a line per job
  // per day rather than a line per piglet.
  for (const [job, count] of Object.entries(record.processing)) {
    world.emit(
      "ProcessingDone",
      job + " done to " + count + (count === 1 ? " piglet" : " piglets"),
      { changes: { piglets: count } },
    );
  }
}
