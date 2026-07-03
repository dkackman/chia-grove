/**
 * Bounded TTL set of recently-failed keys with exponential backoff. The image
 * proxy uses it to remember NFTs whose art fetch just failed — dead DNS
 * (decommissioned gateways), unpinned IPFS CIDs that hang, deprecated gateways —
 * so it can short-circuit instead of re-incurring the upstream stall on every
 * viewer and every snapshot replay.
 *
 * A single flat TTL forces a bad trade-off: long enough to spare a dead endpoint
 * (10 min) also blanks a merely-slow one that briefly tripped the timeout for
 * that whole window. Backoff separates the two — the first failure blocks for
 * only `baseTtlMs`, and each consecutive failure doubles the wait up to
 * `maxTtlMs`, so a transient hiccup recovers fast while a persistently-dead
 * target quickly climbs to the ceiling. A streak resets after `resetAfterMs`
 * of quiet, or immediately when `clear()` is called on a successful load.
 *
 * With the defaults (`maxTtlMs = baseTtlMs`) there is no backoff and this behaves
 * exactly like a flat TTL cache. The clock is injectable for testing.
 */
interface Entry {
  count: number; // consecutive failures — drives the backoff exponent
  retryAt: number; // short-circuit until this timestamp
  last: number; // last mark time — for streak reset + eviction ordering
}

export class FailureCache {
  private readonly map = new Map<string, Entry>();

  constructor(
    private readonly baseTtlMs: number,
    private readonly capacity: number,
    private readonly now: () => number = Date.now,
    private readonly maxTtlMs: number = baseTtlMs,
    private readonly resetAfterMs: number = maxTtlMs
  ) {}

  mark(key: string): void {
    const t = this.now();
    const prev = this.map.get(key);
    // Continue the streak only if the previous failure was recent; a failure
    // after a long quiet spell starts over at the base delay.
    const count = prev && t - prev.last <= this.resetAfterMs ? prev.count + 1 : 1;
    const ttl = Math.min(this.baseTtlMs * 2 ** (count - 1), this.maxTtlMs);
    this.map.delete(key); // re-insert moves the key to newest
    this.map.set(key, { count, retryAt: t + ttl, last: t });
    if (this.map.size > this.capacity) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
  }

  /** Forget a key outright — called when its fetch finally succeeds so the next
   * failure starts a fresh backoff streak rather than inheriting the old one. */
  clear(key: string): void {
    this.map.delete(key);
  }

  has(key: string): boolean {
    const entry = this.map.get(key);
    if (entry === undefined) return false;
    // Past retryAt the block is open (allow a retry), but keep the entry so a
    // renewed failure keeps climbing the backoff instead of restarting at base.
    return entry.retryAt > this.now();
  }

  sweep(): void {
    const t = this.now();
    for (const [key, entry] of this.map) {
      if (t - entry.last > this.resetAfterMs) this.map.delete(key);
    }
  }
}
