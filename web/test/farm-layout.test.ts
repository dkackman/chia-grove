import { expect, test } from "vitest";
import {
  FIELD,
  plantPosition,
  ROW_CAPACITY,
  rowDirection,
  rowZ,
  STRIP_WIDTH,
  lapOffset,
} from "../src/themes/farm/layout.js";

test("rows are evenly spaced and centered on z=0", () => {
  expect(rowZ(0)).toBeCloseTo(-rowZ(FIELD.rows - 1));
  expect(rowZ(0) - rowZ(1)).toBeCloseTo(FIELD.rowSpacing);
});

test("serpentine direction alternates", () => {
  expect(rowDirection(0)).toBe(1);
  expect(rowDirection(1)).toBe(-1);
  expect(rowDirection(2)).toBe(1);
});

test("plants advance along the row in opposite directions on alternate rows", () => {
  const coin = "deadbeef" + "00".repeat(28);
  const even = [plantPosition(0, 0, coin), plantPosition(0, 10, coin)];
  const odd = [plantPosition(1, 0, coin), plantPosition(1, 10, coin)];
  expect(even[1].x).toBeGreaterThan(even[0].x);
  expect(odd[1].x).toBeLessThan(odd[0].x);
});

test("positions are deterministic per coin id and stay in the field", () => {
  const coin = "cafebabe" + "00".repeat(28);
  expect(plantPosition(3, 7, coin)).toEqual(plantPosition(3, 7, coin));
  for (const index of [0, 50, ROW_CAPACITY - 1, ROW_CAPACITY + 5, 3 * ROW_CAPACITY - 1]) {
    const p = plantPosition(3, index, coin);
    expect(Math.abs(p.x)).toBeLessThanOrEqual(FIELD.rowLength / 2 + 0.2);
    // inside the row's soil bed, clear of the neighbouring rows
    expect(Math.abs(p.z - rowZ(3))).toBeLessThanOrEqual(STRIP_WIDTH / 2);
  }
});

test("overflow wraps back along the row", () => {
  const coin = "deadbeef" + "00".repeat(28);
  const wrapped = plantPosition(0, ROW_CAPACITY, coin);
  const first = plantPosition(0, 0, coin);
  expect(Math.abs(wrapped.x - first.x)).toBeLessThan(0.5);
});

test("each lap of an overflowing row is offset across the bed, so crops don't stack", () => {
  const coin = "deadbeef" + "00".repeat(28);
  const laps = [0, 1, 2, 3].map((lap) => plantPosition(0, lap * ROW_CAPACITY + 7, coin));
  for (let i = 0; i < laps.length; i++) {
    for (let j = i + 1; j < laps.length; j++) {
      const apart = Math.hypot(laps[i].x - laps[j].x, laps[i].z - laps[j].z);
      expect(apart).toBeGreaterThan(0.08);
    }
  }
  expect(lapOffset(0)).toEqual({ dx: 0, dz: 0 });
  expect(lapOffset(1).dz).toBeGreaterThan(0);
  expect(lapOffset(2).dz).toBeLessThan(0);
  for (let lap = 0; lap < 20; lap++) {
    expect(Math.abs(lapOffset(lap).dz)).toBeLessThan(STRIP_WIDTH / 2 - 0.15);
    expect(lapOffset(lap).dx).toBeLessThan(FIELD.plantSpacing);
  }
});
