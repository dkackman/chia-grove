import { expect, test } from "vitest";
import { FlingTracker } from "../src/themes/gallery/swipe.js";

// FlingTracker turns a stream of drag samples into a release "glide" offset
// (world units) for momentum panning. Timestamps are in milliseconds. The
// constants baked into the expected values below: SMOOTHING = 0.4,
// GLIDE_FACTOR = 0.18, STALE_MS = 80.

test("a fresh tracker has no momentum", () => {
  const f = new FlingTracker();
  f.reset(0);
  expect(f.release(0)).toBe(0);
});

test("a movement sample produces a glide in its direction", () => {
  const f = new FlingTracker();
  f.reset(0);
  f.sample(10, 20); // 10 world units over 20ms → 500 u/s, EMA → 200 u/s
  expect(f.release(20)).toBeCloseTo(36, 5); // 200 * 0.18
});

test("a leftward sample glides left", () => {
  const f = new FlingTracker();
  f.reset(0);
  f.sample(-10, 20);
  expect(f.release(20)).toBeCloseTo(-36, 5);
});

test("a sample with non-positive dt is ignored", () => {
  const f = new FlingTracker();
  f.reset(0);
  f.sample(10, 0); // dt = 0 → no velocity recorded
  expect(f.release(0)).toBe(0);
});

test("slowing the drag bleeds momentum down", () => {
  const f = new FlingTracker();
  f.reset(0);
  f.sample(10, 20); // EMA → 200 u/s
  f.sample(0, 40); // instant 0 → EMA 200*0.6 = 120 u/s
  expect(f.release(40)).toBeCloseTo(21.6, 5); // 120 * 0.18, and < 36
});

test("a stalled release (finger held still before lifting) carries no momentum", () => {
  const f = new FlingTracker();
  f.reset(0);
  f.sample(10, 20);
  expect(f.release(101)).toBe(0); // 101 - 20 = 81ms > STALE_MS
});

test("reset clears momentum", () => {
  const f = new FlingTracker();
  f.reset(0);
  f.sample(10, 20);
  f.reset(200);
  expect(f.release(200)).toBe(0);
});
