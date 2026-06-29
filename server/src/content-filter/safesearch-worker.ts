import type { ContentFlagEvent, SproutEvent } from "@grove/shared";
import type { MediaIndex } from "../web/media-index.js";
import type { ContentStore } from "./store.js";
import { querySafeSearch } from "./signals/safesearch.js";

export interface SafeSearchWorkerOpts {
  media: MediaIndex;
  store: ContentStore;
  apiKey: string;
  onFlag: (e: ContentFlagEvent) => void;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  concurrency?: number;
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
 * Out-of-band SafeSearch path. `maybeEnqueue` is fire-and-forget: any image NFT
 * spend whose cheap verdict was `ok` and that hasn't yet been SafeSearch-checked
 * gets a single Vision lookup behind a bounded concurrency gate. Not limited to
 * mints — re-spends of previously-unseen NFTs are covered too. A `sensitive`
 * result is persisted and pushed to clients as a `content-flag`. Failures leave
 * the NFT permissive and are suppressed for `failTtlMs` so an outage doesn't
 * re-spend the paid quota every block.
 */
const FAILED_UNTIL_CAP = 10000;

export class SafeSearchWorker {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly concurrency: number;
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
    this.failTtlMs = opts.failTtlMs ?? 300_000;
    this.now = opts.now ?? Date.now;
    this.archiveBaseUrl = opts.archiveBaseUrl ?? "https://archive.mintgarden.io";
    this.archiveCheckAttempts = opts.archiveCheckAttempts ?? 3;
    this.archiveCheckDelayMs = opts.archiveCheckDelayMs ?? 2000;
  }

  maybeEnqueue(event: SproutEvent): void {
    if (event.kind !== "nft" || event.mediaKind !== "image") return;
    const launcherId = event.launcherId;
    if (!launcherId || this.queued.has(launcherId)) return;
    const media = this.opts.media.get(launcherId);
    if (!media || media.kind !== "image") return;
    let stored;
    try {
      stored = this.opts.store.get(launcherId);
    } catch (err) {
      // Called synchronously from ContentFilter.apply, which must never reject.
      // A store read failure means we can't honor the safesearchChecked guard,
      // so skip (don't burn paid Vision quota un-deduped) rather than throw.
      console.warn(`[safesearch] store.get failed for ${launcherId} (skipping):`, err);
      return;
    }
    if (stored?.safesearchChecked) return;
    const until = this.failedUntil.get(launcherId);
    if (until !== undefined && this.now() < until) return;

    this.queued.add(launcherId);
    void this.gate(() => this.run(launcherId, media.url)).finally(() =>
      this.queued.delete(launcherId)
    );
  }

  private async run(launcherId: string, imageUri: string): Promise<void> {
    try {
      if (imageUri.startsWith(this.archiveBaseUrl)) {
        await this.waitForArchive(launcherId);
      }
      const result = await querySafeSearch(imageUri, {
        apiKey: this.opts.apiKey,
        fetchImpl: this.fetchImpl,
        timeoutMs: this.timeoutMs,
      });
      this.opts.store.putSafeSearch(launcherId, result);
      // on success, clear any prior failure suppression for this launcher
      this.failedUntil.delete(launcherId);
      if (result.sensitive) {
        this.opts.onFlag({
          type: "content-flag",
          launcherId,
          mediaFilter: "sensitive",
        });
      }
    } catch (err) {
      console.warn(`[safesearch] failed for ${launcherId} (${imageUri}):`, err);
      this.failedUntil.set(launcherId, this.now() + this.failTtlMs);
      // evict oldest entry if the map has grown too large
      if (this.failedUntil.size > FAILED_UNTIL_CAP) {
        const oldest = this.failedUntil.keys().next().value;
        if (oldest !== undefined) this.failedUntil.delete(oldest);
      }
    }
  }

  // Holds a concurrency-gate slot during inter-poll sleeps. With default settings
  // (3 attempts, 2 s delay, concurrency 2) a not-yet-ingested NFT can occupy a slot
  // for up to ~4 s of idle waiting. Self-healing: exhaustion releases the slot and
  // sets failedUntil, so the queue unblocks. Acceptable given SafeSearch is out-of-band.
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
