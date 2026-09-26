import { expect, test } from "vitest";
import { RipplePool } from "../src/themes/grove/ground.js";

const progress = (pool: RipplePool, slot: number) => pool.data[slot * 4 + 2];

test("ripple slots start idle", () => {
  const pool = new RipplePool(3, 2);
  for (let i = 0; i < 3; i++) expect(progress(pool, i)).toBeLessThan(0);
});

test("a spawned ripple advances and goes idle when its life ends", () => {
  const pool = new RipplePool(3, 2);
  pool.spawn(4, -5);
  expect(pool.data[0]).toBe(4);
  expect(pool.data[1]).toBe(-5);
  pool.advance(1);
  expect(progress(pool, 0)).toBeCloseTo(0.5);
  expect(progress(pool, 1)).toBeLessThan(0); // idle slots stay idle
  pool.advance(1);
  expect(progress(pool, 0)).toBeLessThan(0);
});

test("slots wrap, overwriting the oldest ripple", () => {
  const pool = new RipplePool(2, 10);
  pool.spawn(1, 1);
  pool.advance(1);
  pool.spawn(2, 2);
  pool.spawn(3, 3);
  expect(pool.data[0]).toBe(3);
  expect(progress(pool, 0)).toBe(0);
  expect(pool.data[4]).toBe(2);
});
