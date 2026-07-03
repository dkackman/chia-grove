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

// --- exponential backoff (maxTtlMs > baseTtlMs) ---

test("consecutive failures double the block window up to the ceiling", () => {
  let now = 0;
  // base 30s, cap 240s, generous reset so the streak keeps climbing
  const cache = new FailureCache(30_000, 100, () => now, 240_000, 10 * 60_000);

  cache.mark("a"); // 1st failure → 30s
  now += 29_999;
  expect(cache.has("a")).toBe(true);
  now += 2; // 30_001ms → window elapsed
  expect(cache.has("a")).toBe(false);

  cache.mark("a"); // 2nd → 60s
  now += 59_999;
  expect(cache.has("a")).toBe(true);
  now += 2;
  expect(cache.has("a")).toBe(false);

  cache.mark("a"); // 3rd → 120s
  now += 120_001;
  expect(cache.has("a")).toBe(false);

  cache.mark("a"); // 4th → 240s (cap)
  now += 239_999;
  expect(cache.has("a")).toBe(true);
  cache.mark("a"); // 5th stays at the 240s cap, not 480s
  now += 240_001;
  expect(cache.has("a")).toBe(false);
});

test("clear() resets the streak so the next failure starts at the base delay", () => {
  let now = 0;
  const cache = new FailureCache(30_000, 100, () => now, 240_000, 10 * 60_000);
  cache.mark("a"); // 30s
  now += 30_001;
  cache.mark("a"); // would be 60s
  cache.clear("a"); // recovered
  now += 1;
  cache.mark("a"); // fresh streak → back to 30s, not 120s
  now += 29_999;
  expect(cache.has("a")).toBe(true);
  now += 2;
  expect(cache.has("a")).toBe(false);
});

test("a failure after a long quiet spell restarts the backoff at the base delay", () => {
  let now = 0;
  const cache = new FailureCache(30_000, 100, () => now, 240_000, 120_000);
  cache.mark("a"); // 30s
  now += 30_001;
  cache.mark("a"); // 60s (within the 120s reset window → streak continues)
  now += 60_001;
  now += 120_001; // now well past resetAfterMs since the last mark
  cache.mark("a"); // streak reset → 30s again
  now += 29_999;
  expect(cache.has("a")).toBe(true);
  now += 2;
  expect(cache.has("a")).toBe(false);
});
