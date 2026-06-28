import type { GroveEvent, SproutEvent } from "@grove/shared";
import type { MediaIndex } from "../web/media-index.js";
import { LEXICON, matchesLexicon } from "./signals/lexicon.js";
import { DENYLIST_MAP, dispositionForCollection } from "./signals/denylist.js";

export type Disposition = "blocked" | "sensitive" | "ok";

const asRecord = (v: unknown): Record<string, unknown> =>
  typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};

/**
 * sensitive_content per CHIP-0007 may be boolean, a string, or a non-empty list.
 * A bare descriptive string (e.g. "nudity") flags as sensitive too; only the
 * explicit negatives ("" / "false") and a literal `false` are treated as clear.
 */
const isSensitiveFlag = (v: unknown): boolean => {
  if (v === true) return true;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    return s !== "" && s !== "false";
  }
  return Array.isArray(v) && v.length > 0;
};

const RANK: Record<Disposition, number> = { ok: 0, sensitive: 1, blocked: 2 };

/** Strongest disposition under `blocked > sensitive > ok`. */
const strongest = (...ds: Disposition[]): Disposition =>
  ds.reduce((a, b) => (RANK[b] > RANK[a] ? b : a), "ok");

export interface MapMintgardenOpts {
  /** Override the adult-term lexicon (test injection). Defaults to LEXICON. */
  lexicon?: string[];
  /** Override the collection denylist map (test injection). Defaults to DENYLIST_MAP. */
  denylist?: Map<string, Disposition>;
}

/**
 * Collapse a MintGarden GET /nfts/:id response object into one disposition,
 * combining three signals: MintGarden structured flags, a curated collection
 * denylist, and a text-keyword heuristic over name/description fields.
 * Blocked (hard takedown) wins over sensitive (NSFW). Anything unrecognized or
 * malformed maps to "ok" (permissive) — the filter only acts on positive flags.
 */
export function mapMintgarden(json: unknown, opts: MapMintgardenOpts = {}): Disposition {
  const lexicon = opts.lexicon ?? LEXICON;
  const denylist = opts.denylist ?? DENYLIST_MAP;

  const nft = asRecord(json);
  const collection = asRecord(nft.collection);
  const creator = asRecord(nft.creator);
  const metadata = asRecord(asRecord(nft.data).metadata_json);

  // 1. existing MintGarden structured flags (unchanged precedence)
  const flagVerdict: Disposition =
    nft.is_blocked === true ||
    collection.blocked_content === true ||
    creator.verification_state === 2
      ? "blocked"
      : isSensitiveFlag(collection.sensitive_content) || isSensitiveFlag(metadata.sensitive_content)
        ? "sensitive"
        : "ok";

  // 2. curated collection denylist, keyed by MintGarden collection id
  const collectionId = typeof collection.id === "string" ? collection.id : undefined;
  const denyVerdict = dispositionForCollection(denylist, collectionId) ?? "ok";

  // 3. text-keyword heuristic over name / collection name / description
  const text = [nft.name, metadata.name, collection.name, metadata.description]
    .filter((s): s is string => typeof s === "string")
    .join(" ");
  const textVerdict: Disposition = matchesLexicon(text, lexicon) ? "sensitive" : "ok";

  return strongest(flagVerdict, denyVerdict, textVerdict);
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
  private readonly cache = new Map<string, Disposition>();
  /** nftId -> epoch ms until which a recent failure keeps it permissive without refetch */
  private readonly negativeUntil = new Map<string, number>();
  private readonly inflight = new Map<string, Promise<Disposition>>();
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly concurrency: number;
  private readonly cacheCapacity: number;
  private readonly enrichBudgetMs: number;
  private readonly failTtlMs: number;
  private readonly now: () => number;
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

    const until = this.negativeUntil.get(nftId);
    if (until !== undefined) {
      // a recent failure keeps us permissive without hammering a struggling
      // MintGarden every block; once the TTL lapses we let the next lookup retry
      if (this.now() < until) return Promise.resolve("ok");
      this.negativeUntil.delete(nftId);
    }

    const existing = this.inflight.get(nftId);
    if (existing !== undefined) return existing;

    const promise = this.gate(() => this.fetchDisposition(nftId))
      .then((disposition) => {
        this.remember(nftId, disposition);
        return disposition;
      })
      .catch(() => {
        // transient failure/timeout: permissive now, negatively cached briefly so
        // the same doomed lookup doesn't re-stall the next block
        this.rememberFailure(nftId);
        return "ok" as Disposition;
      })
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
      if (res.status === 404) return "ok"; // genuinely unknown to MintGarden → cacheable permissive
      if (!res.ok) throw new Error(`mintgarden ${res.status}`); // 5xx/429/etc → transient, don't poison the cache
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
