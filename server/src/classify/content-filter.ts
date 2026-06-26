import type { GroveEvent, SproutEvent } from "@grove/shared";
import type { MediaIndex } from "../web/media-index.js";

export type Disposition = "blocked" | "sensitive" | "ok";

const asRecord = (v: unknown): Record<string, unknown> =>
  typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};

/** sensitive_content per CHIP-0007 may be boolean, the string "true", or a non-empty list. */
const isSensitiveFlag = (v: unknown): boolean =>
  v === true || v === "true" || (Array.isArray(v) && v.length > 0);

/**
 * Collapse a MintGarden GET /nfts/:id response object into one disposition.
 * Blocked (hard takedown) wins over sensitive (NSFW). Anything unrecognized or
 * malformed maps to "ok" (permissive) — the filter only acts on positive flags.
 */
export function mapMintgarden(json: unknown): Disposition {
  const nft = asRecord(json);
  const collection = asRecord(nft.collection);
  const creator = asRecord(nft.creator);
  const metadata = asRecord(asRecord(nft.data).metadata_json);

  if (
    nft.is_blocked === true ||
    collection.blocked_content === true ||
    creator.verification_state === 2
  ) {
    return "blocked";
  }
  if (
    isSensitiveFlag(collection.sensitive_content) ||
    isSensitiveFlag(metadata.sensitive_content)
  ) {
    return "sensitive";
  }
  return "ok";
}

export interface ContentFilterOptions {
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
  concurrency?: number;
  cacheCapacity?: number;
}

/**
 * Enriches NFT sprout events with a `mediaFilter` flag by resolving each NFT's
 * disposition from MintGarden. Determinations are cached per nftId (sensitivity
 * is stable per NFT) behind a bounded concurrency gate with a per-request
 * timeout; any failure is permissive ("ok") and not cached so a later spend can
 * retry. Blocked NFTs also have their MediaIndex entry dropped so /img cannot
 * serve the bytes (defense in depth, independent of the client flag).
 */
export class ContentFilter {
  private readonly cache = new Map<string, Disposition>();
  private readonly inflight = new Map<string, Promise<Disposition>>();
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly concurrency: number;
  private readonly cacheCapacity: number;
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
  }

  async enrich(events: GroveEvent[]): Promise<void> {
    const nfts = events.filter(
      (e): e is SproutEvent =>
        e.type === "sprout" && e.kind === "nft" && typeof e.nftId === "string"
    );
    await Promise.all(nfts.map((e) => this.apply(e)));
  }

  private async apply(event: SproutEvent): Promise<void> {
    const disposition = await this.resolve(event.nftId!);
    if (disposition === "blocked") {
      event.mediaFilter = "blocked";
      if (event.launcherId) this.media.delete(event.launcherId);
    } else if (disposition === "sensitive") {
      event.mediaFilter = "sensitive";
    }
  }

  private resolve(nftId: string): Promise<Disposition> {
    const cached = this.cache.get(nftId);
    if (cached !== undefined) return Promise.resolve(cached);

    const existing = this.inflight.get(nftId);
    if (existing !== undefined) return existing;

    const promise = this.gate(() => this.fetchDisposition(nftId))
      .then((disposition) => {
        this.remember(nftId, disposition);
        return disposition;
      })
      .catch(() => "ok" as Disposition) // transient failure: permissive, not cached so we retry later
      .finally(() => {
        this.inflight.delete(nftId);
      });

    this.inflight.set(nftId, promise);
    return promise;
  }

  private async fetchDisposition(nftId: string): Promise<Disposition> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/nfts/${nftId}`, {
        signal: controller.signal,
      });
      if (!res.ok) return "ok"; // 404 (unknown to MintGarden) / 5xx → permissive, cacheable
      return mapMintgarden(await res.json());
    } finally {
      clearTimeout(timer);
    }
  }

  private remember(nftId: string, disposition: Disposition): void {
    this.cache.delete(nftId);
    this.cache.set(nftId, disposition);
    if (this.cache.size > this.cacheCapacity) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
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
