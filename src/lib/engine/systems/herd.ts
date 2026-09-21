import {
  BOAR_WEIGHT_KG,
  DAYS_PER_MONTH,
  GILT_ACCLIMATISATION_DAYS,
  GILT_ENTRY_AGE_DAYS,
} from "../../config";
import { carryingValue } from "../../sim/accounting";
import { Boar, Sow } from "../../sim/animals";
import type { World } from "../world";
import { breedingStrength, everyMateNeedsABoar } from "./herd-genetics";

/**
 * The herd system: culling, boar rotation and replacement.
 *
 * Nothing here is new in 2.0 — it is a faithful port — but it is a system of its
 * own now rather than the tail of a very long method, which is the point of the
 * exercise. It reads the herd, applies the culling and replacement policies, and
 * buys what the policies say the farm is short of.
 */
export function runHerd(world: World): void {
  const { config } = world;
  const day = world.day;
  const record = world.record;

  for (const sow of world.sows) {
    if (!sow.alive || !sow.readyToCull(config)) continue;
    sow.leave(day, "culled");
    // The cull cheque is income; what she was carried at comes off the books
    // against it, so a sow sold early shows as a loss on disposal.
    world.books.sellBreedingStock(carryingValue(sow));
    world.noteExit(sow.generation, true);
    record.sowsCulled += 1;
    world.ledger.accrue("cull-sales", config.herd.cullSowSaleValue);
    world.emit("SowCulled", sow.tag + " culled after parity " + sow.parity, {
      entities: [sow.tag],
      cause: "reached the culling parity",
      postings: [
        {
          category: "cull-sales",
          accrued: config.herd.cullSowSaleValue,
          cash: config.herd.cullSowSaleValue,
        },
      ],
    });
  }
  world.lifetime.sowsCulled += record.sowsCulled;

  // A boar is rotated off at the end of his working life. Standing one for
  // longer puts him over his own daughters, which is exactly what a closed herd
  // has to avoid as it expands.
  const workingLifeDays = Math.round(config.herd.boarWorkingLifeMonths * DAYS_PER_MONTH);
  for (const boar of world.boars) {
    if (!boar.alive || !boar.readyToRotate(day, workingLifeDays)) continue;
    boar.leave(day, "culled");
    world.books.sellBreedingStock(carryingValue(boar));
    record.boarsRotated += 1;
    world.ledger.accrue("cull-sales", config.herd.cullSowSaleValue);
    world.emit(
      "BoarRotated",
      boar.tag +
        " rotated out after " +
        config.herd.boarWorkingLifeMonths +
        " months and " +
        boar.totalServices +
        " services",
      { entities: [boar.tag], changes: { services: boar.totalServices } },
    );
  }
  world.lifetime.boarsRotated += record.boarsRotated;

  // Boars cannot be bred out of the market pigs, so the team is always kept up
  // to the planned number — without one, the whole herd stops breeding.
  const boarsWanted = Math.round(config.stock.boars);
  const boarsAlive = world.boars.filter((boar) => boar.alive).length;
  for (let i = boarsAlive; i < boarsWanted; i += 1) {
    buyBoar(world, "Replacement boar", "the team was below its planned strength");
  }

  // Once a boar's own daughters are coming to service, one boar is no longer a
  // breeding team: the farm stands a second, unrelated boar so those females
  // have a mate that is not their father.
  if (everyMateNeedsABoar(world)) {
    buyBoar(world, "Unrelated boar", "home-bred females are coming to service");
  }

  if (!config.herd.buyGiltsWhenShort) return;

  // Gilts are only bought when the home-bred pipeline cannot cover the places.
  const { females, pipeline } = breedingStrength(world);
  const shortfall = config.herd.maxSows - females - pipeline;
  if (shortfall <= 0) return;

  for (let i = 0; i < shortfall; i += 1) {
    const tag = world.nextSowTag();
    const gilt = new Sow({
      id: tag,
      tag,
      birthDay: day - GILT_ENTRY_AGE_DAYS,
      weightKg: config.herd.giltServiceWeightKg,
      state: "open",
      nextServiceDay: day + GILT_ACCLIMATISATION_DAYS,
    });
    gilt.costs.add("purchase", "breeding", config.herd.giltPurchaseCost);
    gilt.breedingValue = config.herd.giltPurchaseCost;
    world.books.buyBreedingStock(config.herd.giltPurchaseCost);
    world.breedingCosts.add("purchase", "breeding", config.herd.giltPurchaseCost);
    world.sows.push(gilt);
    world.ledger.accrue("breeding-stock", config.herd.giltPurchaseCost);
  }
  record.giltsPurchased = shortfall;
  world.lifetime.giltsPurchased += shortfall;
  world.emit("StockPurchased", shortfall + " replacement gilts bought in", {
    cause: "the home-bred pipeline is short",
    changes: { gilts: shortfall },
    postings: [
      {
        category: "breeding-stock",
        accrued: shortfall * config.herd.giltPurchaseCost,
        cash: shortfall * config.herd.giltPurchaseCost,
      },
    ],
  });
}

function buyBoar(world: World, what: string, cause: string): void {
  const { config } = world;
  const day = world.day;
  const tag = world.nextBoarTag();
  const boar = new Boar({
    id: tag,
    tag,
    birthDay: day - GILT_ENTRY_AGE_DAYS - 60,
    weightKg: BOAR_WEIGHT_KG,
    joinedDay: day,
  });
  boar.costs.add("purchase", "breeding", config.herd.boarPurchaseCost);
  boar.breedingValue = config.herd.boarPurchaseCost;
  world.books.buyBreedingStock(config.herd.boarPurchaseCost);
  world.breedingCosts.add("purchase", "breeding", config.herd.boarPurchaseCost);
  world.boars.push(boar);
  world.ledger.accrue("breeding-stock", config.herd.boarPurchaseCost);
  world.emit("StockPurchased", what + " " + tag + " bought in: " + cause, {
    entities: [tag],
    cause,
    postings: [
      {
        category: "breeding-stock",
        accrued: config.herd.boarPurchaseCost,
        cash: config.herd.boarPurchaseCost,
      },
    ],
  });
}
