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
  expect(store.getSafeSearchByContentHash(HASH)).toEqual({ adult: "LIKELY", raw: { adult: "LIKELY" } });
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
