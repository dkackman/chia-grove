import type { XZ } from "../shared/util.js";

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** How many block slots the spiral cycles through before reusing chunk centers. */
export const MAX_BLOCK_SLOTS = 200;

const SPREAD = 3.0; // one slot per 9π ≈ 28 tiles of disc area
/** How far a slot's land reaches past its center at the island's edge. */
const EDGE_REACH = 3.5;
/** A tile farther than this from its nearest center is open sea (bounds rim cells). */
const CELL_REACH = 4;

/** Block index → continuous point on the phyllotaxis spiral (the Voronoi site). */
export function spiralPoint(index: number): XZ {
  const angle = index * GOLDEN_ANGLE;
  const radius = SPREAD * Math.sqrt(index);
  return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius };
}

/**
 * Block index → chunk center, snapped to the global integer voxel grid. Every
 * tile, cube, villager and painting of the block is an integer (col, row)
 * offset from this point, so the whole island shares one grid.
 */
export function chunkPosition(index: number): XZ {
  const p = spiralPoint(index);
  return { x: Math.round(p.x) + 0, z: Math.round(p.z) + 0 }; // + 0: no negative zero
}

/**
 * Radius from the origin to the outer edge of an island of `blockCount` chunks.
 * The outermost chunk sits at the spiral's far end (index blockCount-1); add its
 * cell's reach so the result encloses the land. Used to frame the camera to the
 * *current* fill so a sparse island isn't stranded in the center of view.
 */
export function spiralRadius(blockCount: number): number {
  const outerCenter = blockCount > 1 ? SPREAD * Math.sqrt(blockCount - 1) : 0;
  return outerCenter + EDGE_REACH;
}

export const MAX_ELEVATION = 3;

export interface Cell {
  col: number;
  row: number;
}

export function cellKey(c: Cell): string {
  return `${c.col},${c.row}`;
}

/** The tile grid spans [-ISLAND_HALF, ISLAND_HALF] on x and z (with a sea margin
 *  so a land tile's neighbors are always on the grid). */
export const ISLAND_HALF = Math.ceil(spiralRadius(MAX_BLOCK_SLOTS)) + 2;
export const ISLAND_SIDE = ISLAND_HALF * 2 + 1;
/** Owner of an open-sea tile. */
export const SEA = -1;

/** Integer tile (x, z) → index into the island's tile arrays. */
export function tileIndex(x: number, z: number): number {
  return (z + ISLAND_HALF) * ISLAND_SIDE + (x + ISLAND_HALF);
}

/**
 * The island's land, computed once: one global integer grid, partitioned into
 * a Voronoi cell per block slot.
 *
 * - `owner[tileIndex]` is the slot whose spiral point is nearest that tile
 *   (ties → the lower slot), or SEA beyond the island's rim. Cells therefore
 *   tile the disc with no gaps and no overlaps, ~28 tiles each.
 * - `cells[slot]` lists the slot's tiles as (col, row) offsets from its
 *   `chunkPosition`, center-first (distance, then angle) — the order XCH spends
 *   green them and specials seat on them.
 * - `levels[slot]` is the cell's terrace level (see `terraceLevels`): every pair
 *   of cells whose tiles share an edge steps against the other. The step — an
 *   exposed cliff and its shadow — is what delineates one block from the next.
 */
