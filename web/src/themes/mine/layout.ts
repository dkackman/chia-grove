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

/** Seat height in layers per special kind: a cube fills one layer, a villager
 *  (head tops out at ~1.15) two, an easel painting (1.0 post + 1.3 frame) three. */
export const SEAT_HEIGHT = { cat: 1, did: 2, nft: 3 } as const;

/** Specials placed per block (airdrops stay bounded). */
export const SPECIAL_BUDGET = 600;

/**
 * Column-aware seating for one chunk's specials. Each floor cell keeps its
 * column top (next free layer); a special takes the lowest column, center-first,
 * and raises it by its own height — so a painting or villager never shares
 * space with a cube or another special stacked into the same column. With only
 * 1-layer cubes this reduces exactly to `seatCell` (fill the footprint at layer
 * 1, then stack).
 */
export class ChunkSeats {
  private readonly tops = new Array<number>(FLOOR_TILES).fill(1);
  private placed = 0;
  /** coin ids seated in this chunk — cleared when the spiral laps back here */
  readonly coinIds = new Set<string>();

  next(height: number, coinId?: string): Seat | null {
    if (this.placed >= SPECIAL_BUDGET) return null;
    let best = 0;
    for (let i = 1; i < FLOOR_TILES; i++) if (this.tops[i] < this.tops[best]) best = i;
    const cell = FLOOR_ORDER[best];
    const layer = this.tops[best];
    this.tops[best] += Math.max(1, height);
    this.placed++;
    if (coinId) this.coinIds.add(coinId);
    return { col: cell.col, row: cell.row, layer };
  }
}

/**
 * Per-chunk seating keyed by block-slot index. The spiral wraps after
 * MAX_BLOCK_SLOTS blocks; when it laps back onto a slot, `startChunk` returns
 * the coin ids the previous visit seated there so the caller can clear those
 * still-alive specials (otherwise the new lap's seats z-fight with them), and
 * the slot's seating restarts from an empty footprint.
 */
export class SpecialSeats {
  private readonly chunks = new Map<number, ChunkSeats>();
  private current = new ChunkSeats();

  startChunk(index: number): ReadonlySet<string> {
    const stale = this.chunks.get(index)?.coinIds ?? new Set<string>();
    this.current = new ChunkSeats();
    this.chunks.set(index, this.current);
    return stale;
  }

  next(height: number, coinId?: string): Seat | null {
    return this.current.next(height, coinId);
  }
}

/** Gap between the island's outer edge and the ring of mempool torches. */
export const TORCH_MARGIN = 2;

/** Rim-torch ring radius: just outside the island's current extent. */
export function torchRadius(filledBlocks: number): number {
  return spiralRadius(Math.max(1, filledBlocks)) + TORCH_MARGIN;
}

/**
 * Maps block heights onto spiral slots so a reorg can rewind the build cursor.
 * `advance` hands out the next slot (wrapping at MAX_BLOCK_SLOTS); `rewind`
 * drops every recorded block with `height >= forkHeight` (0 = everything) and
 * moves the cursor back to the first one's slot, so the replacement chain is
 * rebuilt on the fork's chunk instead of leaving bare orphaned chunks behind.
 */
export class BlockCursor {
  private readonly blocks: Array<{ height: number; index: number }> = [];
  private nextIndex = 0;
  private total = 0; // blocks placed and not rewound

  /** The slot the next block will take. */
  get index(): number {
    return this.nextIndex;
  }
  /** How far the spiral has populated (≤ MAX_BLOCK_SLOTS) — drives framing. */
  get filled(): number {
    return Math.min(this.total, MAX_BLOCK_SLOTS);
  }

  advance(height: number): number {
    const index = this.nextIndex;
    this.nextIndex = (index + 1) % MAX_BLOCK_SLOTS;
    this.total++;
    this.blocks.push({ height, index });
    // only the latest lap's slots are meaningful to rewind onto
    if (this.blocks.length > MAX_BLOCK_SLOTS) this.blocks.shift();
    return index;
  }

  /** Rewinds to the fork's slot and returns it, or null if nothing recorded is invalidated. */
  rewind(forkHeight: number): number | null {
    const first = this.blocks.findIndex((b) => b.height >= forkHeight);
    if (first < 0) return null;
    const removed = this.blocks.length - first;
    const forkIndex = this.blocks[first].index;
    this.blocks.length = first;
    this.nextIndex = forkIndex;
    // on the first lap the removed chunks are now bare; once lapped, older
    // terrain still covers every slot, so the fill (camera framing) stays full
    this.total -= removed;
    return forkIndex;
  }
}
