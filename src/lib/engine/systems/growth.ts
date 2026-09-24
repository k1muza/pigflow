import type { PlannerConfig } from "../../config";
import { deadweightKg } from "../../config";
import { GrowingPig, Sow, type PigStage } from "../../sim/animals";
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

/** How far along the growing houses a stage is, so a batch only ever goes on. */
const HOUSE_ORDER: Record<string, number> = { weaner: 1, grower: 2, finisher: 3 };

/** The one house that comes after this one. There is no other way through. */
const NEXT_HOUSE: Record<string, PigStage> = { weaner: "grower", grower: "finisher" };

/**
 * The house a batch is ready to move into, read off the average weight of the
 * pigs in it — the same figure the kill is settled on, and for the same reason:
 * a pen moves as a pen, and it moves when the pen is ready rather than when its
 * heaviest animal is.
 *
 * Weight says whether the batch has earned its next move. It never says which
 * move, because there is only one: weaner to grower, grower to finisher. A pen
 * held out of the grower house goes on growing where it stands, and if weight
 * alone chose the destination it would in time qualify for the finisher house
 * and be sent there straight from the weaner pens — which would make the grower
 * house something a plan could grow its way around, and the queue it is supposed
 * to cause would land one room further down instead of where the shortage is.
 *
 * Sucklers and selected gilts are not part of it. A suckler is in its dam's
 * crate and moves when she weans; a gilt has left the market herd and is on her
 * way to the breeding accommodation, which is not one of these rooms.
 */
