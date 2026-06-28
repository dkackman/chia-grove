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
}

/**
 * Out-of-band SafeSearch path. `maybeEnqueue` is fire-and-forget: eligible image
 * mints whose cheap verdict was `ok` get a single Vision lookup behind a bounded
 * concurrency gate. A `sensitive` result is persisted and pushed to clients as a
 * `content-flag`. Failures leave the NFT permissive and are suppressed for
 * `failTtlMs` so an outage doesn't re-spend the paid quota every block.
 */
const FAILED_UNTIL_CAP = 10000;

export class SafeSearchWorker {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly concurrency: number;
  private readonly failTtlMs: number;
  private readonly now: () => number;
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
  }

  maybeEnqueue(event: SproutEvent): void {
    if (event.kind !== "nft" || event.mint !== true || event.mediaKind !== "image") return;
    const launcherId = event.launcherId;
    if (!launcherId || this.queued.has(launcherId)) return;
    const media = this.opts.media.get(launcherId);
    if (!media || media.kind !== "image") return;
    const stored = this.opts.store.get(launcherId);
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
      const result = await querySafeSearch(imageUri, {
        apiKey: this.opts.apiKey,
        fetchImpl: this.fetchImpl,
        timeoutMs: this.timeoutMs,
      });
      const updated = this.opts.store.putSafeSearch(launcherId, result);
      // on success, clear any prior failure suppression for this launcher
      this.failedUntil.delete(launcherId);
      if (result.sensitive) {
        this.opts.onFlag({
          type: "content-flag",
          launcherId,
          mediaFilter: "sensitive",
          signals: updated.signals,
        });
      }
    } catch {
      this.failedUntil.set(launcherId, this.now() + this.failTtlMs);
      // evict oldest entry if the map has grown too large
      if (this.failedUntil.size > FAILED_UNTIL_CAP) {
        const oldest = this.failedUntil.keys().next().value;
        if (oldest !== undefined) this.failedUntil.delete(oldest);
      }
    }
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
