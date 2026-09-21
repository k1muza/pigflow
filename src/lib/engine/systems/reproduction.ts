import { BIRTH_WEIGHT_KG, SERVICES_PER_BOAR_PER_WEEK } from "../../config";
import { Boar, GrowingPig, Sow } from "../../sim/animals";
import type { Sire } from "../../sim/farm";
import { createPiglet, studTag } from "../seed";
import type { World } from "../world";

/**
 * The reproduction system: returns, scans, farrowings, weanings and service.
 *
 * The 2.0 change here is the estrus window. In 1.x a sow whose service date has
 * passed is due for service on every day afterwards, so anything that holds a
 * service up — a boar team already worked out for the week, no unrelated mate,
 * a technician who did not come — costs her a day. Boar capacity was therefore
 * not a constraint so much as a queue.
 *
 * A real sow stands for two or three days and is then gone for three weeks. So a
 * heat is an opportunity with a closing date: it is spotted or it is not, it is
 * served inside the window or it is not, and what the farm could not manage
 * inside it costs a whole cycle of feed with nothing at the end of it.
 *
 * The farrowing house is the other change. Crates are places like any other, and
 * a sow due to farrow into a full house is answered the way a farm answers it —
 * by weaning the oldest litter a few days early — and only carries the overflow
 * when there is no litter old enough to move.
 */

/**
 * The youngest a litter will be weaned to free a crate. Weaning early is what a
 * full farrowing house really forces; weaning at ten days is not a management
 * response, it is a different farm.
 */
const MIN_EARLY_WEAN_AGE_DAYS = 18;

export function runReproduction(world: World): void {
  const { config, policies } = world;
  const day = world.day;
  const record = world.record;

  for (const sow of world.sows) {
    if (!sow.alive) continue;

    // She comes back in heat on the day the service she did not hold brings her
    // back — the next cycle, or a week or two past it if she lost it after it had
    // started. That is the day the farm sees, and the day it records.
    if (sow.returnDay !== null && day >= sow.returnDay) {
      sow.returnDay = null;
      record.returnsToHeat += 1;
      if (sow.lastReturnIrregular) {
        record.irregularReturns += 1;
        world.lifetime.irregularReturns += 1;
      } else {
        world.lifetime.regularReturns += 1;
      }
      world.emit(
        "ReturnToEstrus",
        sow.tag +
          " returned to heat " +
          (sow.lastReturnIrregular ? "irregularly" : "regularly") +
          ", " +
          (sow.lastSireTag === null ? "unserved" : "served by " + sow.lastSireTag),
        {
          entities: [sow.tag],
          cause: sow.lastReturnIrregular ? "pregnancy lost after implantation" : "service did not hold",
        },
      );
    }

    // The scan, which is the only thing on the farm that can tell an empty sow
    // from one in pig before she either farrows or comes back.
    if (sow.scanDay !== null && day >= sow.scanDay) {
      sow.scanDay = null;
      const inPig = sow.state === "gestating";
      record.scans += 1;
      world.lifetime.scans += 1;
      if (inPig) {
        record.conceptions += 1;
        world.lifetime.pregnanciesConfirmed += 1;
        if (
          world.policies.realisticHealthAndReproduction &&
          sow.dueDay !== null &&
          world.variation.losesPregnancy(config.reproduction.pregnancyLossPct / 100, [
            sow.tag,
            day,
          ])
        ) {
          // Losses are spread through the known remainder of gestation. The
          // farm cannot know the exact day at scanning, only that this is one of
          // the pregnancies that will fail before term.
          sow.pregnancyLossDay = day + Math.max(1, Math.round((sow.dueDay - day) * 0.55));
        }
      } else {
        world.lifetime.scannedEmpty += 1;
      }
      if (config.reproduction.pregnancyScanCost > 0) {
        world.ledger.accrue("veterinary", config.reproduction.pregnancyScanCost);
        world.breedingCosts.add("health", "breeding", config.reproduction.pregnancyScanCost);
        sow.costs.add("health", "breeding", config.reproduction.pregnancyScanCost);
        world.books.keepBreedingHerd(config.reproduction.pregnancyScanCost);
      }
      world.emit(
        "PregnancyScanned",
        sow.tag +
          (inPig
            ? " scanned in pig, due day " + (sow.dueDay ?? 0)
            : " scanned not in pig, back to service"),
        { entities: [sow.tag], changes: { inPig: inPig ? 1 : 0 } },
      );
    }

    if (
      sow.state === "gestating" &&
      sow.pregnancyLossDay !== null &&
      day >= sow.pregnancyLossDay
    ) {
      const gestationDay = Math.max(
        1,
        config.reproduction.gestationDays - Math.max(0, (sow.dueDay ?? day) - day),
      );
      sow.losePregnancy(day, config.reproduction.weanToServiceDays);
      record.pregnancyLosses += 1;
      world.lifetime.pregnancyLosses += 1;
      world.emit(
        "PregnancyLost",
        sow.tag + " lost a confirmed pregnancy at gestation day " + Math.round(gestationDay),
        {
          entities: [sow.tag],
          cause: "post-scan pregnancy loss",
          changes: { gestationDay: Math.round(gestationDay) },
        },
      );
      continue;
    }

    if (sow.state === "gestating" && sow.dueDay !== null && day >= sow.dueDay) {
      farrow(world, sow);
      continue;
    }

    if (sow.state === "lactating" && sow.weanDay !== null && day >= sow.weanDay) {
      wean(world, sow, "litter reached weaning age");
    }
  }

  runService(world, policies.enforceEstrusWindows);
}

