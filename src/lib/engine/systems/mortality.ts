import { Boar, GrowingPig, Sow } from "../../sim/animals";
import { roomForStage } from "../housing";
import type { World } from "../world";

/**
 * The mortality system: carrying out the losses the scheduler has booked.
 *
 * Nothing is rolled here. Deaths are placed in advance, when a cohort enters a
 * stage, and this only settles the ones whose day has come — plus whatever the
 * crowding system booked for today. Keeping the placing and the carrying-out
 * apart is what lets an overcrowded room raise the risk without the losses
 * turning into a coin flip per pig per morning.
 */

/**
 * A pig that dies still ate. Its bill goes onto the pigs that did reach the
 * abattoir, because that is what producing them actually cost — a replacement
 * gilt's loss is already carried by the breeding herd instead.
 */
function absorbLoss(world: World, pig: GrowingPig): void {
  if (pig.destination === "market") world.soldPigCosts.absorb(pig.costs);
}

export function runMortality(world: World): void {
  const day = world.day;
  const record = world.record;

  for (const pig of world.pigs) {
    if (!pig.alive) continue;
    if (!world.mortality.isDue(pig, day)) continue;
    world.mortality.settle(pig);
    world.housing.release(roomForStage(pig.stage));
    world.batches.remove(pig);
    pig.leave(day, "died");
    absorbLoss(world, pig);
    world.noteExit(pig.generation, false);
    if (pig.stage === "piglet") record.pigletDeaths += 1;
    else record.growingDeaths += 1;
  }
  world.lifetime.pigletDeaths += record.pigletDeaths;
  world.lifetime.growingDeaths += record.growingDeaths;
  const pigDeaths = record.pigletDeaths + record.growingDeaths;
  if (pigDeaths > 0) {
    world.emit(
      "PigDied",
      pigDeaths + " pigs lost (" + record.pigletDeaths + " pre-weaning)",
      { changes: { pigs: pigDeaths, preWeaning: record.pigletDeaths } },
    );
  }

  // Sows and boars carry one risk between them, so they go to the scheduler
  // together. It knows how long each of them has stood, which is what settles
  // who goes rather than simply who is frailest on paper.
  const breeders: (Sow | Boar)[] = [
    ...world.sows.filter((sow) => sow.alive),
    ...world.boars.filter((boar) => boar.alive),
  ];
  const doomed = new Set<Sow | Boar>(world.mortality.claimBreedingDeaths(breeders));

  for (const boar of world.boars) {
    if (!doomed.has(boar)) continue;
    boar.leave(day, "died");
    record.breedingDeaths += 1;
    world.emit("PigDied", boar.tag + " died", { entities: [boar.tag] });
  }

  for (const sow of world.sows) {
    if (!doomed.has(sow)) continue;
    const wasLactating = sow.state === "lactating";
    sow.leave(day, "died");
    if (wasLactating) world.housing.release("farrowing");
    world.noteExit(sow.generation, false);
    record.breedingDeaths += 1;
    world.emit("PigDied", sow.tag + " died (parity " + sow.parity + ")", {
      entities: [sow.tag],
      changes: { parity: sow.parity },
    });
    if (sow.litter.length === 0) continue;

    // Orphans go onto another nursing sow when one is available.
    const foster = world.sows.find(
      (candidate) => candidate.alive && candidate !== sow && candidate.state === "lactating",
    );
    const orphans = sow.litter.filter((piglet) => piglet.alive);
    if (foster) {
      for (const piglet of orphans) foster.litter.push(piglet);
      world.emit(
        "WeaningCompleted",
        orphans.length + " orphaned piglets fostered onto " + foster.tag,
        { entities: [foster.tag], cause: "their dam died", room: "farrowing" },
      );
    } else {
      for (const piglet of orphans) {
        world.batches.remove(piglet);
        piglet.leave(day, "died");
        absorbLoss(world, piglet);
        world.noteExit(piglet.generation, false);
      }
      record.pigletDeaths += orphans.length;
      world.lifetime.pigletDeaths += orphans.length;
    }
    sow.litter = [];
  }
  world.lifetime.breedingDeaths += record.breedingDeaths;
}
