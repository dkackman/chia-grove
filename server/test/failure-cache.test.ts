import { expect, test } from "vitest";
import { FailureCache } from "../src/web/failure-cache.js";

test("has() is true right after mark and stays true within the TTL", () => {
  let now = 1000;
  const cache = new FailureCache(60_000, 100, () => now);
  cache.mark("a");
  expect(cache.has("a")).toBe(true);
  now += 59_000; // still inside the 60s window
  expect(cache.has("a")).toBe(true);
});

test("has() is false once the TTL has elapsed", () => {
  let now = 1000;
  const cache = new FailureCache(60_000, 100, () => now);
  cache.mark("a");
  now += 60_001; // past the window
  expect(cache.has("a")).toBe(false);
});

test("has() is false for a key that was never marked", () => {
  const cache = new FailureCache(60_000, 100, () => 0);
  expect(cache.has("never")).toBe(false);
});

test("mark evicts the oldest entry once capacity is exceeded", () => {
  let now = 0;
  const cache = new FailureCache(60_000, 2, () => now);
  cache.mark("a");
  now += 1;
  cache.mark("b");
  now += 1;
  cache.mark("c"); // exceeds capacity 2 → oldest ("a") evicted
  expect(cache.has("a")).toBe(false);
  expect(cache.has("b")).toBe(true);
  expect(cache.has("c")).toBe(true);
});

test("sweep() drops expired entries but keeps live ones", () => {
  let now = 0;
  const cache = new FailureCache(60_000, 100, () => now);
  cache.mark("old");
  now += 30_000;
  cache.mark("fresh");
  now += 30_001; // "old" is now 60_001ms old (expired); "fresh" is 30_001ms (live)
  cache.sweep();
  expect(cache.has("old")).toBe(false);
  expect(cache.has("fresh")).toBe(true);
});
