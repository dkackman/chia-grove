/**
 * Decides which URL a SafeSearch check actually classifies. Art on MintGarden's
 * ingestion-lagged CDNs (Archive content, assets-CDN posters) is HEAD-probed
 * until ready; if it never becomes ready, the on-chain original is used instead
 * — unless that is on a host Google's fetcher can't reach. Pulled out of
 * SafeSearchWorker so the worker is just queueing, dedup and persistence.
 */

/** Hosts Google's image fetcher is known not to reach (the reason the Archive
 *  upgrade exists) — a Vision call against them is a guaranteed failure, so
 *  don't pay the attempt. Only hosts confirmed unreachable belong here: listing
 *  a reachable gateway would silently skip a check that would have worked.
 *  Overridable via `visionUnreachableHosts` (env `VISION_UNREACHABLE_HOSTS`). */
export const DEFAULT_VISION_UNREACHABLE_HOSTS: readonly string[] = ["ipfs.mintgarden.io"];

export interface VisionTargetOpts {
  fetchImpl: typeof fetch;
  timeoutMs: number;
  archiveBaseUrl: string;
  thumbnailBaseUrl: string;
  archiveCheckAttempts: number;
  archiveCheckDelayMs: number;
  unreachableHosts?: Iterable<string>;
}

export class VisionTargetResolver {
  private readonly unreachableHosts: ReadonlySet<string>;

  constructor(private readonly opts: VisionTargetOpts) {
    this.unreachableHosts = new Set(
      [...(opts.unreachableHosts ?? DEFAULT_VISION_UNREACHABLE_HOSTS)].map((h) =>
        h.trim().toLowerCase()
      )
    );
  }

  /** Resolves the readiness-probed / fallback URL Vision (and the local
   *  classifier) should actually classify. */
  async resolve(imageUri: string, fallbackUri?: string): Promise<string> {
    if (!this.needsReadyProbe(imageUri)) return imageUri;
    const ready = await this.waitForContentReady(imageUri);
    if (ready) return imageUri;
    const fallback = this.usableFallback(imageUri, fallbackUri);
    if (!fallback) {
      throw new Error(`content not ready after ${this.opts.archiveCheckAttempts} attempts`);
    }
    // MintGarden never ingested these bytes; classify the on-chain original
    // instead of giving up. checked_uri records what was actually classified.
    return fallback;
  }

  /** The original art URL, if it is worth one Vision attempt: http(s), distinct
   *  from what we already tried, and not on a host Google cannot reach. */
  private usableFallback(imageUri: string, fallbackUri?: string): string | undefined {
    if (!fallbackUri || fallbackUri === imageUri) return undefined;
    try {
      const u = new URL(fallbackUri);
      if (u.protocol !== "https:" && u.protocol !== "http:") return undefined;
      if (this.unreachableHosts.has(u.hostname)) return undefined;
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
      imageUri.startsWith(this.opts.archiveBaseUrl + "/") ||
      imageUri.startsWith(this.opts.thumbnailBaseUrl + "/")
    );
  }

  // Runs outside the worker's Vision gate, so a not-yet-ingested NFT sleeps between polls
  // without occupying a paid-call slot; many waits proceed in parallel (capped by
  // maxPending, which bounds concurrent probes too). HEAD of the exact URL Vision
  // will fetch: ingested archive content answers an immutable 301 (to
  // files.mintgarden.io), existing thumbnails 200, missing content 404 — so any
  // 2xx/3xx is ready and everything else (incl. network errors) retries.
  private async waitForContentReady(url: string): Promise<boolean> {
    for (let attempt = 0; attempt < this.opts.archiveCheckAttempts; attempt++) {
      if (attempt > 0 && this.opts.archiveCheckDelayMs > 0) {
        await new Promise<void>((r) => setTimeout(r, this.opts.archiveCheckDelayMs));
      }
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs);
        let res: Response;
        try {
          res = await this.opts.fetchImpl(url, {
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
}
