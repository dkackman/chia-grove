import type { ContentFlagEvent, GroveEvent, SproutEvent } from "@grove/shared";
import type { MediaIndex } from "../web/media-index.js";
import type { Verdict } from "./types.js";
import { mapMintgardenSignals } from "./signals/mintgarden.js";
import type { ContentStore } from "./store.js";
import { SafeSearchWorker } from "./safesearch-worker.js";

export type { Disposition } from "./types.js";
export { mapMintgarden, mapMintgardenSignals } from "./signals/mintgarden.js";
export type { MapMintgardenOpts } from "./signals/mintgarden.js";
export type { StoredVerdict } from "./store.js";

const OK: Verdict = { disposition: "ok", signals: [] };

export interface ContentFilterOptions {
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
  concurrency?: number;
  cacheCapacity?: number;
  /** Max wall time enrich() will block a block's publish on lookups (0 = unbounded). */
  enrichBudgetMs?: number;
  /** How long a failed/timed-out lookup stays negatively cached as "ok" (0 = no negative cache). */
  failTtlMs?: number;
  /** Clock injection point for testing the negative-cache TTL. */
  now?: () => number;
  /** Persistent verdict store keyed by launcherId; a hit skips the MintGarden network fetch. */
  store?: ContentStore;
  /** Google Vision API key; enables out-of-band SafeSearch when combined with store + onFlag. */
  googleApiKey?: string;
  /** Called when SafeSearch promotes an NFT to sensitive/blocked after the sprout was streamed. */
  onFlag?: (e: ContentFlagEvent) => void;
}

/**
 * Enriches NFT sprout events with a `mediaFilter` flag by resolving each NFT's
 * disposition from MintGarden. Successful determinations are cached per nftId
 * (sensitivity is stable per NFT) behind a bounded concurrency gate with a
 * per-request timeout. Blocked NFTs also have their MediaIndex entry dropped so
 * /img cannot serve the bytes (defense in depth, independent of the client flag).
 *
 * Liveness is bounded so a slow/unavailable MintGarden can't stall the whole
 * ingest pipeline (enrich() runs inline in the block walk):
 *   - enrich() blocks at most `enrichBudgetMs`; lookups still running past the
 *     budget keep going in the background to warm the cache, and their events
 *     publish permissive ("ok") for now — the next spend of that NFT picks up the
 *     resolved disposition.
 *   - A failure or timeout is permissive AND negatively cached for `failTtlMs`,
 *     so an outage doesn't re-stall every block with the same doomed lookups.
 *   - Only HTTP 404 (genuinely unknown to MintGarden) is positively cached as
 *     "ok"; 5xx/429 throw and fall through to the short-lived negative cache
 *     rather than poisoning the cache with a permanent "ok".
 */
