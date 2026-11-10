import type { SproutEvent } from "@grove/shared";
import {
  cellTiles,
  chunkPosition,
  slotLevel,
  tileIndex,
  ISLAND_SIDE,
  MAX_BLOCK_SLOTS,
  SEA,
  TILE_OWNER,
  type Cell,
} from "./layout.js";

/** What a tile shows. */
export const FORM_SEA = 0;
export const FORM_BARE = 1; // bare dirt: a block's land no spend has greened yet
export const FORM_GRASS = 2; // greened by an XCH spend, or by a special seated on it
export const FORM_SAND = 3; // beach: a lowest-level tile with sea beside it

/**
 * Why a tile changed form — the view picks its animation from this:
 * `raise` (its cell is rising out of the sea), `green` (a spend or a seated
 * special just greened it) or `settle` (the coast moved, or a reorg).
 */
export type Cause = "raise" | "green" | "settle";

/** Renders terrain changes; `Terrain` itself holds no scene objects. */
export interface TerrainView {
  /** The tile now shows `form` (FORM_SEA: nothing) at terrace `level`. */
  show(tile: number, form: number, level: number, cause: Cause): void;
  /** A tree now stands (or no longer stands) on the tile. */
  tree(tile: number, standing: boolean, level: number): void;
  /** A land column now stands on the tile (shore mask). */
  land(tile: number): void;
  /** Forget all land (reorg) — `land` follows for every surviving column. */
  resetLand(): void;
}

/** Every slot's tiles as tile indices, center-first (same order as `cellTiles`). */
export const CELL_TILE_IDS: ReadonlyArray<Int32Array> = Array.from(
  { length: MAX_BLOCK_SLOTS },
  (_, slot) => {
    const anchor = chunkPosition(slot);
    return Int32Array.from(cellTiles(slot), (c) => tileIndex(anchor.x + c.col, anchor.z + c.row));
  }
);

/** Per-tile terrace level (0 for sea), indexed by `tileIndex`. */
export const TILE_LEVEL: Uint8Array = Uint8Array.from(TILE_OWNER, (o) =>
  o === SEA ? 0 : slotLevel(o)
);

/** Trees that grow on a cell once every one of its tiles is green. */
export const TREES_PER_CELL = 2;

const TILE_COUNT = ISLAND_SIDE * ISLAND_SIDE;

/**
 * The island's terrain state: one contiguous landmass on the global tile grid.
 *
 * A block raises its whole Voronoi cell (`layout.ts`) at once as bare land;
 * each XCH spend then greens the cell's next bare tile, center-first, and a
 * special greens the tile it is seated on. A lowest-level tile with sea beside
 * it shows as beach instead, so a tile's form depends on its neighbors and is
 * re-derived (`refresh`) as cells rise and fall around it. A cell whose every
 * tile is green grows a couple of trees on its outermost spend-greened tiles —
 * the ones the seat allocator reaches last — and a special that does seat there
 * takes the tree down.
 *
 * Terrain is keyed by block slot and persists when the spiral laps back onto a
 * slot; only a reorg lowers a cell.
 */
export class Terrain {
  private readonly raised = new Uint8Array(TILE_COUNT);
  private readonly form = new Uint8Array(TILE_COUNT);
  private readonly trees = new Uint8Array(TILE_COUNT);
  /** the event that greened each tile (kept while the tile shows as beach) */
  private readonly green: Array<SproutEvent | null> = new Array<SproutEvent | null>(
    TILE_COUNT
  ).fill(null);
  /** height of the block that raised each slot's cell; -1 = still sea */
  private readonly raisedBy = new Float64Array(MAX_BLOCK_SLOTS).fill(-1);
  /** per slot: tiles before this (in cell order) are already green */
  private readonly cursor = new Uint16Array(MAX_BLOCK_SLOTS);
  private readonly greenCount = new Uint16Array(MAX_BLOCK_SLOTS);
  private slot = 0;
  private anchorX = 0;
  private anchorZ = 0;

  constructor(private readonly view: TerrainView) {}

  /**
   * Begin (or revisit) a block's cell. The first block on a slot raises the
   * whole cell as bare land; a later lap finds it standing and builds on it.
   */
  startBlock(index: number, height: number): void {
    const anchor = chunkPosition(index);
    this.slot = index;
    this.anchorX = anchor.x;
    this.anchorZ = anchor.z;
    if (this.raisedBy[index] >= 0) return;
    this.raisedBy[index] = height;
    const ids = CELL_TILE_IDS[index];
    for (const tile of ids) {
      this.raised[tile] = 1;
      this.view.land(tile);
    }
    for (const tile of ids) this.refresh(tile, "raise");
    // the coast moved: neighbors that were beach are inland now
    for (const tile of ids) {
      this.refresh(tile - 1, "settle");
      this.refresh(tile + 1, "settle");
      this.refresh(tile - ISLAND_SIDE, "settle");
      this.refresh(tile + ISLAND_SIDE, "settle");
    }
  }

