import { expect, test } from "vitest";
import { WALL, hangSlot, frameSize } from "../src/themes/gallery/layout.js";

test("pieces advance rightward by a fixed step", () => {
  expect(hangSlot(1).x - hangSlot(0).x).toBeCloseTo(WALL.step);
  expect(hangSlot(5).x).toBeGreaterThan(hangSlot(4).x);
});

test("slots alternate between two salon bands and stay on the wall plane", () => {
  expect(hangSlot(0).y).toBeGreaterThan(hangSlot(1).y); // even = high band, odd = low band
  expect(hangSlot(0).z).toBe(WALL.z);
  for (let i = 0; i < 20; i++) {
    expect(hangSlot(i).y).toBeGreaterThan(0);
    expect(hangSlot(i).y).toBeLessThan(WALL.bandHigh + WALL.yJitter);
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
