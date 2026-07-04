/**
 * A `Map` with a fixed maximum entry count. When `set` would push the size past
 * `capacity`, the oldest key (by insertion order) is evicted. Re-inserting an
 * existing key refreshes its recency, so it moves to the newest position; a plain
 * `get` does NOT — this is insertion-order eviction, not access-order LRU, which
 * matches how the callers (launcherId → media/verdict/expiry caches) use it.
 *
 * Consolidates the identical hand-rolled `delete`-then-`set` + `keys().next()`
 * eviction that MediaIndex, ContentFilter, and SafeSearchWorker each repeated.
 * Deliberately dependency-free so content-filter stays liftable.
 */
export class BoundedMap<K, V> {
  private readonly map = new Map<K, V>();

  constructor(private readonly capacity: number) {}

  get(key: K): V | undefined {
    return this.map.get(key);
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  set(key: K, value: V): void {
    this.map.delete(key); // re-insert moves the key to newest
    this.map.set(key, value);
    if (this.map.size > this.capacity) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
  }

  delete(key: K): void {
    this.map.delete(key);
  }

  get size(): number {
    return this.map.size;
  }
}