/** A sow farrows. She needs a crate; a full house is answered before she does. */
function farrow(world: World, sow: Sow): void {
  const { config, policies } = world;
  const day = world.day;
  const record = world.record;

  if (policies.enforceHousing && world.housing.freePlaces("farrowing") <= 0) {
    if (!weanEarlyForCrate(world)) {
      world.emit(
        "RoomOverCapacity",
        sow.tag +
          " farrows into a full farrowing house: " +
          world.housing.occupancy("farrowing") +
          " sows in " +
          world.housing.places.farrowing +
          " crates",
        {
          entities: [sow.tag],
          room: "farrowing",
          cause: "no litter was old enough to wean early",
        },
      );
    }
  }
  world.housing.admit("farrowing");

  const outcome = world.policies.realisticHealthAndReproduction
    ? world.variation.farrowingOutcome(
        config.reproduction.bornAlivePerLitter,
        sow.parity + 1,
        config.reproduction.stillbornPct,
        config.reproduction.mummifiedPct,
        [sow.tag, day],
      )
    : (() => {
        const bornAlive = world.variation.litterSize(config.reproduction.bornAlivePerLitter, [
          sow.tag,
          day,
        ]);
        return { totalBorn: bornAlive, bornAlive, stillborn: 0, mummified: 0 };
      })();
  const litterSize = outcome.bornAlive;
  const piglets: GrowingPig[] = [];
  for (let i = 0; i < litterSize; i += 1) {
    const piglet = createPiglet(world, sow, day, BIRTH_WEIGHT_KG);
    piglets.push(piglet);
    world.pigs.push(piglet);
  }
  sow.farrow(day, piglets, config);
  world.mortality.enterStage(piglets, "piglet", day);
  record.farrowings += 1;
  record.bornAlive += litterSize;
  record.stillborn += outcome.stillborn;
  record.mummified += outcome.mummified;
  world.lifetime.litters += 1;
  world.lifetime.bornAlive += litterSize;
  world.lifetime.stillborn += outcome.stillborn;
  world.lifetime.mummified += outcome.mummified;
  world.emit(
    "FarrowingCompleted",
    sow.tag +
      " (gen " +
      sow.generation +
      ") farrowed " +
      outcome.totalBorn +
      " total born, " +
      litterSize +
      " live, " +
      outcome.stillborn +
      " stillborn, " +
      outcome.mummified +
      " mummified, parity " +
      sow.parity,
    {
      entities: [sow.tag],
      room: "farrowing",
      changes: {
        totalBorn: outcome.totalBorn,
        bornAlive: litterSize,
        stillborn: outcome.stillborn,
        mummified: outcome.mummified,
      },
    },
  );
  world.emit("BirthCohortCreated", litterSize + " live piglets entered the herd", {
    entities: piglets.map((piglet) => piglet.tag),
    changes: { bornAlive: litterSize },
  });
}

