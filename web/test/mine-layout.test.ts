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
  spiralRadius,
  FLOOR_SIDE,
  MAX_BLOCK_SLOTS,
} from "../src/themes/mine/layout.js";

test("spiralRadius grows with block count and reaches the outer chunk edge", () => {
  // a single centered chunk reaches half its 7-wide footprint
  expect(spiralRadius(1)).toBeCloseTo(3.5, 5);
  // monotonic: more blocks → larger island
  expect(spiralRadius(200)).toBeGreaterThan(spiralRadius(120));
  expect(spiralRadius(120)).toBeGreaterThan(spiralRadius(40));
  // the outermost chunk center (index 119) plus its footprint half-width
  expect(spiralRadius(120)).toBeCloseTo(3.0 * Math.sqrt(119) + 3.5, 4);
});

test("spiralRadius is finite and non-negative at the empty edge case", () => {
  expect(spiralRadius(0)).toBeCloseTo(3.5, 5);
});

test("chunk elevation is deterministic, integer, within range, and varied", () => {
  const p = { x: 12.3, z: -7.1 };
  expect(chunkElevation(p)).toBe(chunkElevation(p));
  const seen = new Set<number>();
  for (let i = 0; i < 250; i++) {
    const e = chunkElevation(chunkPosition(i));
    expect(Number.isInteger(e)).toBe(true);
    expect(e).toBeGreaterThanOrEqual(0);
    expect(e).toBeLessThanOrEqual(MAX_ELEVATION);
    seen.add(e);
  }
  // blocks step against each other — the island is not one flat level
  expect(seen.size).toBeGreaterThan(1);
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

test("neighboring chunks never share a terrace elevation", () => {
  // Two chunks' land touches when their footprints overlap — i.e. when their
  // centers are closer than one full footprint width. Every such pair must step
  // against the other, or the boundary between those blocks renders flat.
  const pts = Array.from({ length: MAX_BLOCK_SLOTS }, (_, i) => chunkPosition(i));
  const flatPairs: Array<[number, number]> = [];
  let touching = 0;
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const d = Math.hypot(pts[i].x - pts[j].x, pts[i].z - pts[j].z);
      if (d >= FLOOR_SIDE) continue;
      touching++;
      if (chunkElevation(pts[i]) === chunkElevation(pts[j])) flatPairs.push([i, j]);
    }
  }
  // guard against a vacuous pass: the spiral really does pack chunks together
  expect(touching).toBeGreaterThan(MAX_BLOCK_SLOTS);
  expect(flatPairs).toEqual([]);
});
