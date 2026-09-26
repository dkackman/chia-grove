import type { GroveEvent } from "@grove/shared";
import { log } from "../logger.js";

interface CatInfo {
  name: string;
  ticker: string;
  iconUrl: string;
}

interface DexieAsset {
  id: string;
  name: string | null;
  code: string | null;
}

const DEXIE_API = "https://api.dexie.space/v1";
const DEXIE_ICONS = "https://icons.dexie.space";
const REFRESH_MS = 60 * 60 * 1000;
// A failed load (Dexie timeout, 429, one bad page) otherwise leaves the
// registry empty until the next hourly refresh — and every CAT classified in
// that hour ships nameless. Retry on a doubling backoff instead.
const RETRY_BASE_MS = 15_000;
const RETRY_MAX_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;
// 100 pages × 100 assets bounds a refresh at 10 000 CATs — far above the
// registry's real size, but keeps a misbehaving API from looping forever
const MAX_PAGES = 100;

export interface CatRegistryOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxPages?: number;
  retryBaseMs?: number;
  retryMaxMs?: number;
  refreshMs?: number;
}

export class CatRegistry {
  private map = new Map<string, CatInfo>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private failures = 0;
  private stopped = false;
  private readonly loadListeners: Array<() => void> = [];
  private inflight: Promise<void> | null = null;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxPages: number;
  private readonly retryBaseMs: number;
  private readonly retryMaxMs: number;
  private readonly refreshMs: number;

  constructor(opts: CatRegistryOptions = {}) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? FETCH_TIMEOUT_MS;
    this.maxPages = opts.maxPages ?? MAX_PAGES;
    this.retryBaseMs = opts.retryBaseMs ?? RETRY_BASE_MS;
    this.retryMaxMs = opts.retryMaxMs ?? RETRY_MAX_MS;
    this.refreshMs = opts.refreshMs ?? REFRESH_MS;
  }

  /** Initial load, then hourly refreshes — or a quick backoff retry after a failure. */
  async start(): Promise<void> {
    this.stopped = false;
    await this.tick();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Called after every successful load (e.g. to backfill names into buffered events). */
  onLoad(fn: () => void): void {
    this.loadListeners.push(fn);
  }

  private async tick(): Promise<void> {
    let delay = this.refreshMs;
    try {
      await this.refresh();
      this.failures = 0;
    } catch (err) {
      delay = Math.min(this.retryMaxMs, this.retryBaseMs * 2 ** this.failures);
      this.failures++;
      log.warn({ err, retryInMs: delay, loaded: this.map.size }, "cat registry load failed");
    }
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.tick(), delay);
    this.timer.unref?.();
  }

  lookup(assetId: string): CatInfo | undefined {
    return this.map.get(assetId.toLowerCase());
  }

  /** Reload the registry; overlapping calls join the pass already in flight. */
  refresh(): Promise<void> {
    this.inflight ??= this.doRefresh().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async doRefresh(): Promise<void> {
    const next = new Map<string, CatInfo>();

    for (let page = 1; page <= this.maxPages; page++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      let data: { assets: DexieAsset[] };
      try {
        const res = await this.fetchImpl(
          `${DEXIE_API}/assets?page_size=100&page=${page}&type=cat`,
          {
            signal: controller.signal,
          }
        );
        if (!res.ok) throw new Error(`Dexie API ${res.status}`);
        data = (await res.json()) as { assets: DexieAsset[] };
      } finally {
        clearTimeout(timer);
      }
      if (!Array.isArray(data.assets) || data.assets.length === 0) break;

      for (const asset of data.assets) {
        if (asset.name && asset.code) {
          next.set(asset.id.toLowerCase(), {
            name: asset.name,
            ticker: asset.code,
            iconUrl: `${DEXIE_ICONS}/${asset.id}.webp`,
          });
        }
      }
      if (page === this.maxPages) {
        log.warn({ maxPages: this.maxPages }, "cat registry hit page cap; list may be truncated");
      }
    }

    this.map = next;
    log.info({ count: next.size }, "cat registry loaded");
    for (const fn of this.loadListeners) {
      try {
        fn();
      } catch (err) {
        log.warn({ err }, "cat registry load listener failed");
      }
    }
  }

  /**
   * Fill registry names into CAT spends that were classified without one
   * (while the registry was empty or before a CAT was listed). Mutates in
   * place; returns how many events were patched.
   */
  fillNames(events: Iterable<GroveEvent>): number {
    let patched = 0;
    for (const event of events) {
      if (event.type !== "sprout" || event.kind !== "cat" || event.catName || !event.assetId) {
        continue;
      }
      const info = this.lookup(event.assetId);
      if (!info) continue;
      event.catName = info.name;
      event.catTicker = info.ticker;
      event.catIconUrl = info.iconUrl;
      patched++;
    }
    return patched;
  }
}
