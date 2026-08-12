// FAIL-OPEN BY DESIGN (deliberate policy, signed off 2026-07-13): every
// timeout or error in this pipeline — MintGarden outage, Vision failure,
// store failure — defaults content to unflagged rather than blocking. The
// grove is a visualizer; failing closed would blank the gallery on every
// upstream hiccup. The trade-off is that a flaggable NFT can render while a
// signal source is down (until the SafeSearch sweep retries it). If this
// module is ever lifted into a context where that trade-off is wrong
// (moderation gating, anything user-generated-content-facing), revisit the
// catch-and-permit sites: enrich(), fetchVerdict()'s callers, and
// SafeSearchWorker's verdict fallbacks.
import type { ContentFlagEvent, GroveEvent, SproutEvent } from "@grove/shared";
import type { MediaIndex } from "../web/media-index.js";
import type { Verdict } from "./types.js";
import { mapMintgardenSignals, extractContentHash } from "./signals/mintgarden.js";
import { strongest } from "./verdict.js";
import type { ContentStore } from "./store.js";
import { SafeSearchWorker } from "./safesearch-worker.js";
import { createLocalNsfwClassifier } from "./signals/local-nsfw-runtime.js";
import { BoundedMap } from "../util/bounded-map.js";
import { log } from "../logger.js";

export type { Disposition } from "./types.js";
export { mapMintgarden, mapMintgardenSignals, extractContentHash } from "./signals/mintgarden.js";
export type { MapMintgardenOpts } from "./signals/mintgarden.js";
export type { StoredVerdict } from "./store.js";

const OK: Verdict = { disposition: "ok", signal: "fail-open" };

// MintGarden serves a static poster for video NFTs at its assets CDN, keyed by
// content hash (the on-chain `data.thumbnail_uri`); the archive CDN does not.
const THUMBNAIL_BASE_URL = "https://assets.mainnet.mintgarden.io/thumbnails";

