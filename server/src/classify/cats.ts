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
const FETCH_TIMEOUT_MS = 10_000;
// 100 pages × 100 assets bounds a refresh at 10 000 CATs — far above the
// registry's real size, but keeps a misbehaving API from looping forever
const MAX_PAGES = 100;

export interface CatRegistryOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxPages?: number;
}

export class CatRegistry {
  private map = new Map<string, CatInfo>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private inflight: Promise<void> | null = null;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxPages: number;

  constructor(opts: CatRegistryOptions = {}) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? FETCH_TIMEOUT_MS;
    this.maxPages = opts.maxPages ?? MAX_PAGES;
  }

  async start(): Promise<void> {
    await this.refresh().catch((err) => log.warn({ err }, "cat registry initial load failed"));
    this.timer = setInterval(() => {
      this.refresh().catch((err) => log.warn({ err }, "cat registry refresh failed"));
    }, REFRESH_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
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
  }
}
