/**
 * Bounded byte-budgeted LRU of buffered small proxy responses. The image proxy
 * fills it with sanitized image bodies (already past SSRF validation,
 * safeContentType, and the byte cap) keyed by `img:`/`thumb:` + launcherId, so a
 * body fetched once is served to every later viewer and snapshot replay without
 * re-hitting upstream. Pure storage: no fetching, no TTL — launcherId → art bytes
 * is immutable, so a stale entry is never wrong, only eventually evicted. Total
 * stored bytes are held at or below `budgetBytes`; oldest entries evict first.
 */
export interface CachedResponse {
  body: Buffer;
  contentType: string; // already normalized by safeContentType
}

export class MediaCache {
  private readonly map = new Map<string, CachedResponse>();
  private bytes = 0;

  constructor(private readonly budgetBytes: number) {}

  get(key: string): CachedResponse | undefined {
    const resp = this.map.get(key);
    if (resp === undefined) return undefined;
    this.map.delete(key); // re-insert moves the key to newest (LRU recency)
    this.map.set(key, resp);
    return resp;
  }

  set(key: string, resp: CachedResponse): void {
    if (resp.body.length > this.budgetBytes) return; // can never fit — store nothing, evict nothing
    const existing = this.map.get(key);
    if (existing !== undefined) {
      this.bytes -= existing.body.length;
      this.map.delete(key);
    }
    this.map.set(key, resp);
    this.bytes += resp.body.length;
    while (this.bytes > this.budgetBytes) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.bytes -= this.map.get(oldest)!.body.length;
      this.map.delete(oldest);
    }
  }
}
