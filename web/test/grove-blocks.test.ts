import { expect, test } from "vitest";
import { BlockSlots, REPLAY_SECONDS, isReplayed } from "../src/themes/grove/blocks.js";
import { lanternLevel, LANTERN_FLOOR, LANTERN_FRESH } from "../src/themes/grove/lantern.js";
import { NetspaceTrend, MOON_MAX, MOON_MIN, MOON_REST } from "../src/themes/grove/sky.js";
import { RipplePool } from "../src/themes/grove/ground.js";

test("isReplayed: old blocks are history, fresh ones are live", () => {
  const now = 1_700_000_000;
  expect(isReplayed(now - 10, now)).toBe(false);
  expect(isReplayed(now - REPLAY_SECONDS, now)).toBe(false);
  expect(isReplayed(now - REPLAY_SECONDS - 1, now)).toBe(true);
  expect(isReplayed(now - 3600, now)).toBe(true);
  // a missing / bogus timestamp is never treated as history
  expect(isReplayed(0, now)).toBe(false);
  expect(isReplayed(NaN, now)).toBe(false);
  // clock skew (block "from the future") is live
  expect(isReplayed(now + 30, now)).toBe(false);
});

test("BlockSlots places consecutively and wraps", () => {
  const slots = new BlockSlots(3);
  expect([slots.place(10), slots.place(11), slots.place(12), slots.place(13)]).toEqual([
    0, 1, 2, 0,
  ]);
  expect(slots.current()).toBe(0);
  expect(slots.currentHeight()).toBe(13);
});

test("BlockSlots.rewind drops height >= forkHeight and reuses the first removed slot", () => {
  const slots = new BlockSlots(10);
  for (let h = 100; h < 105; h++) slots.place(h, h * 10);
  expect(slots.rewind(103)).toBe(2);
  expect(slots.currentHeight()).toBe(102);
  expect(slots.current()).toBe(2);
  expect(slots.currentTimestamp()).toBe(1020);
  // replacement chain grows from the fork's slot
  expect(slots.place(103)).toBe(3);
});

test("BlockSlots.rewind(0) removes everything; a no-op fork removes nothing", () => {
  const slots = new BlockSlots(10);
  for (let h = 5; h < 8; h++) slots.place(h);
  expect(slots.rewind(50)).toBe(0);
  expect(slots.current()).toBe(2);
  expect(slots.rewind(0)).toBe(3);
  expect(slots.current()).toBe(-1);
  expect(slots.place(5)).toBe(0);
});

test("lantern fades with time since the newest block, to a floor", () => {
  expect(lanternLevel(0)).toBeCloseTo(LANTERN_FRESH);
  expect(lanternLevel(-5)).toBeCloseTo(LANTERN_FRESH);
  expect(lanternLevel(52)).toBeLessThan(lanternLevel(10));
  expect(lanternLevel(10_000)).toBeCloseTo(LANTERN_FLOOR);
});

test("NetspaceTrend: steady netspace rests; growth waxes and decline wanes, clamped", () => {
  const steady = new NetspaceTrend();
  for (let i = 0; i < 100; i++) steady.update(20_000, i * 60);
  expect(steady.brightness()).toBeCloseTo(MOON_REST);

  const growing = new NetspaceTrend();
  growing.update(20_000, 0);
  // +1% held for an hour: the fast EMA catches up, the slow baseline lags
  for (let i = 1; i <= 60; i++) growing.update(20_200, i * 60);
  expect(growing.brightness()).toBeGreaterThan(MOON_REST + 0.1);

  const shrinking = new NetspaceTrend();
  shrinking.update(20_000, 0);
  for (let i = 1; i <= 60; i++) shrinking.update(18_000, i * 60);
  expect(shrinking.brightness()).toBe(MOON_MIN);

  const zero = new NetspaceTrend();
  expect(zero.update(0, 0)).toBe(MOON_REST);
  expect(MOON_MAX).toBeGreaterThan(MOON_REST);
});

test("RipplePool stores a per-ripple tint", () => {
  const pool = new RipplePool(2, 1);
  pool.spawn(0, 0);
  pool.spawn(1, 1, 1);
  expect(pool.data[3]).toBe(0);
  expect(pool.data[7]).toBe(1);
});
