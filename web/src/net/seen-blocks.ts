import type { BlockEvent, GroveEvent } from "@grove/shared";

// How far below the newest dispatched height a block hash is remembered. The
// server's 10k-event snapshot spans far fewer blocks than this, so anything
// older can never reappear in a resync snapshot.
const MEMORY_BLOCKS = 4000;

/**
 * Remembers which blocks have already been dispatched (height → headerHash)
 * so a reconnect's Snapshot — the server's whole ring buffer, mostly events
 * this client already rendered — only lets through what is genuinely new.
 *
 * Dedupe is by header hash rather than a bare height watermark so a reorg that
 * happened while disconnected still lands: its replacement blocks reuse
 * already-seen heights but carry new hashes, and its ReorgEvent passes so the
 * theme culls the orphans first.
 *
 * Themes therefore never see a block, or that block's sprouts, twice.
 */
export class SeenBlocks {
  private readonly hashes = new Map<number, string>();
  private maxHeight = -1;

  /** Record an event as it is dispatched to listeners. */
  record(event: GroveEvent): void {
    if (event.type === "block") {
      this.hashes.set(event.height, event.headerHash);
      if (event.height > this.maxHeight) {
        this.maxHeight = event.height;
        this.prune();
      }
    } else if (event.type === "reorg") {
      for (const h of [...this.hashes.keys()]) if (h >= event.forkHeight) this.hashes.delete(h);
      this.maxHeight = -1;
      for (const h of this.hashes.keys()) if (h > this.maxHeight) this.maxHeight = h;
    }
  }

  /**
   * Drop the parts of a snapshot already dispatched: blocks whose hash is
   * known, their sprouts, and reorgs whose replacement chain was already
   * seen. Ambient and content-flag events always pass (they're idempotent
   * state updates). Pure with respect to `this` — `record()` still runs at
   * dispatch time for whatever survives.
   */
  filterSnapshot(events: GroveEvent[]): GroveEvent[] {
    if (this.hashes.size === 0) return events;
    // Pass 1 (right to left): a reorg was already applied iff the block that
    // follows it is one we've seen. Blocks *before* such a reorg at or above its
    // fork are orphans the client already culled, so they're dropped too —
    // `orphanFloor[i]` is the lowest such fork after index i.
    const applied = new Set<number>();
    const orphanFloor = new Array<number>(events.length);
    let floor = Infinity;
    let next: BlockEvent | undefined;
    for (let i = events.length - 1; i >= 0; i--) {
      orphanFloor[i] = floor;
      const e = events[i];
      if (e.type === "block") next = e;
      else if (e.type === "reorg" && next && this.hashes.get(next.height) === next.headerHash) {
        applied.add(i);
        floor = Math.min(floor, e.forkHeight);
      }
    }

    // Pass 2 (in order). Working copy: a reorg that passes must un-know the
    // heights it invalidates so its replacement blocks pass after it.
    const known = new Map(this.hashes);
    const passed = new Set<number>(); // heights whose block event passed in this snapshot
    const out: GroveEvent[] = [];
    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      switch (event.type) {
        case "block":
          if (event.height >= orphanFloor[i] || known.get(event.height) === event.headerHash) {
            passed.delete(event.height);
            continue;
          }
          known.set(event.height, event.headerHash);
          passed.add(event.height);
          out.push(event);
          break;
        case "sprout":
          if (event.height >= orphanFloor[i]) continue;
          // A sprout follows its block. Its block may have been evicted from
          // the ring buffer, so fall back to "is this height known at all".
          if (passed.has(event.height) || !known.has(event.height)) out.push(event);
          break;
        case "reorg":
          if (applied.has(i)) continue;
          for (const h of [...known.keys()]) if (h >= event.forkHeight) known.delete(h);
          for (const h of [...passed]) if (h >= event.forkHeight) passed.delete(h);
          out.push(event);
          break;
        default:
          out.push(event);
      }
    }
    return out;
  }

  private prune(): void {
    const floor = this.maxHeight - MEMORY_BLOCKS;
    if (this.hashes.size <= MEMORY_BLOCKS * 1.25) return;
    for (const h of [...this.hashes.keys()]) if (h < floor) this.hashes.delete(h);
  }
}
