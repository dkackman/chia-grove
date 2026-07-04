import type { ContentFlagEvent, SproutEvent } from "@grove/shared";
import type { MediaIndex } from "../web/media-index.js";
import type { ContentStore } from "./store.js";
import { querySafeSearch, adultIsSensitive, type SafeSearchResult } from "./signals/safesearch.js";
import { BoundedMap } from "../util/bounded-map.js";
import { log } from "../logger.js";

export interface SafeSearchWorkerOpts {
  media: MediaIndex;
  store: ContentStore;
  apiKey: string;
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
}

/**
 * Out-of-band SafeSearch path. `maybeEnqueue` is fire-and-forget: any NFT spend
 * whose cheap verdict was `ok` and that hasn't yet been SafeSearch-checked gets a
 * single Vision lookup — images are classified by their art URL, videos by their
 * static poster (best-effort; Vision can't decode video frames, and a video with
 * no resolved thumbnail is skipped). Not limited to mints — re-spends of
 * previously-unseen NFTs are covered too. A `sensitive` result is persisted and
 * pushed to clients as a `content-flag`. Failures leave the NFT permissive and
 * are suppressed for `failTtlMs` so an outage doesn't re-spend the paid quota
 * every block.
 *
 * Two limits, deliberately separate: the concurrency gate bounds only the paid,
 * rate-limited Vision call, while the cheap Archive-readiness polling runs
 * unbounded by the gate (it would otherwise occupy a Vision slot while merely
 * sleeping, collapsing throughput to concurrency / archiveWait). `maxPending`
 * caps total in-flight launchers — and therefore concurrent Archive polls — so a
 * large mint drop can't grow the queue (or open sockets) without bound.
 */
const FAILED_UNTIL_CAP = 10000;
const DEFAULT_MAX_PENDING = 256;

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
  private active = 0;
  private readonly waiters: Array<() => void> = [];
  private readonly queued = new Set<string>();
  private readonly failedUntil = new BoundedMap<string, number>(FAILED_UNTIL_CAP);
  /** dedup key (contentHash, or imageUri when no contentHash is known yet) ->
   *  in-progress Vision check, so concurrent first-time checks of identical
   *  bytes (e.g. an edition drop landing in one block) coalesce onto a single
   *  paid call instead of each racing the not-yet-persisted DB dedup. */
  private readonly dedupInflight = new Map<string, Promise<SafeSearchResult>>();
  /** Same dedup key -> suppression deadline after a failure (Vision error, or
   *  Archive never becoming ready). Bounds the case where the in-flight leader
   *  has already failed and cleaned up before the next launcher sharing this
   *  content arrives — without this, that launcher would re-run its own
   *  archive-readiness poll from scratch for content already known to be
   *  unready, rather than just inheriting the recent failure. */
  private readonly dedupFailedUntil = new BoundedMap<string, number>(FAILED_UNTIL_CAP);

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
  }

  maybeEnqueue(event: SproutEvent): void {
    if (event.kind !== "nft") return;
    const launcherId = event.launcherId;
    if (!launcherId || this.queued.has(launcherId)) return;
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
    if (stored?.safesearchChecked) return;
    const until = this.failedUntil.get(launcherId);
    if (until !== undefined && this.now() < until) return;
    // Bound total in-flight work. Dropped launchers are picked up on a later
    // spend or after failedUntil lapses — acceptable for an out-of-band path.
    if (this.queued.size >= this.maxPending) return;

    this.queued.add(launcherId);
    // run() is not gated: its Archive-readiness wait is cheap polling that must
    // not occupy a Vision slot. Only the paid Vision call inside run() is gated.
    void this.run(launcherId, imageUri, stored?.contentHash).finally(() =>
      this.queued.delete(launcherId)
    );
  }

  private async run(launcherId: string, imageUri: string, contentHash?: string): Promise<void> {
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
      this.failedUntil.set(launcherId, this.now() + this.failTtlMs);
      return;
    }
    try {
      const prior = contentHash
        ? this.opts.store.getSafeSearchByContentHash(contentHash)
        : this.opts.store.getSafeSearchByUri(imageUri);
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
        this.persistVerdict(launcherId, imageUri, await inflight, "reused");
        return;
      }
      const work = this.checkVision(imageUri);
      this.dedupInflight.set(dedupKey, work);
      // .finally() derives a new promise; it must carry its own rejection
      // handler; the "real" rejection is still caught below via `await work`.
      work.finally(() => this.dedupInflight.delete(dedupKey)).catch(() => {});
      this.persistVerdict(launcherId, imageUri, await work, "vision");
    } catch (err) {
      log.warn(
        { launcherId, imageUri, err: err instanceof Error ? err.message : String(err) },
        "safesearch: vision api failed"
      );
      this.failedUntil.set(launcherId, this.now() + this.failTtlMs);
      this.dedupFailedUntil.set(dedupKey, this.now() + this.failTtlMs);
    }
  }

  private async checkVision(imageUri: string): Promise<SafeSearchResult> {
    if (this.needsReadyProbe(imageUri)) {
      const ready = await this.waitForContentReady(imageUri);
      if (!ready) {
        throw new Error(`content not ready after ${this.archiveCheckAttempts} attempts`);
      }
    }
    return this.gate(() =>
      querySafeSearch(imageUri, {
        apiKey: this.opts.apiKey,
        fetchImpl: this.fetchImpl,
        timeoutMs: this.timeoutMs,
      })
    );
  }

  /** MintGarden's ingestion-lagged CDNs, where a probe from here predicts what
   *  Google's fetcher will see. Other hosts are checked blind: our reachability
   *  says nothing about Google's (e.g. gateways that block Google's IP ranges). */
  private needsReadyProbe(imageUri: string): boolean {
    return imageUri.startsWith(this.archiveBaseUrl) || imageUri.startsWith(this.thumbnailBaseUrl);
  }

  /** Persist a SafeSearch verdict, clear failure suppression, and flag if sensitive. */
  private persistVerdict(
    launcherId: string,
    imageUri: string,
    result: SafeSearchResult,
    source: "vision" | "reused"
  ): void {
    this.opts.store.putSafeSearch(launcherId, result, imageUri);
    this.failedUntil.delete(launcherId);
    log.info(
      { launcherId, imageUri, source, verdict: result.sensitive ? "sensitive" : "ok" },
      "safesearch: verdict"
    );
    if (result.sensitive) {
      this.opts.onFlag({ type: "content-flag", launcherId, mediaFilter: "sensitive" });
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
