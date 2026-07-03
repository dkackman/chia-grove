import { expect, test } from "vitest";
import { MediaCache } from "../src/web/media-cache.js";

const resp = (n: number) => ({ body: Buffer.alloc(n), contentType: "image/png" });

test("get returns undefined for a key that was never set", () => {
  const cache = new MediaCache(100);
  expect(cache.get("nope")).toBeUndefined();
});

test("stores and returns an entry", () => {
  const cache = new MediaCache(100);
  cache.set("a", { body: Buffer.from("PNG"), contentType: "image/png" });
  const got = cache.get("a");
  expect(got?.body.toString()).toBe("PNG");
  expect(got?.contentType).toBe("image/png");
});

test("evicts oldest entries until total bytes are within budget", () => {
  const cache = new MediaCache(10);
  cache.set("a", resp(4));
  cache.set("b", resp(4)); // total 8
  cache.set("c", resp(4)); // total 12 > 10 → evict oldest ("a")
  expect(cache.get("a")).toBeUndefined();
  expect(cache.get("b")).toBeDefined();
  expect(cache.get("c")).toBeDefined();
});

test("get promotes a key so it survives a later eviction", () => {
  const cache = new MediaCache(10);
  cache.set("a", resp(4));
  cache.set("b", resp(4)); // total 8
  cache.get("a"); // promote "a" to newest → "b" is now oldest
  cache.set("c", resp(4)); // total 12 > 10 → evict oldest ("b")
  expect(cache.get("b")).toBeUndefined();
  expect(cache.get("a")).toBeDefined();
  expect(cache.get("c")).toBeDefined();
});

test("a body larger than the whole budget is not stored and evicts nothing", () => {
  const cache = new MediaCache(10);
  cache.set("small", resp(4));
  cache.set("huge", resp(20)); // exceeds budget → refused
  expect(cache.get("huge")).toBeUndefined();
  expect(cache.get("small")).toBeDefined(); // untouched
});