  /** XCH spend → the current cell's next bare tile turns green. False once the cell is all green. */
  greenNext(event: SproutEvent): boolean {
    const ids = CELL_TILE_IDS[this.slot];
    let c = this.cursor[this.slot];
    while (c < ids.length && this.green[ids[c]]) c++;
    this.cursor[this.slot] = c;
    return c < ids.length && this.greenTile(ids[c], event);
  }

  /** A special is seated on this tile of the current cell: green it, and clear any tree. */
  greenAt(cell: Cell, event: SproutEvent): void {
    const tile = tileIndex(this.anchorX + cell.col, this.anchorZ + cell.row);
    this.fell(tile);
    this.greenTile(tile, event);
  }

  private greenTile(tile: number, event: SproutEvent): boolean {
    if (!this.raised[tile] || this.green[tile]) return false;
    this.green[tile] = event;
    this.refresh(tile, "green");
    const slot = TILE_OWNER[tile];
    if (++this.greenCount[slot] === CELL_TILE_IDS[slot].length) this.growTrees(slot);
    return true;
  }

  /** Outermost first: grass a spend laid (so no special stands there), not side by side. */
  private growTrees(slot: number): void {
    const ids = CELL_TILE_IDS[slot];
    let grown = 0;
    for (const tile of ids) grown += this.trees[tile];
    for (let i = ids.length - 1; i >= 0 && grown < TREES_PER_CELL; i--) {
      const tile = ids[i];
      if (this.form[tile] !== FORM_GRASS || this.green[tile]?.kind !== "xch") continue;
      const t = this.trees;
      if (t[tile - 1] || t[tile + 1] || t[tile - ISLAND_SIDE] || t[tile + ISLAND_SIDE]) continue;
      t[tile] = 1;
      grown++;
      this.view.tree(tile, true, TILE_LEVEL[tile]);
    }
  }

  private fell(tile: number): void {
    if (!this.trees[tile]) return;
    this.trees[tile] = 0;
    this.view.tree(tile, false, TILE_LEVEL[tile]);
  }

  private wanted(tile: number): number {
    if (!this.raised[tile]) return FORM_SEA;
    if (TILE_LEVEL[tile] === 0 && this.onCoast(tile)) return FORM_SAND;
    return this.green[tile] ? FORM_GRASS : FORM_BARE;
  }

  /** Sea on any of the four sides (the grid's margin keeps neighbors in range). */
  private onCoast(tile: number): boolean {
    const r = this.raised;
    return !(r[tile - 1] && r[tile + 1] && r[tile - ISLAND_SIDE] && r[tile + ISLAND_SIDE]);
  }

  /** Tell the view if the form the tile should show has changed. */
  private refresh(tile: number, cause: Cause): void {
    const want = this.wanted(tile);
    if (want === this.form[tile]) return;
    this.form[tile] = want;
    if (want !== FORM_GRASS) this.fell(tile);
    this.view.show(tile, want, TILE_LEVEL[tile], cause);
  }

  /**
   * Reorg: every cell raised by an invalidated block sinks back into the sea
   * (the replacement blocks raise it again), and grass an invalidated spend
   * laid on older land reverts to bare dirt.
   */
  clearAbove(forkHeight: number): void {
    for (let slot = 0; slot < MAX_BLOCK_SLOTS; slot++) {
      if (this.raisedBy[slot] < 0) continue;
      const sink = this.raisedBy[slot] >= forkHeight;
      if (sink) this.raisedBy[slot] = -1;
      this.cursor[slot] = 0;
      let greens = 0;
      for (const tile of CELL_TILE_IDS[slot]) {
        if (sink) this.raised[tile] = 0;
        const green = this.green[tile];
        if (green && (sink || green.height >= forkHeight)) {
          this.green[tile] = null;
          this.fell(tile);
        } else if (green) greens++;
      }
      this.greenCount[slot] = greens;
    }
    // re-derive every tile (the coast moved) and repaint the shallows
    this.view.resetLand();
    for (const ids of CELL_TILE_IDS) {
      for (const tile of ids) {
        this.refresh(tile, "settle");
        if (this.raised[tile]) this.view.land(tile);
      }
    }
  }

  /** What the tile currently shows (FORM_*). */
  formAt(tile: number): number {
    return this.form[tile];
  }
  /** The event that greened the tile, or null — bare land has no spend of its own. */
  metaAt(tile: number): SproutEvent | null {
    return this.green[tile] ?? null;
  }
  hasTree(tile: number): boolean {
    return this.trees[tile] === 1;
  }
}
