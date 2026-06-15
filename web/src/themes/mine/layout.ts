import type { XZ } from "../shared/util.js";

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const SPREAD = 3.0; // chunks overlap slightly into one contiguous landmass

/** Block index → chunk center on a phyllotaxis spiral. */
export function chunkPosition(index: number): XZ {
  const angle = index * GOLDEN_ANGLE;
  const radius = SPREAD * Math.sqrt(index);
  return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius };
}

export const MAX_ELEVATION = 1;

/**
 * Seeded, spatially smooth terrace height (0..MAX_ELEVATION) for a chunk.
 * Driven by the chunk's world position so neighboring chunks land at similar
 * heights — the island reads as rolling terraces, not random spikes.
 */
export function chunkElevation(pos: XZ): number {
  const n =
    Math.sin(pos.x * 0.13) + Math.cos(pos.z * 0.11) + 0.6 * Math.sin((pos.x + pos.z) * 0.07);
  const unit = (n + 2.6) / 5.2; // → ~0..1
  return Math.max(0, Math.min(MAX_ELEVATION, Math.round(unit * MAX_ELEVATION)));
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
