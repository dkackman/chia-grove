/**
 * Block bookkeeping for the grove: which spiral slot each block occupies (so a
 * reorg can rewind the spiral to the fork) and whether a block is replayed
 * history (snapshot) rather than live. Pure — no Three.js.
 */

/** A block older than this (by its own timestamp) is replayed history. */
export const REPLAY_SECONDS = 120;

/**
 * True when a block is history being replayed (snapshot on connect), not a
 * live arrival: its fanfare (ripple, aurora, fireflies, gust) is skipped so a
 * connect doesn't fire hundreds of celebrations in a row.
 */
export function isReplayed(timestamp: number, nowSec: number): boolean {
  return Number.isFinite(timestamp) && timestamp > 0 && nowSec - timestamp > REPLAY_SECONDS;
}

interface Placed {
  height: number;
  slot: number;
  timestamp: number;
}

/** Spiral slot assignment: blocks take consecutive slots, wrapping at `slots`. */
export class BlockSlots {
  private next = 0;
  private readonly placed: Placed[] = [];

  constructor(readonly slots: number) {}

  /** Assign the next slot to a block at `height`; returns the slot. */
  place(height: number, timestamp = NaN): number {
    const slot = this.next;
    this.next = (this.next + 1) % this.slots;
    this.placed.push({ height, slot, timestamp });
    // only the last lap can still be rewound into
    if (this.placed.length > this.slots) this.placed.shift();
    return slot;
  }

  /** Slot of the newest placed block, or -1 when none remain. */
  current(): number {
    return this.placed.length ? this.placed[this.placed.length - 1].slot : -1;
  }

  /** Timestamp (unix s) of the newest placed block, NaN when none remain. */
  currentTimestamp(): number {
    return this.placed.length ? this.placed[this.placed.length - 1].timestamp : NaN;
  }

  /** Height of the newest placed block, or -1 when none remain. */
  currentHeight(): number {
    return this.placed.length ? this.placed[this.placed.length - 1].height : -1;
  }

  /**
   * Reorg: forget every block with `height >= forkHeight` and rewind so the
   * replacement chain grows from the first removed slot. Returns how many
   * blocks were removed.
   */
  rewind(forkHeight: number): number {
    let first = this.placed.length;
    while (first > 0 && this.placed[first - 1].height >= forkHeight) first--;
    const removed = this.placed.length - first;
    if (removed === 0) return 0;
    this.next = this.placed[first].slot;
    this.placed.length = first;
    return removed;
  }
}
