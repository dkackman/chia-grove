import { FIELD } from "./layout.js";

/**
 * Which field row each block plows. Blocks take rows in serpentine order and
 * wrap after `FIELD.rows`; the planner remembers which height owns each row so
 * a reorg can rewind onto the rows it invalidated (replacement blocks re-plow
 * them instead of leaving dead rows behind) and the crows know where to fly.
 *
 * Pure bookkeeping — no Three.js — so it is unit-tested directly.
 */
export class RowPlanner {
  private blockIndex = 0;
  /** height → row, for the blocks whose crops still stand in the field */
  private readonly rowOf = new Map<number, number>();
  private current = 0;

  constructor(private readonly rows: number = FIELD.rows) {}

  /** The row the most recent block plowed (sprouts plant here). */
  get currentRow(): number {
    return this.current;
  }

  /** Total rows allocated so far (after rewinds). */
  get allocated(): number {
    return this.blockIndex;
  }

  /** Allocate the next row for the block at `height`. Whatever block owned that
   *  row before is forgotten — the caller clears its crops. */
  next(height: number): number {
    const row = this.blockIndex % this.rows;
    this.blockIndex += 1;
    for (const [h, r] of this.rowOf) if (r === row) this.rowOf.delete(h);
    this.rowOf.set(height, row);
    this.current = row;
    return row;
  }

  rowOfHeight(height: number): number | undefined {
    return this.rowOf.get(height);
  }

  /**
   * Reorg: forget every block at or above `forkHeight` (the first invalidated
   * height; 0 means everything) and rewind so the replacement blocks reuse
   * those rows. Returns the rows that were invalidated, newest first.
   */
  rewind(forkHeight: number): number[] {
    const removed: Array<[height: number, row: number]> = [];
    for (const [h, r] of this.rowOf) if (h >= forkHeight) removed.push([h, r]);
    for (const [h] of removed) this.rowOf.delete(h);
    removed.sort((a, b) => b[0] - a[0]);
    if (forkHeight <= 0) {
      this.blockIndex = 0;
      this.current = 0;
    } else {
      this.blockIndex = Math.max(0, this.blockIndex - removed.length);
      this.current = this.blockIndex > 0 ? (this.blockIndex - 1) % this.rows : 0;
    }
    return removed.map(([, r]) => r);
  }

  /** The last `n` rows plowed, newest first, wrapping modulo the field. */
  recentRows(n: number): number[] {
    const count = Math.min(n, this.blockIndex, this.rows);
    const out: number[] = [];
    for (let i = 0; i < count; i++) {
      out.push((((this.blockIndex - 1 - i) % this.rows) + this.rows) % this.rows);
    }
    return out;
  }
}

/**
 * The stretch of `rows` (newest first) the crows sweep: the newest row plus
 * every row adjacent to it in the list. A band that wraps from row 0 back to
 * row 47 would otherwise span the whole field, so it stops at the wrap.
 */
export function contiguousBand(rows: number[]): number[] {
  if (rows.length === 0) return [];
  const sorted = [...new Set(rows)].sort((a, b) => a - b);
  const start = sorted.indexOf(rows[0]);
  let lo = start;
  let hi = start;
  while (lo > 0 && sorted[lo - 1] === sorted[lo] - 1) lo--;
  while (hi < sorted.length - 1 && sorted[hi + 1] === sorted[hi] + 1) hi++;
  return sorted.slice(lo, hi + 1);
}

/** Blocks older than this when they arrive are snapshot history, not news. */
export const REPLAY_AGE_SECONDS = 120;

/**
 * Whether a block is being replayed from the reconnect snapshot rather than
 * arriving live: its timestamp (unix seconds) is more than
 * `REPLAY_AGE_SECONDS` before `nowMs`. Replayed blocks skip their fanfare
 * (tractor pass, hens, gust) and simply appear already plowed.
 */
export function isReplayBlock(timestampSeconds: number, nowMs: number): boolean {
  return timestampSeconds * 1000 < nowMs - REPLAY_AGE_SECONDS * 1000;
}

/** Seconds since a block's timestamp, never negative (clock skew). */
export function blockAgeSeconds(timestampSeconds: number, nowMs: number): number {
  return Math.max(0, nowMs / 1000 - timestampSeconds);
}
