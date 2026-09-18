import { deadweightKg } from "../../config";
import { GrowingPig, Sow } from "../../sim/animals";
import { roomForStage, type RoomId } from "../housing";
import type { World } from "../world";
import { bookByStage } from "./reproduction";

/**
 * Growth, movement and sale.
 *
 * The 2.0 change is that growing on and moving on stopped being the same event.
 * In 1.x a pig whose weight crossed a threshold was in the next house that
 * morning, because nothing in the model could refuse it. Here a pig that has
 * earned the next room has to be given a place in it, and when there is none it
 * stays where it is and goes on eating — which puts the room it is in over its
 * own places, slows the pigs in it down, and pushes the pressure back up the
 * farm one room at a time.
 */

/**
 * No more than this many gilts are ever kept out of one litter. It is ordinary
 * selection practice — it spreads the genetics — and it is what stops a herd
 * that is filling its places from drawing every replacement out of the same
 * fortnight of litters.
 */
const MAX_GILTS_PER_LITTER = 2;
/** Spare gilts carried beyond the sow places, so culls can be replaced without a gap. */
const PIPELINE_BUFFER_SHARE = 0.15;

/** Breeding females on the farm now, plus every pig growing on to join them. */
export function breedingStrength(world: World): { females: number; pipeline: number } {
  let pipeline = 0;
  for (const pig of world.pigs) {
    if (pig.alive && pig.destination === "breeding") pipeline += 1;
  }
  return { females: world.sows.filter((sow) => sow.alive).length, pipeline };
}

export function pipelineBuffer(world: World): number {
  return Math.max(1, Math.round(world.config.herd.maxSows * PIPELINE_BUFFER_SHARE));
}

/**
 * Picks replacement gilts out of the female weaners as they reach selection
 * weight. The farm keeps filling the pipeline until the sow places plus a small
 * replacement buffer are covered.
 */
export function runSelection(world: World): void {
  const { config } = world;
  const record = world.record;
  if (!config.herd.retainHomeBredGilts) return;

  const { females, pipeline } = breedingStrength(world);
  const places = config.herd.maxSows + pipelineBuffer(world) - females - pipeline;
  if (places <= 0) return;

  let allowance = places;
  for (const pig of world.pigs) {
    if (allowance <= 0) break;
    if (!pig.alive || pig.assessedForBreeding) continue;
    if (pig.stage === "piglet") continue;
    if (pig.weightKg < config.herd.giltSelectionWeightKg) continue;
    pig.assessedForBreeding = true;
    if (pig.sex !== "female" || pig.destination !== "market") continue;

    const litter = (pig.damTag ?? "founding") + ":" + pig.birthDay;
    const keptFromLitter = world.giltsKeptPerLitter.get(litter) ?? 0;
    if (keptFromLitter >= MAX_GILTS_PER_LITTER) continue;

    world.giltsKeptPerLitter.set(litter, keptFromLitter + 1);
    pig.destination = "breeding";
    allowance -= 1;
    record.giltsSelected += 1;
  }

  if (record.giltsSelected <= 0) return;
  world.lifetime.giltsSelected += record.giltsSelected;
  world.emit(
    "GiltSelected",
    record.giltsSelected + " female pigs selected as replacement gilts",
    { changes: { gilts: record.giltsSelected } },
  );
}

