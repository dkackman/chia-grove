import { mulberry32, type XZ } from "../shared/util.js";

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** How many block slots the spiral cycles through before reusing chunk centers. */
export const MAX_BLOCK_SLOTS = 200;

export const FLOOR_SIDE = 7; // odd → a true center cell at (0,0)
export const FLOOR_TILES = FLOOR_SIDE * FLOOR_SIDE; // 49
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

export const MAX_ELEVATION = 3;

/** Quantized chunk-center key, so a center round-trips to the same table entry. */
function centerKey(pos: XZ): number {
  const xi = Math.round(pos.x * 16);
  const zi = Math.round(pos.z * 16);
  return ((xi * 73856093) ^ (zi * 19349663)) >>> 0;
}

/**
 * Terrace level per block slot, precomputed so that *every* pair of blocks whose
 * land touches steps against the other. The step — an exposed dirt cliff and its
 * shadow — is the only thing delineating where one block ends and the next
 * begins, and a plain per-chunk hash leaves a share of boundaries flat
 * (1-in-2 with two levels, 1-in-4 with four): those blocks merge into one
 * indistinguishable slab.
 *
 * Two chunks touch when their 7×7 footprints overlap, i.e. when their centers
 * are closer than one full footprint width. Greedy graph coloring in spiral
 * order over that neighbor graph — ~200 nodes of degree ≤ 6, run once at module
 * load — resolves it exactly at four levels. If a slot ever did exhaust the
 * levels it falls back to 0 rather than throwing; the test pins that it doesn't.
 */
const ELEVATIONS: ReadonlyMap<number, number> = (() => {
  const centers = Array.from({ length: MAX_BLOCK_SLOTS }, (_, i) => chunkPosition(i));
  const levels = new Array<number>(centers.length).fill(0);
  for (let i = 0; i < centers.length; i++) {
    const taken = new Set<number>();
    for (let j = 0; j < i; j++) {
      const d = Math.hypot(centers[i].x - centers[j].x, centers[i].z - centers[j].z);
      if (d < FLOOR_SIDE) taken.add(levels[j]);
    }
    let level = 0;
    while (level <= MAX_ELEVATION && taken.has(level)) level++;
    levels[i] = level > MAX_ELEVATION ? 0 : level;
  }
  return new Map(centers.map((c, i) => [centerKey(c), levels[i]]));
})();

/**
 * Per-block terrace height (0..MAX_ELEVATION), looked up from the precomputed
 * coloring above. Positions off the spiral (none in practice) hash to a stable
 * level so the function stays total.
 */
export function chunkElevation(pos: XZ): number {
  const key = centerKey(pos);
  const assigned = ELEVATIONS.get(key);
  if (assigned !== undefined) return assigned;
  return Math.floor(mulberry32(key)() * (MAX_ELEVATION + 1));
}

export interface Cell {
  col: number;
  row: number;
}

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