function earnedStage(
  members: readonly GrowingPig[],
  config: PlannerConfig,
  current: PigStage,
): PigStage | null {
  const growing = members.filter((pig) => pig.stage !== "piglet" && pig.stage !== "gilt");
  if (growing.length === 0) return null;
  const average = growing.reduce((total, pig) => total + pig.weightKg, 0) / growing.length;
  const earned: PigStage =
    average >= config.growth.finisherStartWeightKg
      ? "finisher"
      : average >= config.growth.growerStartWeightKg
        ? "grower"
        : "weaner";
  const from = HOUSE_ORDER[current];
  if (from === undefined) return null;
  if (HOUSE_ORDER[earned] <= from) return null;
  // Ready to move on, so it moves on by one room — never two.
  return NEXT_HOUSE[current] ?? null;
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
    // What she has cost so far goes with her: she is no longer stock on its way
    // to the abattoir, she is a sow the farm is part way through rearing.
    world.books.selectGilt(pig.costs.total);
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

/**
 * Operational market draw, settled from opening liveweights before feed is
 * offered for the day.
 *
 * A cohort that opens below target is not a slaughter cohort yet: it eats and
 * grows today and can leave tomorrow morning if its opening average then meets
 * the target. Conversely, a cohort already at target does not receive another
 * finishing ration whose main immediate effect would be gut fill before sale.
 *
 * The legacy/perfect-foresight path deliberately does not use this function;
 * its old after-growth sale timing remains inside runGrowthAndSales for parity.
 */
export function runMarketSales(world: World): void {
  if (!world.policies.operationalProcurement) return;

  const { config } = world;
  const day = world.day;
  const record = world.record;
  let soldWeight = 0;
  let heldAtWeight = 0;

  const pens: { stage: PigStage; members: GrowingPig[] }[] = [];
  if (world.policies.enforceHousing) {
    for (const batch of world.batches.all()) {
      pens.push({ stage: batch.stage, members: world.batches.membersOf(batch, world.pigs) });
    }
  } else {
    const cohorts = new Map<number, GrowingPig[]>();
    for (const pig of world.pigs) {
      if (!pig.alive) continue;
      const members = cohorts.get(pig.cohort);
      if (members) members.push(pig);
      else cohorts.set(pig.cohort, [pig]);
    }
    for (const members of cohorts.values()) pens.push({ stage: "finisher", members });
  }

  for (const pen of pens) {
    const members = pen.members.filter((pig) => pig.readyForMarket());
    if (members.length === 0) continue;
    const average = members.reduce((total, pig) => total + pig.weightKg, 0) / members.length;
    if (average < config.growth.saleWeightKg) continue;
    if (pen.stage !== "finisher") {
      heldAtWeight += members.length;
      continue;
    }
    for (const pig of members) {
      world.mortality.release(pig);
      world.housing.release(roomForStage(pig.stage));
      world.batches.remove(pig);
      pig.leave(day, "sold");
      world.noteExit(pig.generation, true);
      world.soldPigCosts.absorb(pig.costs);
      world.books.sellMarketPig(pig.costs.total);
      record.sold += 1;
      soldWeight += pig.weightKg;
    }
  }

  record.heldAtSaleWeight = heldAtWeight;
  if (heldAtWeight > 0) {
    world.lifetime.heldAtSaleWeightDays += heldAtWeight;
    world.emit(
      "SaleHeldForSpace",
      heldAtWeight +
        (heldAtWeight === 1 ? " sale-weight pig is" : " sale-weight pigs are") +
        " held outside finishing accommodation",
      {
        room: "finisher",
        cause: "at weight, but not in the finishing house",
        changes: { pigs: heldAtWeight, places: world.housing.places.finisher },
      },
    );
  }

  if (record.sold === 0) return;

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
  // Two paths, and the housing switch chooses between them.
  //
  // With it down the farm is the 1.x farm: a pig whose own weight has earned the
  // next room is in it that morning, because nothing can refuse it. That is not
  // a weaker version of the batch rule, it is a different rule — the 1.x farm
  // moves animals and this one moves pens — so it is kept as it was rather than
  // approximated, and the parity harness holds the two to the gram.
  //
  // With it up the unit is the batch: the pen is what is given places, what is
  // split when there are not enough of them, and what is sold.
  const movedOn: GrowingPig[] = [];
  const blocked = new Map<RoomId, number>();
  if (!world.policies.enforceHousing) {
    for (const pig of world.pigs) {
      if (!pig.alive) continue;
      const next = pig.nextStage(config);
      if (next === null) {
        pig.heldSinceDay = null;
        continue;
      }
      world.housing.request(roomForStage(next), day);
      world.housing.release(roomForStage(pig.stage));
      pig.heldSinceDay = null;
      pig.moveToStage(next);
      if (next === "grower") record.movedToGrower += 1;
      else if (next === "finisher") record.movedToFinisher += 1;
      // It left the old stage on its feet, so that stage takes its loss back.
      world.mortality.release(pig);
      movedOn.push(pig);
    }
  }
  // A pig picked out to breed is drafted out of the pen rather than moved with
  // it. She has to be: the batch rules are about market pigs going to the next
  // house, and she is not going there — she is going to the breeding
  // accommodation, which the housing does not count places for.
  //
  // Without this she stays a member of a market pen for good. She never earns a
  // room, because the batch rule ignores her, and she never becomes a gilt, so
  // she can never be promoted either. She just grows: on a farm with one
  // finishing place, one such pig reached 608 kg and held that place for the
  // whole plan while every market pig behind her queued at sale weight.
  if (world.policies.enforceHousing) {
    for (const pig of world.pigs) {
      if (!pig.alive || pig.destination !== "breeding") continue;
      if (pig.nextStage(config) !== "gilt") continue;
      // She frees the place she was standing in and takes none: breeding stock
      // is bounded by sow places, not by finishing floor.
      world.housing.release(roomForStage(pig.stage));
      world.batches.remove(pig);
      pig.heldSinceDay = null;
      pig.moveToStage("gilt");
      world.mortality.release(pig);
      movedOn.push(pig);
    }
  }

  // Batches are read off a snapshot, because moving one splits it and a split
  // adds two more to the registry that must not be visited again this morning.
  for (const batch of world.policies.enforceHousing ? world.batches.all() : []) {
    const members = world.batches.membersOf(batch, world.pigs);
    if (members.length === 0) continue;
    const next = earnedStage(members, config, batch.stage);
    if (next === null || next === batch.stage) continue;

    const from = roomForStage(batch.stage);
    const to = roomForStage(next);
    const granted = world.housing.requestMany(to, members.length, day);

    if (granted <= 0) {
      // The whole pen stays where it is, together, and goes on eating.
      if (batch.heldNotedDay !== day) {
        record.movementsBlocked += 1;
        world.lifetime.movementsBlocked += 1;
        world.housing.noteBlocked(to);
        if (to) blocked.set(to, (blocked.get(to) ?? 0) + members.length);
      }
      batch.heldNotedDay = day;
      for (const pig of members) {
        if (pig.heldSinceDay === null) pig.heldSinceDay = day;
        world.housing.noteHeld(from);
        world.lifetime.blockedAnimalDays += 1;
        record.pigsHeld += 1;
      }
      continue;
    }

    // The ones that go are the heaviest, which is how a pen is actually drawn:
    // you take the ones nearest the next stage and leave the tail to catch up.
    const ordered = [...members].sort(
      (a, b) => b.weightKg - a.weightKg || a.tag.localeCompare(b.tag),
    );
    const moving = ordered.slice(0, granted);
    const staying = ordered.slice(granted);

    let going = batch;
    if (staying.length > 0) {
      const { moved, stayed } = world.batches.split(batch, moving);
      going = moved;
      record.batchesSplit += 1;
      world.lifetime.batchesSplit += 1;
      world.emit(
        "BatchSplit",
        moving.length +
          " of " +
          members.length +
          " move to the " +
          to +
          " house; " +
          staying.length +
          " stay behind for want of a place",
        {
          room: to ?? undefined,
          cause: "the next house had room for part of the batch",
          changes: { moved: moving.length, held: staying.length, from: batch.id },
          entities: stayed ? [going.id, stayed.id] : [going.id],
        },
      );
      for (const pig of staying) {
        if (pig.heldSinceDay === null) pig.heldSinceDay = day;
        world.housing.noteHeld(from);
        world.lifetime.blockedAnimalDays += 1;
        record.pigsHeld += 1;
      }
    }

    world.batches.moveTo(going, to, next, day);
    for (const pig of moving) {
      world.housing.release(from);
      pig.heldSinceDay = null;
      pig.moveToStage(next);
      // It left the old stage on its feet, so that stage takes its loss back.
      world.mortality.release(pig);
      movedOn.push(pig);
    }
    if (next === "grower") record.movedToGrower += moving.length;
    else if (next === "finisher") record.movedToFinisher += moving.length;
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
  // Pigs go by the batch they are standing in, when that batch's average weight
  // reaches the target — and only out of the finishing house.
  //
  // That last clause is the constraint. Before it, a pig held back for want of a
  // finisher place went on growing in the weaner house and was sold from it, so
  // finisher places delayed a movement and constrained nothing: a farm could run
  // the whole herd through a shed it had no room for. Now the ceiling is real,
  // and a plan that is short of finishing accommodation says so — in held pigs,
  // in the feed they go on eating, and in the sale that has not happened yet.
  //
  // Anything else — selling out of a grower house, a forced disposal, a sale at
  // a discount — is a decision the farm makes and would be a policy and an event
  // of its own. None of them is the normal route, so none of them is here.
  if (!world.policies.operationalProcurement) {
  let heldAtWeight = 0;
  // With housing not enforced the pen is not a thing the farm has, so the kill
  // falls back to the 1.x rule: litter mates born on one day go on one day.
  // Nothing can be held back for want of a place in that farm, so nothing is.
  const pens: { stage: PigStage; members: GrowingPig[] }[] = [];
  if (world.policies.enforceHousing) {
    for (const batch of world.batches.all()) {
      pens.push({ stage: batch.stage, members: world.batches.membersOf(batch, world.pigs) });
    }
  } else {
    const cohorts = new Map<number, GrowingPig[]>();
    for (const pig of world.pigs) {
      if (!pig.alive) continue;
      const members = cohorts.get(pig.cohort);
      if (members) members.push(pig);
      else cohorts.set(pig.cohort, [pig]);
    }
    for (const members of cohorts.values()) pens.push({ stage: "finisher", members });
  }

  for (const pen of pens) {
    const members = pen.members.filter((pig) => pig.readyForMarket());
    if (members.length === 0) continue;
    const average = members.reduce((total, pig) => total + pig.weightKg, 0) / members.length;
    if (average < config.growth.saleWeightKg) continue;
    if (pen.stage !== "finisher") {
      // At weight and in the wrong house. It is not a sale and it is not lost —
      // it is a queue, and the farm should be able to see it.
      heldAtWeight += members.length;
      continue;
    }
    for (const pig of members) {
      world.mortality.release(pig);
      world.housing.release(roomForStage(pig.stage));
      world.batches.remove(pig);
      pig.leave(day, "sold");
      world.noteExit(pig.generation, true);
      world.soldPigCosts.absorb(pig.costs);
      world.books.sellMarketPig(pig.costs.total);
      record.sold += 1;
      soldWeight += pig.weightKg;
    }
  }
  record.heldAtSaleWeight = heldAtWeight;
  if (heldAtWeight > 0) {
    world.lifetime.heldAtSaleWeightDays += heldAtWeight;
    world.emit(
      "SaleHeldForSpace",
      heldAtWeight +
        (heldAtWeight === 1 ? " sale-weight pig is" : " sale-weight pigs are") +
        " held outside finishing accommodation",
      {
        room: "finisher",
        cause: "at weight, but not in the finishing house",
        changes: { pigs: heldAtWeight, places: world.housing.places.finisher },
      },
    );
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
      // She is out of the market pen for good: she leaves it rather than being
      // carried along in it as a member who can never be sold.
      world.batches.remove(pig);
      const sow = Sow.fromGilt(pig, day);
      // What she cost to rear is what she is worth walking in, and it is
      // written off over the litters she is kept for. No profit is made here:
      // the money simply stops being stock and starts being plant.
      sow.breedingValue = pig.costs.total;
      world.books.promoteGilt(pig.costs.total);
      world.sows.push(sow);
      world.pedigree.remember(sow);
      pig.alive = false;
      pig.exitDay = day;
      freeSowPlaces -= 1;
      record.giltsPromoted += 1;
    } else {
      world.mortality.release(pig);
      world.housing.release(roomForStage(pig.stage));
      pig.leave(day, "sold-as-gilt");
      world.noteExit(pig.generation, true);
      world.books.sellGilt(pig.costs.total);
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

  // Operational sales were already settled from opening liveweight, before
  // procurement and nutrition. Do not sell a cohort that only crossed target
  // after today's gain, and do not book the same sale twice.
  if (world.policies.operationalProcurement) return;

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
