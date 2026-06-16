import { expect, test } from "vitest";
import { createFrameLimiter } from "../src/themes/shared/frame-limiter.js";

test("renders the first tick", () => {
  const limiter = createFrameLimiter(48);
  expect(limiter.shouldRender(0)).toBe(true);
});

test("skips ticks that arrive faster than the target interval", () => {
  const limiter = createFrameLimiter(48); // ~20.83 ms interval
  limiter.shouldRender(0);
  expect(limiter.shouldRender(10)).toBe(false); // 10 ms < 20.83 ms
});

test("renders once the target interval has elapsed", () => {
  const limiter = createFrameLimiter(48);
  limiter.shouldRender(0);
  expect(limiter.shouldRender(21)).toBe(true);
});

test("holds the target rate over time by carrying the remainder", () => {
  const limiter = createFrameLimiter(48);
  let rendered = 0;
  // feed a 120 Hz clock (8.333 ms/tick) for one second
  for (let i = 1; i <= 120; i++) {
    if (limiter.shouldRender((i * 1000) / 120)) rendered++;
  }
  // carry-remainder keeps it on target (~48), not the ~40 a naive last=now gives
  expect(rendered).toBeGreaterThanOrEqual(46);
  expect(rendered).toBeLessThanOrEqual(50);
});

test("resyncs after a long pause instead of bursting catch-up renders", () => {
  const limiter = createFrameLimiter(48);
  limiter.shouldRender(0);
  expect(limiter.shouldRender(2000)).toBe(true); // one render on resume
  expect(limiter.shouldRender(2008)).toBe(false); // not a burst — back to pacing
});