/** Takes a litter off its dam and puts it into the weaner house. */
function wean(world: World, sow: Sow, cause: string): number {
  const { config, policies } = world;
  const day = world.day;
  const record = world.record;

  const weaned = sow.wean(
    day,
    config,
    world.variation.weanToServiceDays(config.reproduction.weanToServiceDays, [sow.tag, day]),
  );
  // In 2.0 a weaner lands in the weaner house whatever it weighs, because the
  // house is a place and the housing decides where it goes from there.
  if (policies.enforceHousing) {
    for (const piglet of weaned) piglet.weanIntoNursery(day, config);
  }
  // They are through the suckling stage, so anything it still had booked against
  // them goes back on its slate, and they are re-booked by the stage they land in.
  for (const piglet of weaned) world.mortality.release(piglet);
  bookByStage(world, weaned, day);

  // The crate is free, and the weaner house has to take them full or not: a
  // litter whose days are up cannot stay on the sow because the next room is
  // busy. What it can do is overfill the room it lands in.
  world.housing.release("farrowing");
  world.housing.admit("weaner", weaned.length);

  // A weaned litter is a pen of pigs, and the pen is what the farm moves from
  // here on. Everything downstream — which house they are in, whether there is
  // room in the next one, and whether they may be sold — is asked of the batch.
  const penned = weaned.filter((piglet) => piglet.alive);
  if (penned.length > 0) world.batches.open(penned, penned[0].stage, "weaner", day);

  record.weaned += weaned.length;
  world.lifetime.weaned += weaned.length;
  world.emit("WeaningCompleted", sow.tag + " weaned " + weaned.length + " piglets", {
    entities: [sow.tag],
    cause,
    room: "weaner",
    changes: { weaned: weaned.length },
  });
  return weaned.length;
}

/**
 * Weans the oldest litter in the farrowing house to free a crate for a sow with
 * nowhere to farrow. Returns whether a crate came free.
 */
function weanEarlyForCrate(world: World): boolean {
  const { config } = world;
  const day = world.day;
  const floor = Math.min(MIN_EARLY_WEAN_AGE_DAYS, config.reproduction.weaningAgeDays);
  let oldest: Sow | null = null;
  let oldestAge = floor;
  for (const sow of world.sows) {
    if (!sow.alive || sow.state !== "lactating" || sow.weanDay === null) continue;
    const age = config.reproduction.weaningAgeDays - (sow.weanDay - day);
    if (age < oldestAge) continue;
    oldest = sow;
    oldestAge = age;
  }
  if (!oldest) return false;

  const weaned = wean(world, oldest, "a sow needed the crate");
  world.record.weanedEarlyForSpace += 1;
  world.lifetime.weanedEarlyForSpace += 1;
  world.emit(
    "WeanedEarlyForSpace",
    oldest.tag +
      " weaned " +
      weaned +
      " piglets at " +
      Math.round(oldestAge) +
      " days to free a farrowing crate",
    { entities: [oldest.tag], room: "farrowing", changes: { ageDays: Math.round(oldestAge) } },
  );
  return true;
}

/**
 * Books a set of pigs into whichever stage each has just landed in. They are
 * grouped first because a stage is charged on the whole lot arriving at once.
 */
export function bookByStage(world: World, pigs: readonly GrowingPig[], day: number): void {
  if (pigs.length === 0) return;
  const byStage = new Map<GrowingPig["stage"], GrowingPig[]>();
  for (const pig of pigs) {
    if (!pig.alive) continue;
    const group = byStage.get(pig.stage);
    if (group) group.push(pig);
    else byStage.set(pig.stage, [pig]);
  }
  for (const [stage, group] of byStage) world.mortality.enterStage(group, stage, day);
}

// ---------------------------------------------------------------- service

