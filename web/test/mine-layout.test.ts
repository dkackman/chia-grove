import { expect, test } from "vitest";
import {
  chunkPosition,
  chunkElevation,
  MAX_ELEVATION,
  cellLocal,
  cellKey,
  cellTiles,
  slotLevel,
  spiralPoint,
  spiralRadius,
  tileIndex,
  tileOwner,
  ISLAND_HALF,
  MAX_BLOCK_SLOTS,
  SEA,
  TILE_OWNER,
} from "../src/themes/mine/layout.js";

test("spiralRadius grows with block count and reaches the outer chunk edge", () => {
  // a single centered chunk reaches 3.5 tiles out
  expect(spiralRadius(1)).toBeCloseTo(3.5, 5);
  // monotonic: more blocks → larger island
  expect(spiralRadius(200)).toBeGreaterThan(spiralRadius(120));
  expect(spiralRadius(120)).toBeGreaterThan(spiralRadius(40));
  // the outermost chunk center (index 119) plus its cell's reach
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

test("cellLocal spaces cubes by one unit and lifts by layer", () => {
  const a = cellLocal({ col: 0, row: 0 }, 1);
  const b = cellLocal({ col: 1, row: 0 }, 1);
  expect(Math.abs(b.x - a.x)).toBeCloseTo(1);
  expect(a.y).toBeCloseTo(1);
});

const SLOTS = Array.from({ length: MAX_BLOCK_SLOTS }, (_, i) => i);
const SIDES = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/** World tiles of a slot's cell, in cell order. */
function worldTiles(slot: number): Array<{ x: number; z: number }> {
  const a = chunkPosition(slot);
  return cellTiles(slot).map((c) => ({ x: a.x + c.col, z: a.z + c.row }));
}

/** Is the set of tiles one 4-connected region? */
function connected(tiles: Array<{ x: number; z: number }>): boolean {
  const left = new Set(tiles.map((t) => tileIndex(t.x, t.z)));
  const queue = [tiles[0]];
  left.delete(tileIndex(tiles[0].x, tiles[0].z));
  while (queue.length > 0) {
    const t = queue.pop()!;
    for (const [dx, dz] of SIDES) {
      const n = { x: t.x + dx, z: t.z + dz };
      if (left.delete(tileIndex(n.x, n.z))) queue.push(n);
    }
  }
  return left.size === 0;
}

test("chunk centers are distinct integer grid points, each the first tile of its own cell", () => {
  const seen = new Set<string>();
  for (const i of SLOTS) {
    const p = chunkPosition(i);
    expect(Number.isInteger(p.x) && Number.isInteger(p.z)).toBe(true);
    const s = spiralPoint(i);
    expect(Math.abs(p.x - s.x)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(p.z - s.z)).toBeLessThanOrEqual(0.5);
    seen.add(`${p.x},${p.z}`);
    expect(tileOwner(p.x, p.z)).toBe(i);
    expect(cellTiles(i)[0]).toEqual({ col: 0, row: 0 });
  }
  expect(seen.size).toBe(MAX_BLOCK_SLOTS);
});

test("every land tile has exactly one owner: the cells partition the island", () => {
  const claimed = new Set<number>();
  for (const i of SLOTS) {
    for (const t of worldTiles(i)) {
      const k = tileIndex(t.x, t.z);
      expect(claimed.has(k)).toBe(false); // no tile in two cells
      claimed.add(k);
      expect(tileOwner(t.x, t.z)).toBe(i);
    }
  }
  // ...and no owned tile is missing from its cell
  expect(claimed.size).toBe(TILE_OWNER.filter((o) => o !== SEA).length);
  expect(tileOwner(ISLAND_HALF + 5, 0)).toBe(SEA); // off the grid is sea, not a throw
});

test("each tile belongs to the nearest spiral point", () => {
  const sites = SLOTS.map(spiralPoint);
  for (let z = -ISLAND_HALF; z <= ISLAND_HALF; z++) {
    for (let x = -ISLAND_HALF; x <= ISLAND_HALF; x++) {
      const owner = tileOwner(x, z);
      if (owner === SEA) continue;
      const mine = Math.hypot(sites[owner].x - x, sites[owner].z - z);
      const nearest = Math.min(...sites.map((s) => Math.hypot(s.x - x, s.z - z)));
      if (mine > nearest + 1e-9) expect(`${x},${z} → ${owner}`).toBe("nearest");
    }
  }
});

test("the island is one solid landmass: no lakes inside, no land past its rim", () => {
  // flood the sea in from a corner of the grid: every sea tile must be reached
  const side = ISLAND_HALF * 2 + 1;
  const wet = new Uint8Array(side * side);
  const queue = [tileIndex(-ISLAND_HALF, -ISLAND_HALF)];
  wet[queue[0]] = 1;
  while (queue.length > 0) {
    const k = queue.pop()!;
    const x = (k % side) - ISLAND_HALF;
    const z = Math.floor(k / side) - ISLAND_HALF;
    for (const [dx, dz] of SIDES) {
      if (Math.abs(x + dx) > ISLAND_HALF || Math.abs(z + dz) > ISLAND_HALF) continue;
      const n = tileIndex(x + dx, z + dz);
      if (wet[n] || TILE_OWNER[n] !== SEA) continue;
      wet[n] = 1;
      queue.push(n);
    }
  }
  const lakes = [...TILE_OWNER.keys()].filter((k) => TILE_OWNER[k] === SEA && !wet[k]);
  expect(lakes).toEqual([]);
  for (let z = -ISLAND_HALF; z <= ISLAND_HALF; z++) {
    for (let x = -ISLAND_HALF; x <= ISLAND_HALF; x++) {
      const r = Math.hypot(x, z);
      if (r <= 38) expect(tileOwner(x, z)).not.toBe(SEA);
      if (r > spiralRadius(MAX_BLOCK_SLOTS)) expect(tileOwner(x, z)).toBe(SEA);
    }
  }
  // the grid keeps a sea margin, so a land tile's neighbors are always on it
  for (let k = -ISLAND_HALF; k <= ISLAND_HALF; k++) {
    for (const [x, z] of [
      [k, ISLAND_HALF],
      [k, -ISLAND_HALF],
      [ISLAND_HALF, k],
      [-ISLAND_HALF, k],
    ]) {
      expect(tileOwner(x, z)).toBe(SEA);
    }
  }
});

test("cells are compact, ~28 tiles, ordered center-first", () => {
  const sizes = SLOTS.map((i) => cellTiles(i).length);
  const mean = sizes.reduce((a, b) => a + b, 0) / sizes.length;
  expect(mean).toBeGreaterThan(26);
  expect(mean).toBeLessThan(32);
  expect(Math.min(...sizes)).toBeGreaterThanOrEqual(16);
  expect(Math.max(...sizes)).toBeLessThanOrEqual(48);
  for (const i of SLOTS) {
    const d = cellTiles(i).map((c) => c.col * c.col + c.row * c.row);
    for (let k = 1; k < d.length; k++) expect(d[k]).toBeGreaterThanOrEqual(d[k - 1]);
    expect(Math.max(...d)).toBeLessThanOrEqual(5 * 5); // nothing strays far from its center
    expect(new Set(cellTiles(i).map(cellKey)).size).toBe(d.length);
  }
});

test("each cell is one connected patch", () => {
  for (const i of SLOTS) expect(connected(worldTiles(i))).toBe(true);
});

test("the first N cells always form a single connected island, for every N", () => {
  // each cell is connected, so by induction the union stays connected as long
  // as every new cell shares an edge with a cell that came before it
  for (const i of SLOTS.slice(1)) {
    const touchesEarlier = worldTiles(i).some((t) =>
      SIDES.some(([dx, dz]) => {
        const o = tileOwner(t.x + dx, t.z + dz);
        return o !== SEA && o < i;
      })
    );
    expect(touchesEarlier).toBe(true);
  }
  // spot-check the induction with a real flood fill
  for (const n of [2, 3, 10, 57, MAX_BLOCK_SLOTS]) {
    expect(connected(SLOTS.slice(0, n).flatMap(worldTiles))).toBe(true);
  }
});

test("touching cells never share a terrace level", () => {
  // Wherever two cells share a tile edge they must step against each other, or
  // the boundary between those blocks renders flat and the blocks merge.
  const flat = new Set<string>();
  const pairs = new Set<string>();
  const steps = [0, 0, 0, 0];
  for (let z = -ISLAND_HALF; z < ISLAND_HALF; z++) {
    for (let x = -ISLAND_HALF; x < ISLAND_HALF; x++) {
      const a = tileOwner(x, z);
      if (a === SEA) continue;
      for (const b of [tileOwner(x + 1, z), tileOwner(x, z + 1)]) {
        if (b === SEA || b === a) continue;
        const pair = `${Math.min(a, b)}-${Math.max(a, b)}`;
        pairs.add(pair);
        const step = Math.abs(slotLevel(a) - slotLevel(b));
        steps[step]++;
        if (step === 0) flat.add(pair);
      }
    }
  }
  // guard against a vacuous pass: the cells really do pack together
  expect(pairs.size).toBeGreaterThan(MAX_BLOCK_SLOTS * 2);
  expect([...flat]).toEqual([]);
  // every level is used, and the terraces are mostly gentle one-block steps
  expect(new Set(SLOTS.map(slotLevel)).size).toBe(MAX_ELEVATION + 1);
  expect(steps[1]).toBeGreaterThan(steps[2] + steps[3]);
  // a chunk center reports its own cell's level
  for (const i of SLOTS) expect(chunkElevation(chunkPosition(i))).toBe(slotLevel(i));
});
