import type { ContentFlagEvent, GroveEvent, SproutEvent } from "@grove/shared";
import type { MediaIndex } from "../web/media-index.js";
import type { Verdict } from "./types.js";
import { mapMintgardenSignals, extractContentHash } from "./signals/mintgarden.js";
import type { ContentStore } from "./store.js";
import { SafeSearchWorker } from "./safesearch-worker.js";
import { createLocalNsfwClassifier } from "./signals/local-nsfw-runtime.js";
import { BoundedMap } from "../util/bounded-map.js";
import { log } from "../logger.js";

export type { Disposition } from "./types.js";
export { mapMintgarden, mapMintgardenSignals, extractContentHash } from "./signals/mintgarden.js";
export type { MapMintgardenOpts } from "./signals/mintgarden.js";
export type { StoredVerdict } from "./store.js";

const OK: Verdict = { disposition: "ok" };

// MintGarden serves a static poster for video NFTs at its assets CDN, keyed by
// content hash (the on-chain `data.thumbnail_uri`); the archive CDN does not.
const THUMBNAIL_BASE_URL = "https://assets.mainnet.mintgarden.io/thumbnails";

interface FetchResult {
  verdict: Verdict;
  contentHash?: string;
}

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
  /** Base URL for the MintGarden Archive CDN; used to construct stable image URLs for SafeSearch. */
  archiveBaseUrl?: string;
  /** Max attempts to poll the Archive before giving up (each separated by archiveCheckDelayMs). */
  archiveCheckAttempts?: number;
  /** Milliseconds to wait between Archive poll attempts. */
  archiveCheckDelayMs?: number;
  /** Override the collection allow-list used by the cheap-signal check (test
   *  injection); passed through to mapMintgardenSignals, which defaults to
   *  WHITELIST_SET when this is undefined. */
  whitelist?: Set<string>;
  /** Persistent verdict store keyed by launcherId; a hit skips the MintGarden network fetch. */
  store?: ContentStore;
  /** Google Vision API key; enables out-of-band SafeSearch when combined with store + onFlag. */
  googleApiKey?: string;
  /** Called when SafeSearch promotes an NFT to sensitive/blocked after the sprout was streamed. */
  onFlag?: (e: ContentFlagEvent) => void;
  /** How often to sweep MediaIndex for still-unchecked NFTs (0 disables; default 10 min).
   *  Retries content that lagged Archive ingestion without waiting for a re-spend. */
  safesearchSweepIntervalMs?: number;
  /** Path to the bundled opennsfw2 ONNX model; set to enable local NSFW
   *  pre-classification. By default it's observability-only (see
   *  safesearch-worker.ts): logged for comparison, never affecting the
   *  persisted verdict. Unset disables it entirely (no model load). */
  localNsfwModelPath?: string;
  /** Local-classifier score below which an image is confidently clean. */
  localNsfwCleanBelow?: number;
  /** Local-classifier score above which an image is confidently nsfw. */
  localNsfwNsfwAbove?: number;
  /** Promotes the local classifier from observability-only to an actual gate:
   *  a confident-clean score skips Vision entirely. See
   *  SafeSearchWorkerOpts.enforceCleanSkipsVision. No effect if
   *  localNsfwModelPath is unset. */
  localNsfwEnforceClean?: boolean;
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
  private readonly cache: BoundedMap<string, Verdict>;
  /** nftId -> epoch ms until which a recent failure keeps it permissive without refetch */
  private readonly negativeUntil: BoundedMap<string, number>;
  private readonly inflight = new Map<string, Promise<FetchResult>>();
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly concurrency: number;
  private readonly cacheCapacity: number;
  private readonly enrichBudgetMs: number;
  private readonly failTtlMs: number;
  private readonly now: () => number;
  private readonly archiveBaseUrl: string;
  private readonly whitelist?: Set<string>;
  private readonly store?: ContentStore;
  private readonly worker?: SafeSearchWorker;
  private sweepTimer?: ReturnType<typeof setInterval>;
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
    this.cache = new BoundedMap(this.cacheCapacity);
    this.negativeUntil = new BoundedMap(this.cacheCapacity);
    this.enrichBudgetMs = opts.enrichBudgetMs ?? 1500;
    this.failTtlMs = opts.failTtlMs ?? 60000;
    this.now = opts.now ?? Date.now;
    this.archiveBaseUrl = opts.archiveBaseUrl ?? "https://archive.mintgarden.io";
    this.whitelist = opts.whitelist;
    this.store = opts.store;
    // The worker exists if there's anything for it to run: Vision (needs a key)
    // or the local classifier (standalone, no key needed — see
    // safesearch-worker.ts). Building it with neither would be a no-op.
    if (opts.store && opts.onFlag && (opts.googleApiKey || opts.localNsfwModelPath)) {
      const localClassify = opts.localNsfwModelPath
        ? createLocalNsfwClassifier({
            modelPath: opts.localNsfwModelPath,
            cleanBelow: opts.localNsfwCleanBelow ?? 0.1,
            nsfwAbove: opts.localNsfwNsfwAbove ?? 0.9,
          })
        : undefined;
      this.worker = new SafeSearchWorker({
        media,
        store: opts.store,
        apiKey: opts.googleApiKey,
        onFlag: opts.onFlag,
        enforceCleanSkipsVision: opts.localNsfwEnforceClean,
        fetchImpl: opts.fetchImpl,
        archiveBaseUrl: opts.archiveBaseUrl,
        archiveCheckAttempts: opts.archiveCheckAttempts,
        archiveCheckDelayMs: opts.archiveCheckDelayMs,
        thumbnailBaseUrl: THUMBNAIL_BASE_URL,
        localClassify,
      });
      const sweepMs = opts.safesearchSweepIntervalMs ?? 600_000;
      if (sweepMs > 0) {
        const worker = this.worker;
        this.sweepTimer = setInterval(() => worker.sweep(), sweepMs);
        this.sweepTimer.unref?.();
      }
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

  /** Stop the periodic SafeSearch sweep (the unref'd timer never blocks exit,
   *  but tests and orderly shutdown want it gone deterministically). */
  close(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = undefined;
  }

  private async apply(event: SproutEvent): Promise<void> {
    const launcherId = event.launcherId;
    const stored = launcherId
      ? (() => {
          try {
            return this.store?.get(launcherId);
          } catch (err) {
            log.warn({ err }, "content-filter store.get failed (cache miss)");
            return undefined;
          }
        })()
      : undefined;
    let verdict: Verdict;
    let contentHash: string | undefined;
    if (stored) {
      verdict = { disposition: stored.disposition };
      contentHash = stored.contentHash;
    } else {
      const result = await this.resolve(event.nftId!);
      verdict = result.verdict;
      contentHash = result.contentHash;
    }

    if (!stored && launcherId) {
      try {
        this.store?.putCheap(launcherId, event.nftId, verdict, contentHash, verdict.whitelisted);
      } catch (err) {
        log.warn({ err }, "content-filter store.putCheap failed (verdict not persisted)");
      }
    }

    // Upgrade MediaIndex from IPFS to Archive CDN URL so SafeSearch passes a
    // reliably reachable URL to Google Vision (MintGarden's IPFS gateway is
    // inaccessible from Google's IP ranges).
    if (contentHash && launcherId && verdict.disposition !== "blocked") {
      const existing = this.media.get(launcherId);
      if (existing) {
        const archiveUrl = `${this.archiveBaseUrl}/content/${contentHash}`;
        // Keep the original on-chain art URL as the proxy fallback. On a re-spend
        // `existing.url` may already be the Archive URL, so don't clobber the real
        // fallback with itself — preserve the one captured on the first upgrade.
        const fallbackUrl = existing.url === archiveUrl ? existing.fallbackUrl : existing.url;
        // MintGarden's assets CDN serves a static poster for video NFTs, keyed by
        // content hash (the 512px webp profile). The gallery uses it as the poster
        // (/thumbnail?nft=) rather than seeking a video frame, which often gives a
        // blank result without autoplay.
        const thumbnailUrl =
          existing.kind === "video"
            ? `${THUMBNAIL_BASE_URL}/${contentHash}_512.webp`
            : existing.thumbnailUrl;
        this.media.set(launcherId, {
          url: archiveUrl,
          kind: existing.kind,
          fallbackUrl,
          thumbnailUrl,
        });
      }
    }

    if (verdict.disposition === "ok") {
      if (verdict.whitelisted) {
        log.info(
          { launcherId, nftId: event.nftId },
          "content-filter: allow-list hit, skipping SafeSearch"
        );
      }
      // maybeEnqueue self-skips a whitelisted NFT via the store's skip-stamp;
      // still call it so the store stamp stays the single source of truth
      // (and Vision runs anyway on the fail-open path where putCheap failed).
      this.worker?.maybeEnqueue(event);
    }

    if (verdict.disposition === "blocked") {
      event.mediaFilter = "blocked";
      if (launcherId) this.media.delete(launcherId);
    } else if (verdict.disposition === "sensitive") {
      event.mediaFilter = "sensitive";
    }
  }

  private resolve(nftId: string): Promise<FetchResult> {
    const cached = this.cache.get(nftId);
    if (cached !== undefined) return Promise.resolve({ verdict: cached });

    const until = this.negativeUntil.get(nftId);
    if (until !== undefined) {
      // a recent failure keeps us permissive without hammering a struggling
      // MintGarden every block; once the TTL lapses we let the next lookup retry
      if (this.now() < until) return Promise.resolve({ verdict: OK });
      this.negativeUntil.delete(nftId);
    }

    const existing = this.inflight.get(nftId);
    if (existing !== undefined) return existing;

    const promise = this.gate(() => this.fetchVerdict(nftId))
      .then((result) => {
        this.remember(nftId, result.verdict);
        return result;
      })
      .catch(() => {
        // transient failure/timeout: permissive now, negatively cached briefly so
        // the same doomed lookup doesn't re-stall the next block
        this.rememberFailure(nftId);
        return { verdict: OK };
      })
      .finally(() => {
        this.inflight.delete(nftId);
      });

    this.inflight.set(nftId, promise);
    return promise;
  }

  private async fetchVerdict(nftId: string): Promise<FetchResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/nfts/${nftId}`, {
        signal: controller.signal,
      });
      if (res.status === 404) return { verdict: { disposition: "ok" } }; // genuinely unknown to MintGarden → cacheable permissive
      if (!res.ok) throw new Error(`mintgarden ${res.status}`); // 5xx/429/etc → transient, don't poison the cache
      const json = await res.json();
      return {
        verdict: mapMintgardenSignals(json, { whitelist: this.whitelist }),
        contentHash: extractContentHash(json),
      };
    } finally {
      clearTimeout(timer);
    }
  }

  private remember(nftId: string, verdict: Verdict): void {
    this.cache.set(nftId, verdict);
  }

  private rememberFailure(nftId: string): void {
    if (this.failTtlMs <= 0) return; // negative caching disabled
    this.negativeUntil.set(nftId, this.now() + this.failTtlMs);
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
