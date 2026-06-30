import type { ContentFlagEvent, SproutEvent } from "@grove/shared";
import type { MediaIndex } from "../web/media-index.js";
import type { ContentStore } from "./store.js";
import { querySafeSearch, adultIsSensitive, type SafeSearchResult } from "./signals/safesearch.js";
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
  private active = 0;
  private readonly waiters: Array<() => void> = [];
  private readonly queued = new Set<string>();
  private readonly failedUntil = new Map<string, number>();

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
      media.kind === "image"
        ? media.url
        : media.kind === "video"
          ? media.thumbnailUrl
          : undefined;
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
    try {
      // Distinct NFTs can share the same bytes. If another NFT with this content
      // hash was already SafeSearch-checked, reuse that verdict instead of paying
      // for a second identical Vision lookup.
      if (contentHash) {
        const prior = this.opts.store.getSafeSearchByContentHash(contentHash);
        if (prior) {
          this.persistVerdict(
            launcherId,
            imageUri,
            { sensitive: adultIsSensitive(prior.adult), adult: prior.adult, raw: prior.raw },
            "reused"
          );
          return;
        }
      }
      if (imageUri.startsWith(this.archiveBaseUrl)) {
        await this.waitForArchive(launcherId);
      }
      const result = await this.gate(() =>
        querySafeSearch(imageUri, {
          apiKey: this.opts.apiKey,
          fetchImpl: this.fetchImpl,
          timeoutMs: this.timeoutMs,
        })
      );
      this.persistVerdict(launcherId, imageUri, result, "vision");
    } catch (err) {
      log.warn(
        { launcherId, imageUri, err: err instanceof Error ? err.message : String(err) },
        "safesearch: vision api failed"
      );
      this.failedUntil.set(launcherId, this.now() + this.failTtlMs);
      // evict oldest entry if the map has grown too large
      if (this.failedUntil.size > FAILED_UNTIL_CAP) {
        const oldest = this.failedUntil.keys().next().value;
        if (oldest !== undefined) this.failedUntil.delete(oldest);
      }
    }
  }

  /** Persist a SafeSearch verdict, clear failure suppression, and flag if sensitive. */
  private persistVerdict(
    launcherId: string,
    imageUri: string,
    result: SafeSearchResult,
    source: "vision" | "reused"
  ): void {
    this.opts.store.putSafeSearch(launcherId, result);
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
  // maxPending, which bounds concurrent Archive polls too). On exhaustion it
  // throws, and run()'s catch sets failedUntil so the next attempt backs off.
  private async waitForArchive(launcherId: string): Promise<void> {
    for (let attempt = 0; attempt < this.archiveCheckAttempts; attempt++) {
      if (attempt > 0 && this.archiveCheckDelayMs > 0) {
        await new Promise<void>((r) => setTimeout(r, this.archiveCheckDelayMs));
      }
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        let res: Response;
        try {
          res = await this.fetchImpl(`${this.archiveBaseUrl}/nfts/${launcherId}`, {
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timer);
        }
        if (!res.ok) continue;
        const json = (await res.json()) as {
          assets?: Array<{ role: string; fetch_succeeded: boolean }>;
        };
        if (json.assets?.some((a) => a.role === "data" && a.fetch_succeeded === true)) return;
      } catch {
        // network error or abort → treat as not ready, retry
      }
    }
    throw new Error(`archive not ready after ${this.archiveCheckAttempts} attempts`);
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
