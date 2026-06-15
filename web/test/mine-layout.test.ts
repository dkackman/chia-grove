import { expect, test } from "vitest";
import {
  chunkPosition,
  chunkElevation,
  MAX_ELEVATION,
  FLOOR_TILES,
  floorCell,
  seatCell,
  cellLocal,
  cellKey,
  platformCells,
} from "../src/themes/mine/layout.js";

test("chunk elevation is deterministic, integer, and within range", () => {
  const p = { x: 12.3, z: -7.1 };
  expect(chunkElevation(p)).toBe(chunkElevation(p));
  for (let i = 0; i < 250; i++) {
    const e = chunkElevation(chunkPosition(i));
    expect(Number.isInteger(e)).toBe(true);
    expect(e).toBeGreaterThanOrEqual(0);
    expect(e).toBeLessThanOrEqual(MAX_ELEVATION);
  }
});

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

test("platformCells covers a 3x3 patch centred on the seat so a special isn't a lone speck", () => {
  const cells = platformCells({ col: 2, row: -1 });
  expect(cells).toHaveLength(9);
  // centred: spans col 1..3, row -2..0, including the seat itself
  expect(cells).toContainEqual({ col: 2, row: -1 });
  expect(cells).toContainEqual({ col: 1, row: -2 });
  expect(cells).toContainEqual({ col: 3, row: 0 });
  const cols = cells.map((c) => c.col);
  expect(Math.min(...cols)).toBe(1);
  expect(Math.max(...cols)).toBe(3);
});
