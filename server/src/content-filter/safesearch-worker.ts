import { Address } from "chia-wallet-sdk";
import type { ContentFlagEvent, SproutEvent } from "@grove/shared";
import type { MediaIndex } from "../web/media-index.js";
import type { ContentStore } from "./store.js";
import { querySafeSearch, adultIsSensitive, type SafeSearchResult } from "./signals/safesearch.js";
import type { LocalNsfwBand } from "./signals/local-nsfw.js";
import { BoundedMap } from "../util/bounded-map.js";
import { log } from "../logger.js";

// Bech32m nft1... form of a launcherId, for logging alongside the raw hex —
// pasteable straight into MintGarden/spacescan without a manual lookup. Must
// never throw: a bad launcherId must not abort verdict persistence, only the
// log line it decorates.
function nftId(launcherId: string): string | undefined {
  try {
    return new Address(Buffer.from(launcherId, "hex"), "nft").encode();
  } catch {
    return undefined;
  }
}

export interface SafeSearchWorkerOpts {
  media: MediaIndex;
  store: ContentStore;
  /** Unset disables Vision entirely — if `localClassify` is set, it still runs
   *  standalone (see checkVision) so the local classifier can be evaluated
   *  without a paid Vision key. */
  apiKey?: string;
  onFlag: (e: ContentFlagEvent) => void;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Max concurrent Google Vision calls (the paid, rate-limited operation). */
  concurrency?: number;
  /** Max in-flight launchers (waiting + Vision-checking); excess enqueues are dropped. */
  maxPending?: number;
  /** How long a failed lookup is suppressed before another attempt. */
  failTtlMs?: number;
  now?: () => number;
  /** Base URL for the MintGarden Archive API; used for ingestion pre-check. */
  archiveBaseUrl?: string;
  /** Max attempts to poll Archive before giving up (each separated by archiveCheckDelayMs). */
  archiveCheckAttempts?: number;
  /** Milliseconds to wait between Archive poll attempts (0 = no delay). */
  archiveCheckDelayMs?: number;
  /** Base URL of the assets-CDN poster thumbnails; poster URLs get the same readiness probe. */
  thumbnailBaseUrl?: string;
  /** Local NSFW classifier. When `apiKey` is set, this runs alongside every
   *  Vision call purely for comparison logging (shadow mode) and never
   *  affects the persisted verdict. When `apiKey` is unset, it runs standalone
   *  (no Vision call at all) purely for observability — still never persisted
   *  or flagged, so the local classifier can be evaluated without a Vision
   *  key. A failure here is caught and logged, not thrown. Undefined disables
   *  it entirely. */
  localClassify?: (imageBytes: Uint8Array) => Promise<{ score: number; band: LocalNsfwBand }>;
  /** Max bytes read for local classification before giving up (avoids loading
   *  an unbounded response body into memory for a shadow-only comparison). */
  localClassifyMaxBytes?: number;
  /** Promotes the local classifier from observability-only to an actual gate:
   *  a confident-clean local score (`band === "clean"`) skips Vision entirely
   *  and persists ok/checked directly from the local result. Anything else
   *  (uncertain or nsfw) still goes to Vision as normal — only "clean" is
   *  ever decided locally, so a local false-negative on nsfw content can't
   *  slip through unconfirmed. No effect if `localClassify` is unset. */
  enforceCleanSkipsVision?: boolean;
}

