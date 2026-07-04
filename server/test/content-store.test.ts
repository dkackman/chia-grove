import { expect, test } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ContentStore } from "../src/content-filter/store.js";

test("putCheap then get round-trips disposition, safesearch not yet checked", () => {
  const store = new ContentStore(":memory:");
  store.putCheap("launch1", "nft1abc", { disposition: "sensitive" });
  expect(store.get("launch1")).toEqual({
    disposition: "sensitive",
    safesearchChecked: false,
  });
  expect(store.get("missing")).toBeUndefined();
  store.close();
});

test("putCheap with skipSafesearch stamps safesearchChecked immediately", () => {
  const store = new ContentStore(":memory:");
  store.putCheap("lid4", "nft1d", { disposition: "ok", whitelisted: true }, undefined, true);
  const v = store.get("lid4");
  expect(v?.disposition).toBe("ok");
  expect(v?.safesearchChecked).toBe(true);
  store.close();
});

test("putCheap without skipSafesearch does not clobber an already-stamped safesearchChecked", () => {
  const store = new ContentStore(":memory:");
  store.putCheap("lid5", "nft1e", { disposition: "ok" }, undefined, true);
  // a later re-spend re-runs putCheap without the flag (e.g. cache-miss path) —
  // must not un-stamp a row that was already marked checked
  store.putCheap("lid5", "nft1e", { disposition: "ok" });
  const v = store.get("lid5");
  expect(v?.safesearchChecked).toBe(true);
  store.close();
});

test("putCheap without skipSafesearch on a fresh row leaves safesearchChecked false", () => {
  const store = new ContentStore(":memory:");
  store.putCheap("lid6", "nft1f", { disposition: "ok" });
  const v = store.get("lid6");
  expect(v?.safesearchChecked).toBe(false);
  store.close();
});

test("putSafeSearch sensitive upgrades an ok row and records the check", () => {
  const store = new ContentStore(":memory:");
  store.putCheap("l", "nft1", { disposition: "ok" });
  const updated = store.putSafeSearch("l", {
    sensitive: true,
    adult: "VERY_LIKELY",
    raw: { adult: "VERY_LIKELY" },
  });
  expect(updated.disposition).toBe("sensitive");
  expect(updated.safesearchChecked).toBe(true);
  expect(store.get("l")).toEqual(updated);
  store.close();
});

test("putSafeSearch ok marks checked without changing disposition", () => {
  const store = new ContentStore(":memory:");
  store.putCheap("l", "nft1", { disposition: "ok" });
  const updated = store.putSafeSearch("l", { sensitive: false, adult: "UNLIKELY", raw: {} });
  expect(updated.disposition).toBe("ok");
  expect(updated.safesearchChecked).toBe(true);
  store.close();
});

test("getSafeSearchByContentHash returns a prior checked verdict for the same hash", () => {
  const store = new ContentStore(":memory:");
  const HASH = "ab".repeat(32);
  store.putCheap("L1", "nft1", { disposition: "ok" }, HASH);
  store.putSafeSearch("L1", { sensitive: true, adult: "LIKELY", raw: { adult: "LIKELY" } });
  expect(store.getSafeSearchByContentHash(HASH)).toEqual({
    adult: "LIKELY",
    raw: { adult: "LIKELY" },
  });
  store.close();
});

test("getSafeSearchByContentHash ignores rows that are only cheap-checked", () => {
  const store = new ContentStore(":memory:");
  const HASH = "cd".repeat(32);
  store.putCheap("L1", "nft1", { disposition: "ok" }, HASH); // no SafeSearch yet
  expect(store.getSafeSearchByContentHash(HASH)).toBeUndefined();
  expect(store.getSafeSearchByContentHash("ef".repeat(32))).toBeUndefined();
  store.close();
});

test("getSafeSearchByUri returns a prior checked verdict for the same image URI", () => {
  const store = new ContentStore(":memory:");
  const URI = "https://gw.example/ipfs/abc";
  store.putCheap("L1", "nft1", { disposition: "ok" }); // no content hash
  store.putSafeSearch("L1", { sensitive: true, adult: "LIKELY", raw: { adult: "LIKELY" } }, URI);
  expect(store.getSafeSearchByUri(URI)).toEqual({ adult: "LIKELY", raw: { adult: "LIKELY" } });
  store.close();
});

test("getSafeSearchByUri ignores rows that are only cheap-checked and unrelated URIs", () => {
  const store = new ContentStore(":memory:");
  const URI = "https://gw.example/ipfs/def";
  store.putCheap("L1", "nft1", { disposition: "ok" }); // no SafeSearch yet
  expect(store.getSafeSearchByUri(URI)).toBeUndefined();
  expect(store.getSafeSearchByUri("https://gw.example/ipfs/other")).toBeUndefined();
  store.close();
});

test("checked_uri is indexed so the URI-fallback dedup lookup is not a full table scan", () => {
  const path = join(mkdtempSync(join(tmpdir(), "cstore-")), "c.sqlite");
  new ContentStore(path).close();
  const db = new DatabaseSync(path);
  try {
    const indexes = db.prepare("PRAGMA index_list(nft)").all() as Array<{ name: string }>;
    const indexedColumns = indexes.flatMap((ix) =>
      (db.prepare(`PRAGMA index_info('${ix.name}')`).all() as Array<{ name: string }>).map(
        (c) => c.name
      )
    );
    expect(indexedColumns).toContain("checked_uri");
  } finally {
    db.close();
  }
});

test("opening an existing pre-checked_uri database migrates it in place", () => {
  const path = join(mkdtempSync(join(tmpdir(), "cstore-")), "c.sqlite");
  const legacy = new DatabaseSync(path);
  legacy.exec(`
    CREATE TABLE nft (
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
  legacy.close();

  const store = new ContentStore(path);
  const URI = "https://gw.example/ipfs/migrated";
  store.putCheap("L1", "nft1", { disposition: "ok" });
  store.putSafeSearch("L1", { sensitive: false, adult: "UNLIKELY", raw: {} }, URI);
  expect(store.getSafeSearchByUri(URI)).toEqual({ adult: "UNLIKELY", raw: {} });
  store.close();
});

test("content_hash is indexed so the dedup lookup is not a full table scan", () => {
  // open the produced db file with a fresh connection to inspect its real schema
  const path = join(mkdtempSync(join(tmpdir(), "cstore-")), "c.sqlite");
  new ContentStore(path).close();
  const db = new DatabaseSync(path);
  try {
    const indexes = db.prepare("PRAGMA index_list(nft)").all() as Array<{ name: string }>;
    const indexedColumns = indexes.flatMap((ix) =>
      (db.prepare(`PRAGMA index_info('${ix.name}')`).all() as Array<{ name: string }>).map(
        (c) => c.name
      )
    );
    expect(indexedColumns).toContain("content_hash");
  } finally {
    db.close();
  }
});
