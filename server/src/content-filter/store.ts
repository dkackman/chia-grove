import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Disposition, SignalName, Verdict } from "./types.js";
import { strongest } from "./verdict.js";

export interface StoredVerdict {
  disposition: Disposition;
  signals: SignalName[];
  safesearchChecked: boolean;
  contentHash?: string;
}

interface Row {
  disposition: string;
  signals_json: string;
  safesearch_checked_at: number | null;
  content_hash: string | null;
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
        signals_json          TEXT NOT NULL,
        safesearch_adult      TEXT,
        safesearch_raw_json   TEXT,
        safesearch_checked_at INTEGER,
        checked_at            INTEGER NOT NULL,
        content_hash          TEXT
      );
    `);
  }

  get(launcherId: string): StoredVerdict | undefined {
    const row = this.db
      .prepare(
        "SELECT disposition, signals_json, safesearch_checked_at, content_hash FROM nft WHERE launcher_id = ?"
      )
      .get(launcherId) as Row | undefined;
    if (!row) return undefined;
    return {
      disposition: row.disposition as Disposition,
      signals: JSON.parse(row.signals_json) as SignalName[],
      safesearchChecked: row.safesearch_checked_at !== null,
      contentHash: row.content_hash ?? undefined,
    };
  }

  putCheap(launcherId: string, nftId: string | undefined, verdict: Verdict, contentHash?: string): void {
    this.db
      .prepare(
        `INSERT INTO nft (launcher_id, nft_id, disposition, signals_json, content_hash, checked_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(launcher_id) DO UPDATE SET
           nft_id = excluded.nft_id,
           disposition = excluded.disposition,
           signals_json = excluded.signals_json,
           content_hash = COALESCE(excluded.content_hash, nft.content_hash),
           checked_at = excluded.checked_at`
      )
      .run(
        launcherId,
        nftId ?? null,
        verdict.disposition,
        JSON.stringify(verdict.signals),
        contentHash ?? null,
        Date.now()
      );
  }

  putSafeSearch(
    launcherId: string,
    result: { sensitive: boolean; adult: string; raw: unknown }
  ): StoredVerdict {
    const current = this.get(launcherId) ?? {
      disposition: "ok" as Disposition,
      signals: [] as SignalName[],
      safesearchChecked: false,
    };
    const signals = result.sensitive
      ? Array.from(new Set([...current.signals, "safesearch" as SignalName]))
      : current.signals.filter((s) => s !== "safesearch");
    const disposition = result.sensitive
      ? strongest(current.disposition, "sensitive")
      : current.disposition;
    this.db
      .prepare(
        `INSERT INTO nft (launcher_id, disposition, signals_json, safesearch_adult, safesearch_raw_json, safesearch_checked_at, checked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(launcher_id) DO UPDATE SET
           disposition = excluded.disposition,
           signals_json = excluded.signals_json,
           safesearch_adult = excluded.safesearch_adult,
           safesearch_raw_json = excluded.safesearch_raw_json,
           safesearch_checked_at = excluded.safesearch_checked_at`
      )
      .run(
        launcherId,
        disposition,
        JSON.stringify(signals),
        result.adult,
        JSON.stringify(result.raw),
        Date.now(),
        Date.now()
      );
    return { disposition, signals, safesearchChecked: true };
  }

  close(): void {
    this.db.close();
  }
}