/**
 * Out-of-band SafeSearch path. `maybeEnqueue` is fire-and-forget: any NFT spend
 * whose cheap verdict was `ok` and that hasn't yet been SafeSearch-checked gets a
 * single Vision lookup — images are classified by their art URL, videos by their
 * static poster (best-effort; Vision can't decode video frames, and a video with
 * no resolved thumbnail is skipped). `sweep()` re-attempts every still-eligible
 * launcher in MediaIndex on a timer, so a mint whose content lagged Archive
 * ingestion gets a verdict without waiting for a re-spend.
 *
 * URLs on MintGarden's ingestion-lagged CDNs (archive content, assets-CDN
 * posters) are readiness-probed first: a HEAD of the exact URL Vision will
 * fetch (2xx/3xx = ready). If the probe exhausts its attempts, image NFTs fall
 * back to one Vision attempt against the on-chain original URL — unless its
 * host is unreachable from Google's fetchers — and `checked_uri` records what
 * was actually classified. Everything is fail-open: an NFT we cannot check
 * renders permissive, failures back off in memory (`failedUntil` per launcher,
 * `dedupFailedUntil` per content) and are never persisted.
 *
 * Two limits, deliberately separate: the concurrency gate bounds only the paid,
 * rate-limited Vision call, while the cheap readiness probing runs unbounded by
 * the gate (it would otherwise occupy a Vision slot while merely sleeping,
 * collapsing throughput to concurrency / probeWait). `maxPending` caps total
 * in-flight launchers — and therefore concurrent probes — so a large mint drop
 * can't grow the queue (or open sockets) without bound.
 */
const FAILED_UNTIL_CAP = 10000;
const DEFAULT_MAX_PENDING = 256;

/** Ceiling for the doubling per-content failure backoff: a permanently dead
 *  asset (never ingested, fallback link-rotted) settles at ~4 attempts/day
 *  instead of one per sweep, forever. */
const MAX_DEDUP_FAIL_TTL_MS = 6 * 60 * 60 * 1000;

/** Hosts Google's image fetcher cannot reach (the reason the Archive upgrade
 *  exists) — a Vision call against them is a guaranteed failure, so don't pay
 *  the attempt. */
const GOOGLE_UNREACHABLE_HOSTS = new Set(["ipfs.mintgarden.io"]);

interface VisionOutcome {
  result: SafeSearchResult;
  checkedUri: string;
}

export class SafeSearchWorker {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly concurrency: number;
  private readonly maxPending: number;
  private readonly failTtlMs: number;
  private readonly now: () => number;
  private readonly archiveBaseUrl: string;
  private readonly archiveCheckAttempts: number;
  private readonly archiveCheckDelayMs: number;
  private readonly thumbnailBaseUrl: string;
  private readonly localClassifyMaxBytes: number;
  private readonly enforceCleanSkipsVision: boolean;
  private active = 0;
  private readonly waiters: Array<() => void> = [];
  private readonly queued = new Set<string>();
  private readonly failedUntil = new BoundedMap<string, number>(FAILED_UNTIL_CAP);
  /** dedup key (contentHash, or imageUri when no contentHash is known yet) ->
   *  in-progress Vision check, so concurrent first-time checks of identical
   *  bytes (e.g. an edition drop landing in one block) coalesce onto a single
   *  paid call instead of each racing the not-yet-persisted DB dedup. */
  private readonly dedupInflight = new Map<string, Promise<VisionOutcome | undefined>>();
  /** Same dedup key -> suppression deadline after a failure (Vision error, or
   *  Archive never becoming ready). Bounds the case where the in-flight leader
   *  has already failed and cleaned up before the next launcher sharing this
   *  content arrives — without this, that launcher would re-run its own
   *  archive-readiness poll from scratch for content already known to be
   *  unready, rather than just inheriting the recent failure. */
  private readonly dedupFailedUntil = new BoundedMap<string, number>(FAILED_UNTIL_CAP);
  /** Same dedup key -> consecutive-failure count driving the doubling TTL. */
  private readonly dedupFailStreak = new BoundedMap<string, number>(FAILED_UNTIL_CAP);