export function runGrowthAndSales(world: World): void {
  const { config } = world;
  const day = world.day;
  const record = world.record;
  let soldWeight = 0;
  let giltSaleValue = 0;
  let freeSowPlaces = config.herd.maxSows - world.sows.filter((sow) => sow.alive).length;

  // ---- the day's gain ------------------------------------------------------
  //
  // What the pig could have made, less what the room it slept in and the ration
  // it was actually given took off. With both switches down those factors are 1
  // and this is the 1.x figure to the gram.
  for (const pig of world.pigs) {
    if (!pig.alive) continue;
    pig.advanceWeight(config);
  }

  // ---- moving between the houses -------------------------------------------
  //
  // One path, whether or not places are enforced: with the switch down the
  // housing grants every request, which lands every pig in exactly the stage
  // the 1.x rule would have put it in. With it up a request can be refused, and
  // a refused pig stays where it is and keeps eating.
  const movedOn: GrowingPig[] = [];
  const blocked = new Map<RoomId, number>();
  for (const pig of world.pigs) {
    if (!pig.alive) continue;
    const next = pig.nextStage(config);
    if (next === null) {
      pig.heldSinceDay = null;
      continue;
    }
    const from = roomForStage(pig.stage);
    const to = roomForStage(next);
    if (!world.housing.request(to, day)) {
      if (pig.heldSinceDay === null) {
        pig.heldSinceDay = day;
        record.movementsBlocked += 1;
        world.lifetime.movementsBlocked += 1;
        world.housing.noteBlocked(to);
        if (to) blocked.set(to, (blocked.get(to) ?? 0) + 1);
      }
      world.housing.noteHeld(from);
      world.lifetime.blockedAnimalDays += 1;
      record.pigsHeld += 1;
      continue;
    }
    world.housing.release(from);
    pig.heldSinceDay = null;
    pig.stage = next;
    if (next === "grower") record.movedToGrower += 1;
    else if (next === "finisher") record.movedToFinisher += 1;
    // It left the old stage on its feet, so that stage takes its loss back.
    world.mortality.release(pig);
    movedOn.push(pig);
  }
  bookByStage(world, movedOn, day);

  for (const [room, held] of blocked) {
    world.emit(
      "MovementBlocked",
      held +
        (held === 1 ? " pig is" : " pigs are") +
        " held back: the " +
        room +
        " house is full at " +
        world.housing.places[room] +
        " places",
      {
        room,
        cause: "no free place downstream",
        changes: { pigs: held, places: world.housing.places[room] },
      },
    );
  }

  // ---- the kill ------------------------------------------------------------
  //
  // Pigs are killed by cohort: litter mates born on one day go on one day, when
  // the cohort's average weight reaches the target.
  const cohorts = new Map<number, GrowingPig[]>();
  for (const pig of world.pigs) {
    if (!pig.alive || !pig.readyForMarket()) continue;
    const members = cohorts.get(pig.cohort);
    if (members) members.push(pig);
    else cohorts.set(pig.cohort, [pig]);
  }

  for (const members of cohorts.values()) {
    const average = members.reduce((total, pig) => total + pig.weightKg, 0) / members.length;
    if (average < config.growth.saleWeightKg) continue;
    for (const pig of members) {
      world.mortality.release(pig);
      world.housing.release(roomForStage(pig.stage));
      pig.leave(day, "sold");
      world.noteExit(pig.generation, true);
      world.soldPigCosts.absorb(pig.costs);
      record.sold += 1;
      soldWeight += pig.weightKg;
    }
  }

  // ---- gilts coming to the herd --------------------------------------------
  for (const pig of world.pigs) {
    if (!pig.alive) continue;
    pig.noteFirstHeat(day, config);
    if (!pig.readyToBreed(day, config)) continue;

    if (freeSowPlaces > 0) {
      // She does not leave the farm, she changes role: the pig record closes and
      // the same animal carries on as a sow, keeping her tag, her lineage and
      // the cost of rearing her.
      world.mortality.release(pig);
      world.housing.release(roomForStage(pig.stage));
      world.sows.push(Sow.fromGilt(pig, day));
      pig.alive = false;
      pig.exitDay = day;
      freeSowPlaces -= 1;
      record.giltsPromoted += 1;
    } else {
      world.mortality.release(pig);
      world.housing.release(roomForStage(pig.stage));
      pig.leave(day, "sold-as-gilt");
      world.noteExit(pig.generation, true);
      giltSaleValue += config.herd.surplusGiltSaleValue;
      record.giltsSold += 1;
    }
  }

  if (record.giltsPromoted > 0) {
    world.lifetime.giltsPromoted += record.giltsPromoted;
    world.emit("GiltPromoted", record.giltsPromoted + " gilts joined the breeding herd", {
      changes: { gilts: record.giltsPromoted },
    });
  }

  if (record.giltsSold > 0) {
    world.lifetime.giltsSold += record.giltsSold;
    world.ledger.accrue("gilt-sales", giltSaleValue);
    world.emit(
      "GiltSold",
      record.giltsSold + " surplus gilts sold as breeding stock: the herd is at capacity",
      {
        cause: "no free sow place",
        postings: [{ category: "gilt-sales", accrued: giltSaleValue, cash: giltSaleValue }],
      },
    );
  }

  if (record.sold === 0) return;

  // The abattoir pays for carcass, not for the pig that walked on.
  const soldDeadweight = deadweightKg(soldWeight, config);
  record.soldLiveweightKg = soldWeight;
  record.soldDeadweightKg = soldDeadweight;
  world.lifetime.sold += record.sold;
  world.lifetime.soldLiveweightKg += soldWeight;
  world.lifetime.soldDeadweightKg += soldDeadweight;
  const revenue = soldDeadweight * config.finance.salePriceKg;
  world.ledger.accrue("pig-sales", revenue);
  runMarketHaulage(world);
  world.emit(
    "PigsSold",
    record.sold + " pigs sold at " + (soldWeight / record.sold).toFixed(1) + " kg average",
    {
      changes: { pigs: record.sold, liveweightKg: soldWeight, deadweightKg: soldDeadweight },
      postings: [{ category: "pig-sales", accrued: revenue, cash: revenue }],
    },
  );
}

/**
 * Takes the day's sold pigs to the abattoir, alive, on the day they are sold.
 * How many times the lorry goes is the head sold over what it holds, so a cohort
 * too big for one load is two runs and a small draw still costs a whole trip.
 */
function runMarketHaulage(world: World): void {
  const { config } = world;
  const record = world.record;
  if (record.sold <= 0) return;

  const trips = Math.ceil(record.sold / config.finance.marketTruckCapacityPigs);
  const cost = trips * config.finance.marketTripCost;
  world.ledger.accrue("transport", cost);
  world.soldPigCosts.add("transport", "finisher", cost);
  record.marketTrips = trips;
  world.lifetime.marketTrips += trips;
  world.lifetime.marketHaulageCost += cost;
  world.emit(
    "PigsSold",
    trips === 1
      ? "Lorry to the abattoir with " + record.sold + " pigs"
      : trips + " lorry runs to the abattoir with " + record.sold + " pigs",
    {
      changes: { trips },
      postings: [{ category: "transport", accrued: cost, cash: cost }],
    },
  );
}
