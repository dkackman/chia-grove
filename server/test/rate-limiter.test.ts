import { expect, test } from "vitest";
import { RateLimiter } from "../src/web/rate-limiter.js";

test("allows up to maxPerWindow hits then rejects", () => {
  const now = 0;
  const limiter = new RateLimiter(60_000, 3, () => now);
  expect(limiter.limited("ip1")).toBe(false);
  expect(limiter.limited("ip1")).toBe(false);
  expect(limiter.limited("ip1")).toBe(false);
  expect(limiter.limited("ip1")).toBe(true); // 4th hit within the window is rejected
});

test("a hit outside the window resets availability", () => {
  let now = 0;
  const limiter = new RateLimiter(60_000, 2, () => now);
  expect(limiter.limited("ip1")).toBe(false);
  expect(limiter.limited("ip1")).toBe(false);
  expect(limiter.limited("ip1")).toBe(true); // window full

  now += 60_001; // past the window — earlier hits have aged out
  expect(limiter.limited("ip1")).toBe(false);
});

test("different keys are tracked independently", () => {
  const now = 0;
  const limiter = new RateLimiter(60_000, 1, () => now);
  expect(limiter.limited("ip1")).toBe(false);
  expect(limiter.limited("ip1")).toBe(true);
  expect(limiter.limited("ip2")).toBe(false); // separate bucket, unaffected by ip1
});

test("sweep() removes fully-stale keys and keeps ones with recent hits", () => {
  let now = 0;
  const limiter = new RateLimiter(60_000, 1, () => now);
  limiter.limited("stale"); // one hit, about to age out
  now += 30_000;
  limiter.limited("fresh"); // one hit, still live after the sweep
  now += 30_001; // "stale" hit is now 60_001ms old (expired); "fresh" is 30_001ms (live)
  limiter.sweep();

  // "stale" had its only hit swept away, so it's back to full availability
  expect(limiter.limited("stale")).toBe(false);
  // "fresh" still has its one recent hit counted, so it's already at capacity
  expect(limiter.limited("fresh")).toBe(true);
});
