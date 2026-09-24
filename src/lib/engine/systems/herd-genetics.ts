import type { World } from "../world";
import { everyMateIsHerAncestor } from "./reproduction";

export { breedingStrength } from "./growth";

/**
 * True when some breeding female on the farm — in the herd or growing towards it
 * — would have no mate but her own sire. That is the point at which a closed
 * herd has to stand a second, unrelated boar.
 */
export function everyMateNeedsABoar(world: World): boolean {
  // Capacity scaling is handled separately. For a purely genetic block, a farm
  // that already buys semen uses an unrelated stud dose rather than standing an
  // extra boar solely because one female is related to the whole on-farm team.
  if (world.config.service.useAi) return false;
  const team = world.boars.filter((boar) => boar.alive);
  if (team.length === 0) return false;
  const blocked = (female: { sireLine: readonly string[]; relatedTo(tag: string): boolean }) =>
    female.sireLine.length > 0 && team.every((boar) => female.relatedTo(boar.tag));
  for (const sow of world.sows) if (sow.alive && blocked(sow)) return true;
  // Only gilts already on the developer ration count. Buying a boar the day a
  // weaner is picked out would stand him — and feed him — for half a year before
  // the first of those females is old enough to serve.
  for (const pig of world.pigs) {
    if (pig.alive && pig.stage === "gilt" && blocked(pig)) return true;
  }
  return false;
}

export { everyMateIsHerAncestor };