// A video NFT can only ever get a SafeSearch check once MintGarden resolves a
// content hash for it (see apply()'s MediaIndex upgrade below) — and that only
// happens on a launcher's first spend. If MintGarden hadn't indexed the video
// yet at that moment, the poster is stuck missing forever with no re-spend to
// retry it. The backfill sweep below re-polls MintGarden for exactly these
// stuck launchers, capped and backed off so it stays cheap.
const VIDEO_BACKFILL_BATCH = 25;
const VIDEO_BACKFILL_TTL_MS = 60 * 60 * 1000; // 1h between retries per launcher

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
  /** launcherId -> epoch ms until which a video-poster backfill attempt is
   *  suppressed, so a permanently-unindexed video isn't re-queried every sweep. */
  private readonly videoBackfillUntil: BoundedMap<string, number>;
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
  private readonly onFlag?: (e: ContentFlagEvent) => void;
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
    this.videoBackfillUntil = new BoundedMap(this.cacheCapacity);
    this.enrichBudgetMs = opts.enrichBudgetMs ?? 1500;
    this.failTtlMs = opts.failTtlMs ?? 60000;
    this.now = opts.now ?? Date.now;
    this.archiveBaseUrl = opts.archiveBaseUrl ?? "https://archive.mintgarden.io";
    this.whitelist = opts.whitelist;
    this.store = opts.store;
    this.onFlag = opts.onFlag;
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
        this.sweepTimer = setInterval(() => {
          // Backfill first: a launcher whose poster resolves this tick becomes
          // eligible for worker.sweep() to pick up in the same tick, rather
          // than waiting a full interval.
          void this.backfillVideoThumbnails().finally(() => worker.sweep());
        }, sweepMs);
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
            log.warn(
              { launcherId, nftId: event.nftId, err },
              "content-filter store.get failed (cache miss)"
            );
            return undefined;
          }
        })()
      : undefined;
    let verdict: Verdict;
    let contentHash: string | undefined;
    if (stored) {
      verdict = { disposition: stored.disposition, signal: stored.signal };
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
        log.warn(
          { launcherId, nftId: event.nftId, err },
          "content-filter store.putCheap failed (verdict not persisted)"
        );
      }
    }

    if (contentHash && launcherId && verdict.disposition !== "blocked") {
      this.upgradeMedia(launcherId, contentHash);
    }

    if (verdict.disposition === "ok") {
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

    // Every sprout event carries this verdict's disposition out to clients
    // (as mediaFilter, or implicitly as unflagged for "ok"), so log it
    // unconditionally — unlike the async SafeSearch tier, there's no
    // intermediate/not-sent-to-client case here.
    log.info(
      {
        launcherId,
        nftId: event.nftId,
        disposition: verdict.disposition,
        signal: verdict.signal ?? "none",
      },
      "content-filter: verdict"
    );
  }

  /** Upgrade MediaIndex from IPFS to Archive CDN URL so SafeSearch passes a
   *  reliably reachable URL to Google Vision (MintGarden's IPFS gateway is
   *  inaccessible from Google's IP ranges), and — for video — set the poster
   *  URL SafeSearch and the client both use in place of the undecodable clip. */
  private upgradeMedia(launcherId: string, contentHash: string): void {
    const existing = this.media.get(launcherId);
    if (!existing) return;
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

  /** Re-polls MintGarden for launchers stuck without a video poster: a video
   *  whose content hash never resolved on its first (and often only) spend has
   *  no way to become SafeSearch-eligible otherwise (unlike an image, which
   *  always has the on-chain original to fall back to). Bounded per tick
   *  (`VIDEO_BACKFILL_BATCH`) and backed off per launcher
   *  (`VIDEO_BACKFILL_TTL_MS`) so a batch of permanently-unindexed videos can't
   *  grow into an unbounded, ever-repeating MintGarden polling load. */
  private async backfillVideoThumbnails(): Promise<void> {
    if (!this.store) return;
    const now = this.now();
    const candidates: string[] = [];
    for (const [launcherId, entry] of this.media.entries()) {
      if (entry.kind !== "video" || entry.thumbnailUrl) continue;
      const until = this.videoBackfillUntil.get(launcherId);
      if (until !== undefined && now < until) continue;
      candidates.push(launcherId);
      if (candidates.length >= VIDEO_BACKFILL_BATCH) break;
    }
    await Promise.all(candidates.map((launcherId) => this.backfillOne(launcherId)));
  }

  private async backfillOne(launcherId: string): Promise<void> {
    this.videoBackfillUntil.set(launcherId, this.now() + VIDEO_BACKFILL_TTL_MS);
    let stored;
    try {
      stored = this.store?.get(launcherId);
    } catch (err) {
      log.warn({ launcherId, err }, "content-filter video-backfill: store.get failed");
      return;
    }
    // Already resolved by some other path since the candidate scan, blocked
    // (no poster needed — media is unreachable regardless), or we have nothing
    // to look up MintGarden by — nothing to do.
    if (!stored?.nftId || stored.contentHash || stored.disposition === "blocked") return;

    let result: FetchResult;
    try {
      result = await this.gate(() => this.fetchVerdict(stored.nftId!));
    } catch (err) {
      log.warn(
        { launcherId, nftId: stored.nftId, err },
        "content-filter video-backfill: mintgarden lookup failed"
      );
      return;
    }
    if (!result.contentHash) return; // still not indexed by MintGarden; retry next eligible sweep

    // Merge rather than overwrite: a fresh MintGarden read must only ever be
    // able to escalate this launcher's disposition, never quietly downgrade
    // one already set by some other signal (e.g. lexicon) between spends.
    const disposition = strongest(stored.disposition, result.verdict.disposition);
    const verdict: Verdict =
      disposition === result.verdict.disposition
        ? result.verdict
        : { disposition, signal: stored.signal };

    try {
      this.store?.putCheap(launcherId, stored.nftId, verdict, result.contentHash);
    } catch (err) {
      log.warn(
        { launcherId, nftId: stored.nftId, err },
        "content-filter video-backfill: store.putCheap failed"
      );
      // Still worth upgrading MediaIndex below even if the store write failed —
      // the in-memory poster URL is what actually unblocks a SafeSearch check.
    }

    if (disposition === "blocked") {
      this.media.delete(launcherId);
      return;
    }
    this.upgradeMedia(launcherId, result.contentHash);

    // The video was already streamed to clients as "ok" (or whatever the
    // stale cheap verdict said); if this fresher MintGarden read now disagrees,
    // tell connected clients the same way a SafeSearch promotion does.
    if (disposition === "sensitive" && stored.disposition !== "sensitive") {
      try {
        this.onFlag?.({ type: "content-flag", launcherId, mediaFilter: "sensitive" });
      } catch (err) {
        log.warn({ launcherId, err }, "content-filter video-backfill: onFlag failed");
      }
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
      if (res.status === 404) return { verdict: { disposition: "ok", signal: "not-found" } }; // genuinely unknown to MintGarden → cacheable permissive
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