function runService(world: World, windows: boolean): void {
  const { config } = world;
  const day = world.day;
  const record = world.record;
  const windowDays = config.reproduction.serviceWindowDays;

  // ---- standing heats ------------------------------------------------------
  //
  // Every heat is spotted or it is not, and a heat nobody sees is a cycle of
  // feed with nothing at the end of it — which is why heat detection and
  // conception are two different rates, and a unit can be poor at one and
  // perfectly ordinary at the other.
  if (windows) {
    for (const sow of world.sows) {
      if (!sow.heatOpens(day)) continue;
      world.emit("EstrusExpected", sow.tag + " is due to stand", { entities: [sow.tag] });
      sow.heatDetected = world.variation.heatSpotted(
        config.reproduction.heatDetectionPct / 100,
        [sow.tag, day],
      );
      if (sow.heatDetected) {
        world.emit("EstrusDetected", sow.tag + " was seen standing", { entities: [sow.tag] });
      } else {
        world.lifetime.heatsUndetected += 1;
        record.heatsUndetected += 1;
        world.emit("EstrusMissed", sow.tag + " came into season unnoticed", {
          entities: [sow.tag],
          cause: "heat detection",
        });
      }
    }
  }

  const closeHeats = () => {
    if (!windows) return;
    for (const sow of world.sows) {
      if (!sow.heatCloses(day, windowDays)) continue;
      sow.missHeat();
      record.heatsMissed += 1;
      world.lifetime.heatsMissed += 1;
      world.emit(
        "ServiceOpportunityMissed",
        sow.tag + " went out of season unserved: next heat in three weeks",
        { entities: [sow.tag], cause: "no service inside the window" },
      );
    }
  };

  // Services are limited by the mates the farm can actually put to a sow: the
  // boars standing, plus bought-in semen if the plan buys any.
  const waiting = windows
    ? world.sows.filter((sow) => sow.inHeat(day, windowDays) && sow.heatDetected !== false)
    : world.sows.filter((sow) => sow.dueForService(day));

  if (waiting.length === 0) {
    closeHeats();
    return;
  }
  if (world.boars.length === 0 && !config.service.useAi) {
    world.lifetime.servicesMissedForBoarCapacity += waiting.length;
    if (day % 30 === 0) {
      world.emit(
        "ServiceOpportunityMissed",
        waiting.length + " sows are waiting: no boar on the farm",
        { cause: "no mate on the farm" },
      );
    }
    closeHeats();
    return;
  }

  let missed = 0;
  let missedForGenetics = 0;
  for (const sow of waiting) {
    const sire = pickSire(world, sow, day);
    if (!sire) {
      if (everyMateIsHerAncestor(world, sow)) missedForGenetics += 1;
      else missed += 1;
      continue;
    }
    if (sire.boar) {
      sire.boar.servicesThisWeek += 1;
      sire.boar.totalServices += 1;
    } else {
      record.aiServices += 1;
      world.lifetime.aiServices += 1;
      if (sire.fallback) world.lifetime.aiFallbackServices += 1;
      world.lifetime.aiCost += config.service.aiCostPerService;
      world.ledger.accrue("semen", config.service.aiCostPerService);
      world.breedingCosts.add("health", "breeding", config.service.aiCostPerService);
      sow.costs.add("health", "breeding", config.service.aiCostPerService);
      world.books.keepBreedingHerd(config.service.aiCostPerService);
    }
    world.lifetime.servicesAttempted += 1;
    record.services += 1;

    // Every figure this service needs is keyed to the sow and the day she was
    // served, so it is hers whatever else the farm did that morning.
    const served = [sow.tag, day];
    const held = world.variation.conceives(
      conceptionRate(world, sire.boar === null) / 100,
      served,
    );
    // Taken whether or not it is needed. A drawn plan no longer cares — a key is
    // not a place in a queue — but a settled one does: its shares come out
    // exactly only if every service asks.
    const irregular = world.variation.returnsIrregular(
      config.reproduction.irregularReturnSharePct,
      served,
    );
    sow.serve(day, held, world.variation.gestationDays(config.reproduction.gestationDays, served), sire.tag, {
      returnDays: world.variation.returnDays(irregular, served),
      irregular,
      scanDays: config.reproduction.pregnancyScanDays,
    });
    world.emit("ServiceCompleted", serviceLine(world, sow, sire), {
      entities: [sow.tag, sire.tag],
      changes: { parity: sow.parity + 1, byAi: sire.boar ? 0 : 1 },
    });
  }

  if (missed > 0) {
    world.lifetime.servicesMissedForBoarCapacity += missed;
    world.emit("ServiceAttempted", missed + " services deferred: boar capacity reached", {
      cause: "every boar had worked its week",
      changes: { services: missed },
    });
  }
  if (missedForGenetics > 0) {
    world.lifetime.servicesMissedForGenetics += missedForGenetics;
    world.emit(
      "ServiceAttempted",
      missedForGenetics + " females held over: the only boar standing is their sire",
      { cause: "relatedness", changes: { services: missedForGenetics } },
    );
  }

  // Whatever was not managed today, the window closes on the sows whose last day
  // it was, and they are not due again for three weeks.
  closeHeats();
}

