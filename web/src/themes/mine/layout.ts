import { mulberry32, type XZ } from "../shared/util.js";

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const SPREAD = 3.0; // chunks overlap slightly into one contiguous landmass

/** Block index → chunk center on a phyllotaxis spiral. */
export function chunkPosition(index: number): XZ {
  const angle = index * GOLDEN_ANGLE;
  const radius = SPREAD * Math.sqrt(index);
  return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius };
}

/**
 * Radius from the origin to the outer edge of an island of `blockCount` chunks.
 * The outermost chunk sits at the spiral's far end (index blockCount-1); add its
 * footprint half-width so the result encloses the land. Used to frame the camera
 * to the *current* fill so a sparse island isn't stranded in the center of view.
 */
export function spiralRadius(blockCount: number): number {
  const outerCenter = blockCount > 1 ? SPREAD * Math.sqrt(blockCount - 1) : 0;
  return outerCenter + FLOOR_SIDE / 2; // +3.5: tiles reach ±3.5 from chunk center
}

export const MAX_ELEVATION = 1;

/**
 * Per-block terrace height (0..MAX_ELEVATION), hashed from the chunk's center so
 * adjacent blocks step against each other. The step — an exposed dirt side and
 * its shadow — is what delineates where one block ends and the next begins.
 * Deliberately *not* spatially smooth: a smooth field leaves most block
 * boundaries flat and indistinguishable.
 */
export function chunkElevation(pos: XZ): number {
  // quantize the center, then hash to a stable per-chunk height
  const xi = Math.round(pos.x * 16);
  const zi = Math.round(pos.z * 16);
  const seed = ((xi * 73856093) ^ (zi * 19349663)) >>> 0;
  return Math.floor(mulberry32(seed)() * (MAX_ELEVATION + 1));
}

export interface Cell {
  col: number;
  row: number;
}

const FLOOR_SIDE = 7; // odd → a true center cell at (0,0)
export const FLOOR_TILES = FLOOR_SIDE * FLOOR_SIDE; // 49
const SPACING = 1; // unit cubes
const CUBE = 1;

export function cellKey(c: Cell): string {
  return `${c.col},${c.row}`;
}

// Center-first ordering by Chebyshev ring (center, then growing square rings),
// tie-broken by angle. Deterministic and independent of total count.
const FLOOR_ORDER: Cell[] = (() => {
  const half = Math.floor(FLOOR_SIDE / 2); // 3
  const all: Cell[] = [];
  for (let col = -half; col <= half; col++)
    for (let row = -half; row <= half; row++) all.push({ col, row });
  all.sort((a, b) => {
    const ra = Math.max(Math.abs(a.col), Math.abs(a.row));
    const rb = Math.max(Math.abs(b.col), Math.abs(b.row));
    if (ra !== rb) return ra - rb;
    return Math.atan2(a.row, a.col) - Math.atan2(b.row, b.col);
  });
  return all;
})();

/** Floor tile (layer 0) for the n-th ground cube, center-first. */
export function floorCell(n: number): Cell {
  return FLOOR_ORDER[n % FLOOR_TILES];
}

export interface Seat {
  col: number;
  row: number;
  layer: number; // ≥ 1: specials sit above the floor
}

/** Special (CAT/NFT/DID) seating: fill the footprint at layer 1, then stack. */
export function seatCell(seatIndex: number): Seat {
  const cell = FLOOR_ORDER[seatIndex % FLOOR_TILES];
  const layer = 1 + Math.floor(seatIndex / FLOOR_TILES);
  return { col: cell.col, row: cell.row, layer };
}

/** Cell + layer → local offset (relative to the chunk center). */
export function cellLocal(cell: Cell, layer: number): { x: number; z: number; y: number } {
  return { x: cell.col * SPACING, z: cell.row * SPACING, y: layer * CUBE };
}
