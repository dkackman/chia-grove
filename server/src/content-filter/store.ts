import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Disposition, Verdict } from "./types.js";
import { strongest } from "./verdict.js";

export interface StoredVerdict {
  disposition: Disposition;
  safesearchChecked: boolean;
  contentHash?: string;
  /** Cheap signal that produced `disposition` (see Verdict.signal); persisted
   *  so a later cache-hit re-spend can still log which signal decided it. */
  signal?: string;
}

interface Row {
  disposition: string;
  safesearch_checked_at: number | null;
  content_hash: string | null;
  signal: string | null;
}

/**
 * Persistent per-NFT verdict cache, keyed by launcherId (stable across spends and
 * shared with the /img proxy + client). One row per NFT is the cache and the audit
 * trail; `safesearch_checked_at IS NULL` is the "SafeSearch not yet run" sentinel.
 */
export class ContentStore {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS nft (
        launcher_id           TEXT PRIMARY KEY,
        nft_id                TEXT,
        disposition           TEXT NOT NULL,
        safesearch_adult      TEXT,
        safesearch_raw_json   TEXT,
        safesearch_checked_at INTEGER,
        checked_at            INTEGER NOT NULL,
        content_hash          TEXT
      );
    `);
    // Added after the initial release; existing prod databases need it backfilled in place.
    // ALTER TABLE ADD COLUMN has no IF NOT EXISTS form, so check first.
    const columns = this.db.prepare("PRAGMA table_info(nft)").all() as Array<{ name: string }>;
    if (!columns.some((c) => c.name === "checked_uri")) {
      this.db.exec("ALTER TABLE nft ADD COLUMN checked_uri TEXT;");
    }
    if (!columns.some((c) => c.name === "signal")) {
      this.db.exec("ALTER TABLE nft ADD COLUMN signal TEXT;");
    }
    // Index the content-hash dedup lookup (getSafeSearchByContentHash); without
    // it that query full-scans a table that grows one row per NFT ever seen.
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_nft_content_hash ON nft (content_hash);");
    // Fallback dedup key (getSafeSearchByUri) for when MintGarden hasn't resolved
    // a content_hash yet — see comment on getSafeSearchByUri.
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_nft_checked_uri ON nft (checked_uri);");
  }

  get(launcherId: string): StoredVerdict | undefined {
    const row = this.db
      .prepare(
        "SELECT disposition, safesearch_checked_at, content_hash, signal FROM nft WHERE launcher_id = ?"
      )
      .get(launcherId) as Row | undefined;
    if (!row) return undefined;
    return {
      disposition: row.disposition as Disposition,
      safesearchChecked: row.safesearch_checked_at !== null,
      contentHash: row.content_hash ?? undefined,
      signal: row.signal ?? undefined,
    };
  }

  putCheap(
    launcherId: string,
    nftId: string | undefined,
    verdict: Verdict,
    contentHash?: string,
    skipSafesearch?: boolean
  ): void {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO nft (launcher_id, nft_id, disposition, content_hash, checked_at, safesearch_checked_at, signal)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(launcher_id) DO UPDATE SET
           nft_id = excluded.nft_id,
           disposition = excluded.disposition,
           content_hash = COALESCE(excluded.content_hash, nft.content_hash),
           checked_at = excluded.checked_at,
           -- nft.safesearch_checked_at first: once a row is stamped (real check or
           -- allow-list skip-stamp), a later un-flagged putCheap (e.g. a re-spend
           -- cache-miss with skipSafesearch left undefined) must never un-check it.
           safesearch_checked_at = COALESCE(nft.safesearch_checked_at, excluded.safesearch_checked_at),
           signal = excluded.signal`
      )
      .run(
        launcherId,
        nftId ?? null,
        verdict.disposition,
        contentHash ?? null,
        now,
        skipSafesearch ? now : null,
        verdict.signal ?? null
      );
  }

  putSafeSearch(
    launcherId: string,
    result: { sensitive: boolean; adult: string; raw: unknown },
    imageUri?: string,
    /** Signal that decided a promotion (e.g. "vision", "vision-reused");
     *  only applied when `result.sensitive` actually flips the disposition —
     *  a clean SafeSearch result leaves the cheap-tier signal in place. */
    signal?: string
  ): StoredVerdict {
    const current = this.get(launcherId) ?? {
      disposition: "ok" as Disposition,
      safesearchChecked: false,
    };
    const disposition = result.sensitive
      ? strongest(current.disposition, "sensitive")
      : current.disposition;
    const rowSignal = result.sensitive ? (signal ?? current.signal) : current.signal;
    this.db
      .prepare(
        `INSERT INTO nft (launcher_id, disposition, safesearch_adult, safesearch_raw_json, safesearch_checked_at, checked_at, checked_uri, signal)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(launcher_id) DO UPDATE SET
           disposition = excluded.disposition,
           safesearch_adult = excluded.safesearch_adult,
           safesearch_raw_json = excluded.safesearch_raw_json,
           safesearch_checked_at = excluded.safesearch_checked_at,
           checked_uri = excluded.checked_uri,
           signal = excluded.signal`
      )
      .run(
        launcherId,
        disposition,
        result.adult,
        JSON.stringify(result.raw),
        Date.now(),
        Date.now(),
        imageUri ?? null,
        rowSignal ?? null
      );
    return { disposition, safesearchChecked: true, signal: rowSignal };
  }

  /**
   * The most recent SafeSearch result recorded for any NFT sharing this content
   * hash, or undefined if none has been SafeSearch-checked yet. Lets a new NFT
   * with identical bytes reuse the verdict instead of paying for a second lookup.
   */
  getSafeSearchByContentHash(contentHash: string): { adult: string; raw: unknown } | undefined {
    const row = this.db
      .prepare(
        `SELECT safesearch_adult, safesearch_raw_json FROM nft
         WHERE content_hash = ? AND safesearch_checked_at IS NOT NULL AND safesearch_adult IS NOT NULL
         ORDER BY safesearch_checked_at DESC LIMIT 1`
      )
      .get(contentHash) as
      { safesearch_adult: string | null; safesearch_raw_json: string | null } | undefined;
    if (!row) return undefined;
    return {
      adult: row.safesearch_adult ?? "UNKNOWN",
      raw: row.safesearch_raw_json ? JSON.parse(row.safesearch_raw_json) : null,
    };
  }

  /**
   * The most recent SafeSearch result recorded for any NFT whose Vision check
   * used this exact image URI, or undefined if none has been checked. Fallback
   * for getSafeSearchByContentHash when MintGarden hasn't resolved a
   * content_hash yet (its indexer lags mint time, sometimes indefinitely for a
   * given collection) — identical on-chain bytes still produce an identical
   * URI, so this still catches duplicate editions minted in the same batch.
   */
  getSafeSearchByUri(uri: string): { adult: string; raw: unknown } | undefined {
    const row = this.db
      .prepare(
        `SELECT safesearch_adult, safesearch_raw_json FROM nft
         WHERE checked_uri = ? AND safesearch_checked_at IS NOT NULL AND safesearch_adult IS NOT NULL
         ORDER BY safesearch_checked_at DESC LIMIT 1`
      )
      .get(uri) as
      { safesearch_adult: string | null; safesearch_raw_json: string | null } | undefined;
    if (!row) return undefined;
    return {
      adult: row.safesearch_adult ?? "UNKNOWN",
      raw: row.safesearch_raw_json ? JSON.parse(row.safesearch_raw_json) : null,
    };
  }

  close(): void {
    this.db.close();
  }
}
