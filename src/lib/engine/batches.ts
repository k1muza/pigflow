import type { GrowingPig, PigStage } from "../sim/animals";
import type { RoomId } from "./housing";

/**
 * The batch: what the farm actually moves.
 *
 * Pigs are not moved one at a time on a real unit and they are not moved one at
 * a time here. A pen of weaners goes to the grower house together, and the thing
 * that is given a place is the group rather than the animal. Moving individuals
 * looked harmless and was not: the loop reached pigs in whatever order they sat
 * in the herd array, so a room with three places took the first three pigs it
 * happened to touch and left their pen mates behind, anonymously and for no
 * reason anybody could name afterwards.
 *
 * When a room has room for some of a batch but not all of it, the batch is
 * **split**, and the split is a real event with a record: a child batch goes
 * forward, a child batch stays, and both remember what they came from. Strict
 * all-or-nothing movement was the other option and it deadlocks — a batch bigger
 * than the room it is headed for would wait for a place that can never exist.
 *
 * A batch carries its own history because the questions worth asking are about
 * the group: how long it waited, which room it waited in, what it was part of
 * before it was split off. None of that survives if the unit of movement is a
 * pig.
 */

/** Where a batch has been, and from when. */
export type Stay = { room: RoomId | null; from: number };

export type Batch = {
  id: string;
  /** The batch this one was split off, if it was. */
  parentId: string | null;
  /** The room it is standing in, which is null while it is still on the sow. */
  room: RoomId | null;
  stage: PigStage;
  /** The birth days its members span, which widen when batches are merged. */
  bornFrom: number;
  bornTo: number;
  /** The day it entered the room it is in — what its wait is measured from. */
  enteredDay: number;
  /** Every room it has stood in, in order. */
  history: Stay[];
  /** Tags, because a batch outlives any particular array of pigs. */
  members: Set<string>;
  /** Last day this batch was counted as blocked, so a wait is one event. */
  heldNotedDay?: number;
};

/**
 * Every batch on the farm, and the index from a pig to the batch it is in.
 *
 * Membership is held here rather than on the animal so that the 1.x farm, which
 * shares the animal classes and knows nothing about batches, is untouched by any
 * of it.
 */
export class Batches {
  private readonly batches = new Map<string, Batch>();
  /** Pig tag to batch id. */
  private readonly membership = new Map<string, string>();
  private sequence = 0;

  /** Opens a batch for a set of pigs that are being penned together. */
  open(members: readonly GrowingPig[], stage: PigStage, room: RoomId | null, day: number): Batch | null {
    if (members.length === 0) return null;
    this.sequence += 1;
    const batch: Batch = {
      id: "B" + this.sequence,
      parentId: null,
      room,
      stage,
      bornFrom: Math.min(...members.map((pig) => pig.birthDay)),
      bornTo: Math.max(...members.map((pig) => pig.birthDay)),
      enteredDay: day,
      history: [{ room, from: day }],
      members: new Set(members.map((pig) => pig.tag)),
    };
    this.batches.set(batch.id, batch);
    for (const pig of members) this.membership.set(pig.tag, batch.id);
    return batch;
  }

  get(id: string): Batch | undefined {
    return this.batches.get(id);
  }

  batchOf(pig: GrowingPig): Batch | undefined {
    const id = this.membership.get(pig.tag);
    return id === undefined ? undefined : this.batches.get(id);
  }

  /** Every batch still holding somebody, oldest first so a plan reads in order. */
  all(): Batch[] {
    return [...this.batches.values()].filter((batch) => batch.members.size > 0);
  }

  /** The pigs of a batch that are still alive, in herd order. */
  membersOf(batch: Batch, herd: readonly GrowingPig[]): GrowingPig[] {
    return herd.filter((pig) => pig.alive && batch.members.has(pig.tag));
  }

  /**
   * Takes a pig out of whatever batch it is in — it died, it was sold, or it was
   * picked out to breed and is not a market animal any more.
   */
  remove(pig: GrowingPig): void {
    const id = this.membership.get(pig.tag);
    if (id === undefined) return;
    this.membership.delete(pig.tag);
    const batch = this.batches.get(id);
    if (!batch) return;
    batch.members.delete(pig.tag);
    if (batch.members.size === 0) this.batches.delete(id);
  }

  /**
   * Splits a batch: the named pigs are moved into a child batch, the rest stay
   * in another. Both children name the batch they came from, and both start
   * their own clock in whatever room they end up in.
   *
   * The parent is retired rather than kept, because a batch is a pen of pigs
   * standing somewhere and after a split there is no such pen — there are two.
   */
  split(batch: Batch, leaving: readonly GrowingPig[]): { moved: Batch; stayed: Batch | null } {
    const going = new Set(leaving.map((pig) => pig.tag));
    const remaining = [...batch.members].filter((tag) => !going.has(tag));

    const moved = this.child(batch, leaving.map((pig) => pig.tag));
    const stayed = remaining.length > 0 ? this.child(batch, remaining) : null;
    // The pen it was is gone; what is left is the two it became.
    this.batches.delete(batch.id);
    return { moved, stayed };
  }

  /** One side of a split, carrying the parent's identity and birth range forward. */
  private child(parent: Batch, tags: readonly string[]): Batch {
    this.sequence += 1;
    const batch: Batch = {
      id: "B" + this.sequence,
      // A split off a split names the batch it actually came out of, so the
      // chain back to the pen the pigs were weaned into is walkable.
      parentId: parent.id,
      room: parent.room,
      stage: parent.stage,
      bornFrom: parent.bornFrom,
      bornTo: parent.bornTo,
      enteredDay: parent.enteredDay,
      history: [...parent.history],
      members: new Set(tags),
    };
    this.batches.set(batch.id, batch);
    for (const tag of tags) this.membership.set(tag, batch.id);
    return batch;
  }

  /** Records a batch arriving in a room: its clock restarts and its history grows. */
  moveTo(batch: Batch, room: RoomId | null, stage: PigStage, day: number): void {
    batch.room = room;
    batch.stage = stage;
    batch.enteredDay = day;
    batch.history.push({ room, from: day });
  }

  /** Days this batch has been standing where it is. */
  heldDays(batch: Batch, day: number): number {
    return Math.max(0, day - batch.enteredDay);
  }
}
