import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { MediaKind, SproutEvent } from "@grove/shared";
import type { MediaEntry, MediaIndex } from "./media-index.js";

export interface CollectionOptions {
  /**
   * Whether this NFT may be shown in the permanent collection right now.
   * Asked on every `list()`, so a verdict that turns sensitive later takes the
   * piece down without anyone having to tell the collection. Must fail closed:
   * unknown / unverifiable → false.
   */
  isClean: (launcherId: string) => boolean;
  /** Most candidates kept (oldest dropped first). Default 150. */
  capacity?: number;
}

interface Row {
  launcher_id: string;
  nft_id: string | null;
  coin_id: string;
  height: number;
  mint: number;
  url: string;
  kind: string;
  fallback_url: string | null;
  thumbnail_url: string | null;
}

/**
 * The gallery's permanent collection: a small, persistent set of recently seen
 * image NFTs, so the wall has art on it even when the live window holds no NFT
 * spends (they are sparse — roughly one per 18 blocks) or right after a deploy
 * emptied the in-memory buffers.
 *
 * It stores *candidates* — every image NFT the live ingest saw with a clean
 * cheap verdict — and decides what is actually shown at read time by asking
 * `isClean`, which the server wires to the content-filter's persisted verdict
 * (see index.ts). Unlike the live feed, which fails open, this fails closed:
 * a piece is only listed while its verdict is positively clean, and one that
 * is flagged later is deleted on the next read or by `remove()`.
 *
 * Art URLs never leave the server. Each candidate's `MediaEntry` is pinned in
 * the `MediaIndex` (and re-pinned from disk on startup) so `/img?nft=` keeps
 * resolving it after the live entry evicts.
 */
export class Collection {
  private readonly db: DatabaseSync;
  private readonly capacity: number;

  constructor(
    dbPath: string,
    private readonly media: MediaIndex,
    private readonly opts: CollectionOptions
  ) {
    this.capacity = opts.capacity ?? 150;
    if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS piece (
        seq           INTEGER PRIMARY KEY AUTOINCREMENT,
        launcher_id   TEXT NOT NULL UNIQUE,
        nft_id        TEXT,
        coin_id       TEXT NOT NULL,
        height        INTEGER NOT NULL,
        mint          INTEGER NOT NULL,
        url           TEXT NOT NULL,
        kind          TEXT NOT NULL,
        fallback_url  TEXT,
        thumbnail_url TEXT
      );
    `);
    for (const row of this.rows()) this.media.pin(row.launcher_id, entryOf(row));
  }

  private rows(): Row[] {
    return this.db.prepare("SELECT * FROM piece ORDER BY seq DESC").all() as unknown as Row[];
  }

  /**
   * Consider a live NFT spend for the collection. Only still images whose art
   * the server can proxy and whose cheap verdict was clean (no `mediaFilter`)
   * become candidates; call it after the content filter has stamped the event.
   * A repeat spend moves the piece back to the front.
   */
  offer(event: SproutEvent): void {
    if (event.kind !== "nft" || !event.launcherId) return;
    if (event.mediaKind !== "image" || event.mediaFilter) return;
    const entry = this.media.get(event.launcherId);
    if (!entry || entry.kind !== "image") return;
    this.db.prepare("DELETE FROM piece WHERE launcher_id = ?").run(event.launcherId);
    this.db
      .prepare(
        `INSERT INTO piece (launcher_id, nft_id, coin_id, height, mint, url, kind, fallback_url, thumbnail_url)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        event.launcherId,
        event.nftId ?? null,
        event.coinId,
        event.height,
        event.mint ? 1 : 0,
        entry.url,
        entry.kind,
        entry.fallbackUrl ?? null,
        entry.thumbnailUrl ?? null
      );
    this.media.pin(event.launcherId, { ...entry });
    this.trim();
  }

  /**
   * Fill an empty collection from already-verified art (newest first), so a
   * fresh install has something to hang before the chain supplies it. Does
   * nothing once any candidate exists. The block these were spent in is not
   * known, so they carry height 0 and the launcher coin's own id.
   */
  seed(pieces: Array<{ launcherId: string; nftId?: string; uri: string }>): number {
    if (this.size > 0) return 0;
    let added = 0;
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO piece (launcher_id, nft_id, coin_id, height, mint, url, kind)
       VALUES (?, ?, ?, 0, 0, ?, 'image')`
    );
    // oldest first, so the newest seed ends up at the front
    for (const piece of pieces.slice(0, this.capacity).reverse()) {
      // a video is SafeSearch-checked by its poster; that is not its art
      if (!/^https:\/\//.test(piece.uri) || piece.uri.includes("/thumbnails/")) continue;
      const result = insert.run(piece.launcherId, piece.nftId ?? null, piece.launcherId, piece.uri);
      if (result.changes === 0) continue;
      this.media.pin(piece.launcherId, { url: piece.uri, kind: "image" });
      added++;
    }
    return added;
  }

  private trim(): void {
    const stale = this.db
      .prepare("SELECT launcher_id FROM piece ORDER BY seq DESC LIMIT -1 OFFSET ?")
      .all(this.capacity) as Array<{ launcher_id: string }>;
    for (const { launcher_id } of stale) this.remove(launcher_id);
  }

  /** Take a piece out for good (flagged sensitive/blocked) and release its pin. */
  remove(launcherId: string): void {
    this.db.prepare("DELETE FROM piece WHERE launcher_id = ?").run(launcherId);
    this.media.unpin(launcherId);
  }

  /** Reorg: forget candidates collected from blocks at or above `forkHeight`. */
  removeFrom(forkHeight: number): void {
    const doomed = this.db
      .prepare("SELECT launcher_id FROM piece WHERE height >= ?")
      .all(forkHeight) as Array<{ launcher_id: string }>;
    for (const { launcher_id } of doomed) this.remove(launcher_id);
  }

  /**
   * Up to `limit` showable pieces, newest first, as NFT sprout events. Every
   * candidate is re-checked against `isClean`; the ones that fail are skipped
   * (they may simply not be verified yet) and never returned.
   */
  list(limit: number): SproutEvent[] {
    const pieces: SproutEvent[] = [];
    for (const row of this.rows()) {
      if (pieces.length >= limit) break;
      let clean: boolean;
      try {
        clean = this.opts.isClean(row.launcher_id);
      } catch {
        clean = false; // fail closed
      }
      if (!clean) continue;
      const piece: SproutEvent = {
        type: "sprout",
        kind: "nft",
        height: row.height,
        coinId: row.coin_id,
        amount: "1",
        launcherId: row.launcher_id,
        mediaKind: row.kind as MediaKind,
      };
      if (row.nft_id) piece.nftId = row.nft_id;
      if (row.mint) piece.mint = true;
      pieces.push(piece);
    }
    return pieces;
  }

  /** Candidates currently held (shown or not) — diagnostics/tests. */
  get size(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM piece").get() as { n: number };
    return row.n;
  }

  close(): void {
    this.db.close();
  }
}

function entryOf(row: Row): MediaEntry {
  const entry: MediaEntry = { url: row.url, kind: row.kind as MediaKind };
  if (row.fallback_url) entry.fallbackUrl = row.fallback_url;
  if (row.thumbnail_url) entry.thumbnailUrl = row.thumbnail_url;
  return entry;
}
