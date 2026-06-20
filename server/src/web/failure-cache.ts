/**
 * Bounded TTL set of recently-failed keys. The image proxy uses it to remember
 * NFTs whose art fetch just failed — dead DNS (decommissioned gateways),
 * unpinned IPFS CIDs that hang, deprecated gateways — so it can short-circuit
 * instead of re-incurring the upstream stall on every viewer and every snapshot
 * replay. Entries expire after `ttlMs`; the set is capped (oldest evicted) so it
 * can't grow without bound. The clock is injectable for testing.
 */
export class FailureCache {
  private readonly map = new Map<string, number>(); // key → expiry timestamp

  constructor(
    private readonly ttlMs: number,
    private readonly capacity: number,
    private readonly now: () => number = Date.now
  ) {}

  mark(key: string): void {
    this.map.delete(key); // re-insert moves the key to newest
    this.map.set(key, this.now() + this.ttlMs);
    if (this.map.size > this.capacity) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
  }

  has(key: string): boolean {
    const expiry = this.map.get(key);
    if (expiry === undefined) return false;
    if (expiry <= this.now()) {
      this.map.delete(key); // lazily drop a stale entry we happened to touch
      return false;
    }
    return true;
  }

  sweep(): void {
    const t = this.now();
    for (const [key, expiry] of this.map) {
      if (expiry <= t) this.map.delete(key);
    }
  }
}
