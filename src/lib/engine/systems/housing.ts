import { maturityFactor } from "../../growth-curve";
import { partialRisk, stageDurationDays, stageMortalityRate } from "../../sim/mortality";
import type { PigStage } from "../../sim/animals";
import { ROOM_IDS, roomForStage } from "../housing";
import { emptyRooms, type World } from "../world";

/**
 * The housing system: who is standing where, and what being over the places
 * costs.
 *
 * Occupancy is taken afresh each morning from the herd itself rather than kept
 * up by hand through births, deaths, sales and promotions — one missed decrement
 * in any of those and the farm would be refusing a movement into a room that was
 * actually empty. Moves granted during the day are counted against that census.
 *
 * The stocking a pig's day is judged on is the stocking of the room it slept in,
 * fixed here before anything moves. A pig does not grow at the rate a room
 * happens to be at once it has emptied out in the afternoon.
 */
export function runHousingCensus(world: World): void {
  const occupants = emptyRooms();
  for (const sow of world.sows) {
    if (sow.alive && sow.state === "lactating") occupants.farrowing += 1;
  }
  for (const pig of world.pigs) {
    if (!pig.alive) continue;
    const room = roomForStage(pig.stage);
    // A suckler is in its dam's crate, and the crate is already counted.
    if (room === null || room === "farrowing") continue;
    occupants[room] += 1;
  }

  world.housing.openDay(world.day, occupants);
  world.record.occupancy = { ...occupants };

  for (const room of ROOM_IDS) {
    const over = Math.max(0, occupants[room] - world.housing.places[room]);
    if (over <= 0) continue;
    world.record.animalDaysOverCapacity += over;
    world.lifetime.animalDaysOverCapacity += over;
  }
  if (world.housing.enforced && world.record.animalDaysOverCapacity > 0) {
    world.emit(
      "RoomOverCapacity",
      world.record.animalDaysOverCapacity + " animal-days over the places today",
      {
        cause: "movements held back for want of space downstream",
        changes: { ...occupants },
      },
    );
  }

  // Every pig carries what today will do to its growth: the room it is standing
  // in, and how near it is to the size it finishes at. All three are set every
  // morning — a factor left over from yesterday would be a penalty applied
  // twice — and this is the one place a day's growth factors are fixed, which is
  // why the maturity curve is settled here and not down in the growth system:
  // the herd is fed before it grows, and feed is priced off the gain a pig is
  // going to make.
  const plateau = world.policies.matureGrowthCurve;
  for (const pig of world.pigs) {
    if (!pig.alive) continue;
    pig.crowdingFactor = world.housing.gainFactor(roomForStage(pig.stage));
    pig.maturityFactor = plateau ? maturityFactor(pig.weightKg, world.config.growth) : 1;
    pig.intakeFactor = 1;
  }
}

/**
 * The extra losses an overcrowded room takes, over and above the plan's own
 * stage rates.
 *
 * It is charged against the stage as a whole rather than rolled per pig, so a
 * room a tenth over its places does not have to kill a tenth of an animal to
 * have cost the farm anything — the same carried-fraction arithmetic the rest of
 * the mortality scheduler runs on, which is also what keeps it working in
 * settled mode where there are no dice to roll.
 */
export function runCrowdingStress(world: World): void {
  if (!world.housing.enforced || !world.housing.underPressure) return;
  const stages: PigStage[] = ["piglet", "weaner", "grower", "finisher"];
  let booked = 0;
  for (const stage of stages) {
    const room = roomForStage(stage);
    const factor = world.housing.mortalityFactor(room);
    if (factor <= 1) continue;
    const members = world.pigs.filter((pig) => pig.alive && pig.stage === stage);
    if (members.length === 0) continue;
    const rate = stageMortalityRate(stage, world.config);
    const days = Math.max(1, stageDurationDays(stage, world.config));
    const perDay = partialRisk(rate, 1 / days);
    booked += world.mortality.chargeStress(stage, members, perDay * (factor - 1), world.day);
  }
  if (booked <= 0) return;
  world.record.crowdingDeaths += booked;
  world.lifetime.crowdingDeaths += booked;
  // Booked, not carried out. The mortality system settles these later the same
  // morning and announces them there, so this says only that the stocking put
  // them on the slate and how many. A death is reported once, by whichever
  // system actually took the animal out of the herd; emitting PigDied here as
  // well read fine in the log and double-counted every crowding loss for
  // anything folding over the events.
  world.emit(
    "CrowdingDeathsScheduled",
    booked + (booked === 1 ? " loss" : " losses") + " booked against overcrowding",
    { cause: "stocking density", changes: { pigs: booked } },
  );
}