/** The rate a service holds at, which AI may be better or worse at than a boar. */
function conceptionRate(world: World, byAi: boolean): number {
  const { reproduction, service } = world.config;
  if (!byAi) return reproduction.farrowingSuccessPct;
  return Math.min(100, Math.max(0, reproduction.farrowingSuccessPct + service.aiConceptionDeltaPct));
}

/** The mate this female is put to today, or null when the farm has none to give her. */
function pickSire(world: World, sow: Sow, day: number): Sire | null {
  const { service } = world.config;
  if (!service.useAi) {
    const boar = pickBoar(world, sow);
    return boar ? { tag: boar.tag, boar, fallback: false } : null;
  }
  if (world.variation.usesAi(service.aiSharePct, [sow.tag, day])) {
    const stud = pickStud(world, sow);
    if (stud) return { tag: stud, boar: null, fallback: false };
  }
  const boar = pickBoar(world, sow);
  if (boar) return { tag: boar.tag, boar, fallback: false };
  // Semen reached for because the farm had no boar to give her, rather than
  // because the plan asked for it. See {@link Sire}.
  const stud = pickStud(world, sow);
  return stud ? { tag: stud, boar: null, fallback: true } : null;
}

function pickStud(world: World, sow: Sow): string | null {
  const panel = Math.max(1, Math.round(world.config.service.aiStudPanelSize));
  for (let offset = 0; offset < panel; offset += 1) {
    const tag = studTag((world.studCursor + offset) % panel);
    if (sow.relatedTo(tag)) continue;
    world.studCursor = (world.studCursor + offset + 1) % panel;
    return tag;
  }
  return null;
}

function pickBoar(world: World, sow: Sow): Boar | null {
  const team = world.boars.filter((boar) => boar.alive);
  if (team.length === 0) return null;
  for (let offset = 0; offset < team.length; offset += 1) {
    const boar = team[(world.boarCursor + offset) % team.length];
    if (boar.servicesThisWeek >= SERVICES_PER_BOAR_PER_WEEK) continue;
    if (sow.relatedTo(boar.tag)) continue;
    world.boarCursor = (world.boarCursor + offset + 1) % team.length;
    return boar;
  }
  return null;
}

/** True when every mate the farm could offer this female is one of her sires. */
export function everyMateIsHerAncestor(world: World, sow: Sow): boolean {
  if (sow.sireLine.length === 0) return false;
  const team = world.boars.filter((boar) => boar.alive);
  if (team.length === 0 || !team.every((boar) => sow.relatedTo(boar.tag))) return false;
  if (!world.config.service.useAi) return true;
  return pickStud(world, sow) === null;
}

/** One service, written the way a service card reads. */
function serviceLine(world: World, sow: Sow, sire: Sire): string {
  const parity = "parity " + (sow.parity + 1);
  if (sire.boar) return sow.tag + " served by " + sire.tag + ", natural, " + parity;
  const { aiInseminationsPerService: doses, aiCostPerService } = world.config.service;
  return (
    sow.tag +
    " inseminated with " +
    sire.tag +
    ", AI " +
    doses +
    (doses === 1 ? " dose, " : " doses, ") +
    parity +
    ", " +
    aiCostPerService +
    " " +
    world.config.project.currency
  );
}