function buildIsland(): {
  owner: Int16Array;
  cells: ReadonlyArray<ReadonlyArray<Cell>>;
  levels: Uint8Array;
} {
  const sites = Array.from({ length: MAX_BLOCK_SLOTS }, (_, i) => spiralPoint(i));
  const anchors = sites.map((_, i) => chunkPosition(i));
  const rim2 = spiralRadius(MAX_BLOCK_SLOTS) ** 2;
  const reach2 = CELL_REACH ** 2;
  const owner = new Int16Array(ISLAND_SIDE * ISLAND_SIDE).fill(SEA);
  const cells: Cell[][] = sites.map(() => []);
  for (let z = -ISLAND_HALF; z <= ISLAND_HALF; z++) {
    for (let x = -ISLAND_HALF; x <= ISLAND_HALF; x++) {
      if (x * x + z * z > rim2) continue;
      let best = SEA;
      let bestD = reach2;
      for (let i = 0; i < sites.length; i++) {
        const dx = sites[i].x - x;
        const dz = sites[i].z - z;
        const d = dx * dx + dz * dz;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      if (best === SEA) continue;
      owner[tileIndex(x, z)] = best;
      cells[best].push({ col: x - anchors[best].x, row: z - anchors[best].z });
    }
  }
  for (const cell of cells) {
    cell.sort(
      (a, b) =>
        a.col * a.col + a.row * a.row - (b.col * b.col + b.row * b.row) ||
        Math.atan2(a.row, a.col) - Math.atan2(b.row, b.col)
    );
  }

  // cell adjacency: two cells touch when any of their tiles share an edge
  const touching: Array<Set<number>> = sites.map(() => new Set<number>());
  for (let i = 0; i < MAX_BLOCK_SLOTS; i++) {
    for (const c of cells[i]) {
      const x = anchors[i].x + c.col;
      const z = anchors[i].z + c.row;
      for (const o of [owner[tileIndex(x + 1, z)], owner[tileIndex(x, z + 1)]]) {
        if (o === SEA || o === i) continue;
        touching[i].add(o);
        touching[o].add(i);
      }
    }
  }
  return { owner, cells, levels: terraceLevels(touching) };
}

/**
 * Terrace level per cell such that touching cells never share one, preferring
 * gentle steps. Coordinate descent, sweeping in spiral order: each cell takes
 * the level with the fewest same-level neighbors, then the smallest summed
 * squared step to its neighbors, then the lowest. That objective only ever
 * decreases, so the sweeps settle — on a result with no flat boundary (the
 * tests pin that) and mostly one-block steps rather than sheer three-block walls.
 */
function terraceLevels(touching: ReadonlyArray<ReadonlySet<number>>): Uint8Array {
  const levels = new Uint8Array(touching.length);
  const UNSET = 255;
  levels.fill(UNSET);
  for (let sweep = 0; sweep < 64; sweep++) {
    let changed = false;
    for (let i = 0; i < levels.length; i++) {
      let best = 0;
      let bestScore = Infinity;
      for (let level = 0; level <= MAX_ELEVATION; level++) {
        let score = 0;
        for (const n of touching[i]) {
          if (levels[n] === UNSET) continue;
          const step = level - levels[n];
          score += step === 0 ? 1e6 : step * step;
        }
        if (score < bestScore) {
          bestScore = score;
          best = level;
        }
      }
      if (levels[i] !== best) {
        levels[i] = best;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return levels;
}

const ISLAND = buildIsland();

/** Per-tile owner slot (SEA for water), indexed by `tileIndex`. Read-only. */
export const TILE_OWNER: Int16Array = ISLAND.owner;

/** Slot owning the integer tile (x, z), or SEA (also for anything off the grid). */
export function tileOwner(x: number, z: number): number {
  if (Math.abs(x) > ISLAND_HALF || Math.abs(z) > ISLAND_HALF) return SEA;
  return ISLAND.owner[tileIndex(x, z)];
}

/** A slot's tiles as offsets from its `chunkPosition`, center-first. */
export function cellTiles(index: number): ReadonlyArray<Cell> {
  return ISLAND.cells[index];
}

/** Terrace level (0..MAX_ELEVATION) of a block slot's cell. */
export function slotLevel(index: number): number {
  return ISLAND.levels[index];
}

/**
 * Terrace level of the land at a world position — for a chunk center, its own
 * cell's level. Open sea is level 0, so the function stays total.
 */
export function chunkElevation(pos: XZ): number {
  const o = tileOwner(Math.round(pos.x), Math.round(pos.z));
  return o === SEA ? 0 : ISLAND.levels[o];
}

export interface Seat {
  col: number;
  row: number;
  layer: number; // ≥ 1: specials sit above the floor
}

/** Cell + layer → local offset (relative to the chunk center). Unit cubes. */
export function cellLocal(cell: Cell, layer: number): { x: number; z: number; y: number } {
  return { x: cell.col, z: cell.row, y: layer };
}

/** Seat height in layers per special kind: a cube fills one layer, a villager
 *  (head tops out at ~1.15) two, an easel painting (1.0 post + 1.3 frame) three. */
export const SEAT_HEIGHT = { cat: 1, did: 2, nft: 3 } as const;

/** Specials placed per block (airdrops stay bounded). */
export const SPECIAL_BUDGET = 340; // ~12 layers over a ~28-tile cell

/**
 * Column-aware seating for one chunk's specials, over that chunk's own cell
 * tiles. Each tile keeps its column top (next free layer); a special takes the
 * lowest column, center-first, and raises it by its own height — so a painting
 * or villager never shares space with a cube or another special stacked into
 * the same column. With only 1-layer cubes this fills the cell at layer 1 in
 * tile order, then stacks.
 */
export class ChunkSeats {
  private readonly tops: number[];
  private placed = 0;
  /** coin ids seated in this chunk — cleared when the spiral laps back here */
  readonly coinIds = new Set<string>();

  constructor(private readonly tiles: ReadonlyArray<Cell>) {
    this.tops = new Array<number>(tiles.length).fill(1);
  }

  next(height: number, coinId?: string): Seat | null {
    if (this.placed >= SPECIAL_BUDGET || this.tiles.length === 0) return null;
    let best = 0;
    for (let i = 1; i < this.tops.length; i++) if (this.tops[i] < this.tops[best]) best = i;
    const cell = this.tiles[best];
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
 * the slot's seating restarts from an empty cell.
 */
export class SpecialSeats {
  private readonly chunks = new Map<number, ChunkSeats>();
  private current = new ChunkSeats(cellTiles(0));

  startChunk(index: number): ReadonlySet<string> {
    const stale = this.chunks.get(index)?.coinIds ?? new Set<string>();
    this.current = new ChunkSeats(cellTiles(index));
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
