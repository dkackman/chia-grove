import { expect, test } from "vitest";
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
