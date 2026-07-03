/**
 * Bounded per-key (typically per-IP) sliding-window request-rate gate: allows
 * at most `maxPerWindow` calls to `limited(key)` within a rolling `windowMs`
 * window before rejecting. The clock is injectable for testing.
 */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly windowMs: number,
    private readonly maxPerWindow: number,
    private readonly now: () => number = Date.now
  ) {}

  /** Records a hit for `key`; returns true if this hit should be rejected. */
  limited(key: string): boolean {
    const t = this.now();
    const recent = (this.hits.get(key) ?? []).filter((h) => t - h < this.windowMs);
    if (recent.length >= this.maxPerWindow) {
      this.hits.set(key, recent);
      return true;
    }
    recent.push(t);
    this.hits.set(key, recent);
    return false;
  }

  /** Drops stale buckets so the map can't grow without bound. Call periodically. */
  sweep(): void {
    const t = this.now();
    for (const [key, hits] of this.hits) {
      const recent = hits.filter((h) => t - h < this.windowMs);
      if (recent.length === 0) this.hits.delete(key);
      else this.hits.set(key, recent);
    }
  }
}
