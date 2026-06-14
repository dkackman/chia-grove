import { expect, test } from "vitest";
import { chunkPosition, FLOOR_TILES, floorCell, seatCell, cellLocal, cellKey } from "../src/themes/mine/layout.js";

test("chunks spiral outward monotonically", () => {
  const r = (i: number) => Math.hypot(chunkPosition(i).x, chunkPosition(i).z);
  expect(r(40)).toBeGreaterThan(r(4));
  expect(r(4)).toBeGreaterThan(r(0));
});

test("floor fills a fixed footprint, center first, no repeats within a layer", () => {
  const seen = new Set<string>();
  for (let i = 0; i < FLOOR_TILES; i++) {
    const c = floorCell(i);
    seen.add(cellKey(c));
  }
  expect(seen.size).toBe(FLOOR_TILES);
  // cell 0 is the center
  expect(floorCell(0)).toEqual({ col: 0, row: 0 });
});

test("seating stays on layer 0..0 until the footprint fills, then stacks", () => {
  expect(seatCell(0).layer).toBe(1);
  expect(seatCell(FLOOR_TILES - 1).layer).toBe(1);
  expect(seatCell(FLOOR_TILES).layer).toBe(2);
});

test("a seat index always maps to the same cell (stable as count grows)", () => {
  expect(seatCell(5)).toEqual(seatCell(5));
});

test("cellLocal spaces cubes by one unit and lifts by layer", () => {
  const a = cellLocal({ col: 0, row: 0 }, 1);
  const b = cellLocal({ col: 1, row: 0 }, 1);
  expect(Math.abs(b.x - a.x)).toBeCloseTo(1);
  expect(a.y).toBeCloseTo(1);
});