  constructor(private readonly opts: SafeSearchWorkerOpts) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 8000;
    this.concurrency = opts.concurrency ?? 2;
    this.maxPending = opts.maxPending ?? DEFAULT_MAX_PENDING;
    this.failTtlMs = opts.failTtlMs ?? 300_000;
    this.now = opts.now ?? Date.now;
    this.archiveBaseUrl = opts.archiveBaseUrl ?? "https://archive.mintgarden.io";
    this.archiveCheckAttempts = opts.archiveCheckAttempts ?? 3;
    this.archiveCheckDelayMs = opts.archiveCheckDelayMs ?? 2000;
    this.thumbnailBaseUrl =
      opts.thumbnailBaseUrl ?? "https://assets.mainnet.mintgarden.io/thumbnails";
    this.localClassifyMaxBytes = opts.localClassifyMaxBytes ?? 15 * 1024 * 1024;
    this.enforceCleanSkipsVision = opts.enforceCleanSkipsVision ?? false;
  }

  maybeEnqueue(event: SproutEvent): void {
    if (event.kind !== "nft" || !event.launcherId) return;
    this.tryEnqueue(event.launcherId);
  }

  /** Re-attempt every launcher still in MediaIndex that remains eligible
   *  (unchecked, cheap-ok, not backed off). Lets an NFT whose content lagged
   *  Archive ingestion at mint time get a verdict without waiting for a
   *  re-spend. All the usual guards apply, so a sweep is cheap when idle:
   *  one synchronous store point-read per entry. */
  sweep(): void {
    for (const [launcherId] of this.opts.media.entries()) this.tryEnqueue(launcherId, true);
  }

  private tryEnqueue(launcherId: string, fromSweep = false): void {
    if (this.queued.has(launcherId)) return;
    const media = this.opts.media.get(launcherId);
    if (!media) return;
    // The image Vision classifies: the art itself for images, the static poster
    // for videos (Vision can't decode video frames). Best-effort — a video with
    // no resolved thumbnail, or an audio NFT, has nothing to classify, so skip.
    const imageUri =
      media.kind === "image" ? media.url : media.kind === "video" ? media.thumbnailUrl : undefined;
    if (!imageUri) return;
    let stored;
    try {
      stored = this.opts.store.get(launcherId);
    } catch (err) {
      // Called synchronously from ContentFilter.apply, which must never reject.
      // A store read failure means we can't honor the safesearchChecked guard,
      // so skip (don't burn paid Vision quota un-deduped) rather than throw.
      log.warn(
        { launcherId, err: err instanceof Error ? err.message : String(err) },
        "safesearch: store.get failed (skipping)"
      );
      return;
    }
    // The sweep path has no ContentFilter ok-gate in front of it, so guard here:
    // SafeSearch can only upgrade ok → sensitive, so anything already flagged
    // (or blocked) has nothing to gain from a paid check.
    if (stored && stored.disposition !== "ok") return;
    if (stored?.safesearchChecked) return;
    // A row-less launcher on the sweep path means classifyBlock has populated
    // MediaIndex but ContentFilter.apply hasn't run putCheap yet. Checking it
    // now would create the row via putSafeSearch and permanently skip the
    // cheap-signal tier (denylist, CHIP-7, MintGarden flags) for this NFT —
    // wait for the spend path to classify it first; the next sweep picks it up.
    if (fromSweep && !stored) return;
    const until = this.failedUntil.get(launcherId);
    if (until !== undefined && this.now() < until) return;
    // Bound total in-flight work. Dropped launchers are picked up on a later
    // spend or sweep, or after failedUntil lapses — acceptable for an
    // out-of-band path.
    if (this.queued.size >= this.maxPending) return;

    // Only images can fall back to the on-chain original: a video's fallback is
    // the raw clip, which Vision cannot decode.
    const fallbackUri = media.kind === "image" ? media.fallbackUrl : undefined;
    this.queued.add(launcherId);
    // run() is not gated: its content-readiness wait is cheap polling that must
    // not occupy a Vision slot. Only the paid Vision call inside run() is gated.
    void this.run(launcherId, imageUri, stored?.contentHash, fallbackUri).finally(() =>
      this.queued.delete(launcherId)
    );
  }

  private async run(
    launcherId: string,
    imageUri: string,
    contentHash?: string,
    fallbackUri?: string
  ): Promise<void> {
    // Distinct NFTs can share identical bytes. Prefer the real content hash for
    // dedup; MintGarden's indexer lags mint time (sometimes indefinitely for a
    // given collection), so when it hasn't resolved one yet, fall back to the
    // exact image URI about to be checked — identical on-chain bytes still
    // resolve to the same URI (e.g. edition drops sharing one IPFS CID).
    const dedupKey = contentHash ?? imageUri;
    // Cheapest check first: skip the DB round-trip entirely when this exact
    // content just failed (e.g. Archive hasn't ingested it yet) via a different
    // launcherId — no point re-running the same doomed archive-readiness poll.
    const dedupFailedUntil = this.dedupFailedUntil.get(dedupKey);
    if (dedupFailedUntil !== undefined && this.now() < dedupFailedUntil) {
      // Track the dedup TTL exactly rather than independently extending with a
      // flat failTtlMs: the dedup backoff now doubles per content, and a flat
      // per-launcher TTL set here could outlive it, blocking tryEnqueue from
      // ever re-entering run() to observe that the (shorter-lived) dedup TTL
      // has since lapsed.
      this.failedUntil.set(launcherId, dedupFailedUntil);
      return;
    }
    try {
      // Second chance on a hash miss: content checked before MintGarden resolved
      // its hash sits in a row with a checked_uri and a NULL content_hash. This
      // launcher's fallbackUri is that same original URI, so one extra indexed
      // SELECT can save a paid Vision call. (When contentHash is undefined,
      // fallbackUri is too — media is never Archive-upgraded without a hash.)
      const prior =
        (contentHash
          ? this.opts.store.getSafeSearchByContentHash(contentHash)
          : this.opts.store.getSafeSearchByUri(imageUri)) ??
        (fallbackUri ? this.opts.store.getSafeSearchByUri(fallbackUri) : undefined);
      if (prior) {
        this.persistVerdict(
          launcherId,
          imageUri,
          { sensitive: adultIsSensitive(prior.adult), adult: prior.adult, raw: prior.raw },
          "reused"
        );
        return;
      }
      // The DB check above is a snapshot, not a lock — another run() for the
      // same dedup key may already be checking it but hasn't persisted a
      // verdict yet. Join it instead of independently paying for a second
      // identical Vision lookup.
      const inflight = this.dedupInflight.get(dedupKey);
      if (inflight) {
        const outcome = await inflight;
        if (outcome) this.persistVerdict(launcherId, imageUri, outcome.result, "reused");
        return;
      }
      const work = this.checkVision(imageUri, fallbackUri);
      this.dedupInflight.set(dedupKey, work);
      // .finally() derives a new promise; it must carry its own rejection
      // handler; the "real" rejection is still caught below via `await work`.
      work.finally(() => this.dedupInflight.delete(dedupKey)).catch(() => {});
      const outcome = await work;
      this.dedupFailStreak.delete(dedupKey);
      this.dedupFailedUntil.delete(dedupKey);
      // undefined means checkVision ran local-only (no apiKey configured) —
      // pure observability, nothing to persist.
      if (outcome) this.persistVerdict(launcherId, outcome.checkedUri, outcome.result, "vision");
    } catch (err) {
      log.warn(
        { launcherId, imageUri, err: err instanceof Error ? err.message : String(err) },
        "safesearch: vision api failed"
      );
      this.failedUntil.set(launcherId, this.now() + this.failTtlMs);
      const streak = (this.dedupFailStreak.get(dedupKey) ?? 0) + 1;
      this.dedupFailStreak.set(dedupKey, streak);
      // Doubling backoff: the sweep retries content every tick once the TTL
      // lapses, so a flat TTL would re-spend probe + Vision-attempt on
      // permanently dead content forever.
      const ttl = Math.min(this.failTtlMs * 2 ** (streak - 1), MAX_DEDUP_FAIL_TTL_MS);
      this.dedupFailedUntil.set(dedupKey, this.now() + ttl);
    }
  }

  private async checkVision(
    imageUri: string,
    fallbackUri?: string
  ): Promise<VisionOutcome | undefined> {
    const target = await this.resolveTarget(imageUri, fallbackUri);

    if (this.enforceCleanSkipsVision && this.opts.localClassify) {
      // Enforcement decides whether Vision runs at all, so (unlike shadow
      // mode below) the local result must be awaited before that decision —
      // it can't just race Vision for a post-hoc comparison log.
      const local = await this.shadowClassifyLocal(target);
      if (local?.band === "clean") {
        log.info(
          { target, localScore: local.score, localBand: local.band },
          "safesearch: local-nsfw enforced clean (Vision skipped)"
        );
        return {
          result: {
            sensitive: false,
            adult: "UNKNOWN",
            raw: { source: "local-nsfw", score: local.score },
          },
          checkedUri: target,
        };
      }
      // Not confidently clean (uncertain or nsfw): fall through to the normal
      // Vision-or-standalone handling below, reusing the local result already
      // computed above rather than re-running it.
      return this.resolveVisionOutcome(target, Promise.resolve(local));
    }

    // Default (non-enforcing) path: local classification, if configured, runs
    // concurrently with Vision purely for comparison logging — started before
    // the Vision gate so it doesn't wait behind the paid concurrency limit.
    const shadow = this.opts.localClassify ? this.shadowClassifyLocal(target) : undefined;
    return this.resolveVisionOutcome(target, shadow);
  }

  /** Resolves the readiness-probed / fallback URL Vision (and the local
   *  classifier) should actually classify. */
  private async resolveTarget(imageUri: string, fallbackUri?: string): Promise<string> {
    if (!this.needsReadyProbe(imageUri)) return imageUri;
    const ready = await this.waitForContentReady(imageUri);
    if (ready) return imageUri;
    const fallback = this.usableFallback(imageUri, fallbackUri);
    if (!fallback) {
      throw new Error(`content not ready after ${this.archiveCheckAttempts} attempts`);
    }
    // MintGarden never ingested these bytes; classify the on-chain original
    // instead of giving up. checked_uri records what was actually classified.
    return fallback;
  }

  /** Calls Vision (if an apiKey is configured) or logs the local classifier's
   *  standalone result (if not) — shared by both the enforce and shadow
   *  paths in checkVision, which differ only in when `local` resolves. */
  private async resolveVisionOutcome(
    target: string,
    local: Promise<{ score: number; band: LocalNsfwBand } | undefined> | undefined
  ): Promise<VisionOutcome | undefined> {
    if (!this.opts.apiKey) {
      // No Vision key: the local classifier (if configured) runs standalone,
      // purely for observability — nothing is persisted or flagged, since
      // there is no Vision-derived verdict to attach it to.
      const resolved = local ? await local : undefined;
      if (resolved) {
        log.info(
          { target, localScore: resolved.score, localBand: resolved.band },
          "safesearch: local-nsfw standalone result (no Vision key configured)"
        );
      }
      return undefined;
    }

    const result = await this.gate(() =>
      querySafeSearch(target, {
        apiKey: this.opts.apiKey!,
        fetchImpl: this.fetchImpl,
        timeoutMs: this.timeoutMs,
      })
    );
    const resolved = local ? await local : undefined;
    if (resolved) {
      log.info(
        {
          target,
          localScore: resolved.score,
          localBand: resolved.band,
          visionAdult: result.adult,
          visionSensitive: result.sensitive,
        },
        "safesearch: local-nsfw shadow comparison"
      );
    }
    return { result, checkedUri: target };
  }

  /** Fetches the same bytes Vision is about to classify and runs the injected
   *  local classifier. Never throws — a failure here must not affect the real
   *  (Vision-derived) verdict, only forgo this round's comparison log. */
  private async shadowClassifyLocal(
    url: string
  ): Promise<{ score: number; band: LocalNsfwBand } | undefined> {
    try {
      const bytes = await this.fetchBytes(url);
      return await this.opts.localClassify!(bytes);
    } catch (err) {
      log.warn(
        { url, err: err instanceof Error ? err.message : String(err) },
        "safesearch: local-nsfw shadow classify failed (ignored)"
      );
      return undefined;
    }
  }

  private async fetchBytes(url: string): Promise<Uint8Array> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`fetch ${res.status}`);
      const buf = await res.arrayBuffer();
      if (buf.byteLength > this.localClassifyMaxBytes) {
        throw new Error(`image too large for local classify (${buf.byteLength} bytes)`);
      }
      return new Uint8Array(buf);
    } finally {
      clearTimeout(timer);
    }
  }

  /** The original art URL, if it is worth one Vision attempt: http(s), distinct
   *  from what we already tried, and not on a host Google cannot reach. */
  private usableFallback(imageUri: string, fallbackUri?: string): string | undefined {
    if (!fallbackUri || fallbackUri === imageUri) return undefined;
    try {
      const u = new URL(fallbackUri);
      if (u.protocol !== "https:" && u.protocol !== "http:") return undefined;
      if (GOOGLE_UNREACHABLE_HOSTS.has(u.hostname)) return undefined;
      return fallbackUri;
    } catch {
      return undefined;
    }
  }

  /** MintGarden's ingestion-lagged CDNs, where a probe from here predicts what
   *  Google's fetcher will see. Other hosts are checked blind: our reachability
   *  says nothing about Google's (e.g. gateways that block Google's IP ranges). */
  private needsReadyProbe(imageUri: string): boolean {
    return (
      imageUri.startsWith(this.archiveBaseUrl + "/") ||
      imageUri.startsWith(this.thumbnailBaseUrl + "/")
    );
  }

  /** Persist a SafeSearch verdict, clear failure suppression, and flag if sensitive. */
  private persistVerdict(
    launcherId: string,
    checkedUri: string,
    result: SafeSearchResult,
    source: "vision" | "reused"
  ): void {
    const signal = source === "vision" ? "vision" : "vision-reused";
    this.opts.store.putSafeSearch(launcherId, result, checkedUri, signal);
    this.failedUntil.delete(launcherId);
    if (result.sensitive) {
      // A clean result never reaches the client (the cheap tier already sent
      // an unflagged sprout; nothing changes) so it's not logged here — only
      // a promotion that actually goes out as a ContentFlagEvent is.
      log.info(
        { launcherId, nftId: nftId(launcherId), imageUri: checkedUri, signal, disposition: "sensitive" },
        "content-filter: verdict"
      );
      // The verdict is already durably persisted above — a failure to notify
      // connected clients (e.g. a Hub publish error) is a delivery problem,
      // not a classification failure. Letting it propagate to run()'s catch
      // would mislabel it as a Vision failure and poison the dedup backoff
      // for other launchers sharing this content, blocking them from reusing
      // a verdict that's already correct and sitting in the store.
      try {
        this.opts.onFlag({ type: "content-flag", launcherId, mediaFilter: "sensitive" });
      } catch (err) {
        log.warn(
          { launcherId, err: err instanceof Error ? err.message : String(err) },
          "safesearch: onFlag failed (verdict persisted, client notification dropped)"
        );
      }
    }
  }

  // Runs outside the Vision gate, so a not-yet-ingested NFT sleeps between polls
  // without occupying a paid-call slot; many waits proceed in parallel (capped by
  // maxPending, which bounds concurrent probes too). HEAD of the exact URL Vision
  // will fetch: ingested archive content answers an immutable 301 (to
  // files.mintgarden.io), existing thumbnails 200, missing content 404 — so any
  // 2xx/3xx is ready and everything else (incl. network errors) retries.
  private async waitForContentReady(url: string): Promise<boolean> {
    for (let attempt = 0; attempt < this.archiveCheckAttempts; attempt++) {
      if (attempt > 0 && this.archiveCheckDelayMs > 0) {
        await new Promise<void>((r) => setTimeout(r, this.archiveCheckDelayMs));
      }
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        let res: Response;
        try {
          res = await this.fetchImpl(url, {
            method: "HEAD",
            redirect: "manual",
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timer);
        }
        if (res.ok || (res.status >= 300 && res.status < 400)) return true;
      } catch {
        // network error or abort → treat as not ready, retry
      }
    }
    return false;
  }

  private gate<T>(fn: () => Promise<T>): Promise<T> {
    const runNow = async (): Promise<T> => {
      this.active++;
      try {
        return await fn();
      } finally {
        this.active--;
        this.waiters.shift()?.();
      }
    };
    if (this.active < this.concurrency) return runNow();
    return new Promise<T>((resolve, reject) => {
      this.waiters.push(() => runNow().then(resolve, reject));
    });
  }
}
