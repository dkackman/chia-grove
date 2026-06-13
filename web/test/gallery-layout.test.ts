import { expect, test } from "vitest";
import { WALL, hangSlot, frameSize } from "../src/themes/gallery/layout.js";

test("pieces stack into columns of WALL.rows, advancing right per column", () => {
  // first column (indices 0..rows-1) shares an x band, one new column to the right
  const col0 = Array.from({ length: WALL.rows }, (_, i) => hangSlot(i).x);
  expect(Math.max(...col0) - Math.min(...col0)).toBeLessThanOrEqual(WALL.xJitter + 1e-9);
  const gap = hangSlot(WALL.rows).x - hangSlot(0).x; // first piece of the next column
  expect(gap).toBeGreaterThan(WALL.colStep - WALL.xJitter);
  expect(gap).toBeLessThan(WALL.colStep + WALL.xJitter);
  expect(hangSlot(30).x).toBeGreaterThan(hangSlot(3).x); // columns advance monotonically
});

test("a column spans the rows vertically and stays on the wall plane", () => {
  const ys = Array.from({ length: WALL.rows }, (_, i) => hangSlot(i).y).sort((a, b) => a - b);
  expect(ys[ys.length - 1] - ys[0]).toBeGreaterThan(WALL.rowGap); // at least one row gap
  for (let i = 0; i < 30; i++) {
    expect(hangSlot(i).y).toBeGreaterThan(0);
    expect(hangSlot(i).z).toBe(WALL.z);
  }
});

test("hangSlot is deterministic per index", () => {
  expect(hangSlot(7)).toEqual(hangSlot(7));
});

test("frame sizing respects aspect and clamps the long edge", () => {
  const landscape = frameSize(3, 2); // wide
  expect(landscape.w / landscape.h).toBeCloseTo(2);
  expect(landscape.w).toBeLessThanOrEqual(WALL.maxW);
  const portrait = frameSize(3, 0.5); // tall
  expect(portrait.w / portrait.h).toBeCloseTo(0.5);
  expect(portrait.h).toBeLessThanOrEqual(WALL.maxW);
  expect(portrait.h).toBeGreaterThanOrEqual(WALL.minW);
  expect(frameSize(4, 1)).toEqual(frameSize(4, 1)); // deterministic
});