export class ContentFilter {
  private readonly cache = new Map<string, Verdict>();
  /** nftId -> epoch ms until which a recent failure keeps it permissive without refetch */
  private readonly negativeUntil = new Map<string, number>();
  private readonly inflight = new Map<string, Promise<Verdict>>();
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly concurrency: number;
  private readonly cacheCapacity: number;
  private readonly enrichBudgetMs: number;
  private readonly failTtlMs: number;
  private readonly now: () => number;
  private readonly store?: ContentStore;
  private readonly worker?: SafeSearchWorker;
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(
    private readonly media: MediaIndex,
    opts: ContentFilterOptions = {}
  ) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.baseUrl = opts.baseUrl ?? "https://api.mintgarden.io";
    this.timeoutMs = opts.timeoutMs ?? 4000;
    this.concurrency = opts.concurrency ?? 4;
    this.cacheCapacity = opts.cacheCapacity ?? 10000;
    this.enrichBudgetMs = opts.enrichBudgetMs ?? 1500;
    this.failTtlMs = opts.failTtlMs ?? 60000;
    this.now = opts.now ?? Date.now;
    this.store = opts.store;
    if (opts.store && opts.googleApiKey && opts.onFlag) {
      this.worker = new SafeSearchWorker({
        media,
        store: opts.store,
        apiKey: opts.googleApiKey,
        onFlag: opts.onFlag,
        fetchImpl: opts.fetchImpl,
      });
    }
  }

  async enrich(events: GroveEvent[]): Promise<void> {
    const nfts = events.filter(
      (e): e is SproutEvent =>
        e.type === "sprout" && e.kind === "nft" && typeof e.nftId === "string"
    );
    if (nfts.length === 0) return;
    // apply() never rejects (resolve() swallows failures into "ok"), so the batch
    // settles rather than throwing — but we only *wait* up to the budget. Lookups
    // still in flight when the budget elapses keep running to warm the cache.
    const work = Promise.all(nfts.map((e) => this.apply(e)));
    if (this.enrichBudgetMs <= 0) {
      await work;
      return;
    }
    let timer: ReturnType<typeof setTimeout>;
    const budget = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, this.enrichBudgetMs);
    });
    try {
      await Promise.race([work.then(() => undefined), budget]);
    } finally {
      clearTimeout(timer!);
    }
  }

  private async apply(event: SproutEvent): Promise<void> {
    const launcherId = event.launcherId;
    const stored = launcherId ? this.store?.get(launcherId) : undefined;
    const verdict: Verdict = stored
      ? { disposition: stored.disposition, signals: stored.signals }
      : await this.resolve(event.nftId!);

    if (!stored && launcherId) this.store?.putCheap(launcherId, event.nftId, verdict);

    if (verdict.disposition === "ok") this.worker?.maybeEnqueue(event);

    if (verdict.disposition === "blocked") {
      event.mediaFilter = "blocked";
      if (launcherId) this.media.delete(launcherId);
    } else if (verdict.disposition === "sensitive") {
      event.mediaFilter = "sensitive";
    }
    if (verdict.signals.length > 0) event.signals = [...verdict.signals];
  }

  private resolve(nftId: string): Promise<Verdict> {
    const cached = this.cache.get(nftId);
    if (cached !== undefined) return Promise.resolve(cached);

    const until = this.negativeUntil.get(nftId);
    if (until !== undefined) {
      // a recent failure keeps us permissive without hammering a struggling
      // MintGarden every block; once the TTL lapses we let the next lookup retry
      if (this.now() < until) return Promise.resolve(OK);
      this.negativeUntil.delete(nftId);
    }

    const existing = this.inflight.get(nftId);
    if (existing !== undefined) return existing;

    const promise = this.gate(() => this.fetchVerdict(nftId))
      .then((verdict) => {
        this.remember(nftId, verdict);
        return verdict;
      })
      .catch(() => {
        // transient failure/timeout: permissive now, negatively cached briefly so
        // the same doomed lookup doesn't re-stall the next block
        this.rememberFailure(nftId);
        return OK;
      })
      .finally(() => {
        this.inflight.delete(nftId);
      });

    this.inflight.set(nftId, promise);
    return promise;
  }

  private async fetchVerdict(nftId: string): Promise<Verdict> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/nfts/${nftId}`, {
        signal: controller.signal,
      });
      if (res.status === 404) return { disposition: "ok", signals: [] }; // genuinely unknown to MintGarden → cacheable permissive
      if (!res.ok) throw new Error(`mintgarden ${res.status}`); // 5xx/429/etc → transient, don't poison the cache
      return mapMintgardenSignals(await res.json());
    } finally {
      clearTimeout(timer);
    }
  }

  private remember(nftId: string, verdict: Verdict): void {
    this.cache.delete(nftId);
    this.cache.set(nftId, verdict);
    if (this.cache.size > this.cacheCapacity) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
  }

  private rememberFailure(nftId: string): void {
    if (this.failTtlMs <= 0) return; // negative caching disabled
    this.negativeUntil.delete(nftId);
    this.negativeUntil.set(nftId, this.now() + this.failTtlMs);
    if (this.negativeUntil.size > this.cacheCapacity) {
      const oldest = this.negativeUntil.keys().next().value;
      if (oldest !== undefined) this.negativeUntil.delete(oldest);
    }
  }

  private gate<T>(fn: () => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      this.active++;
      try {
        return await fn();
      } finally {
        this.active--;
        this.waiters.shift()?.();
      }
    };
    if (this.active < this.concurrency) return run();
    return new Promise<T>((resolve, reject) => {
      this.waiters.push(() => run().then(resolve, reject));
    });
  }
}
