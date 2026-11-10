import * as THREE from "three";
import { expect, test } from "vitest";
import type { SproutEvent } from "@grove/shared";
import { TileLayer } from "../src/themes/mine/island.js";
import {
  Terrain,
  CELL_TILE_IDS,
  TILE_LEVEL,
  TREES_PER_CELL,
  FORM_SEA,
  FORM_BARE,
  FORM_GRASS,
  FORM_SAND,
  type TerrainView,
} from "../src/themes/mine/terrain.js";
import {
  cellTiles,
  slotLevel,
  ISLAND_SIDE,
  MAX_BLOCK_SLOTS,
  TILE_OWNER,
  SEA,
} from "../src/themes/mine/layout.js";

let coin = 0;
const spend = (height: number, kind: SproutEvent["kind"] = "xch"): SproutEvent => ({
  type: "sprout",
  kind,
  height,
  coinId: (coin++).toString(16).padStart(64, "0"),
  amount: "1",
});

/** A view that just mirrors what it is told, so tests can compare it with the state. */
function recorder() {
  const shown = new Map<number, number>();
  const trees = new Set<number>();
  const land = new Set<number>();
  const causes: string[] = [];
  const view: TerrainView = {
    show(tile, form, level, cause) {
      expect(level).toBe(TILE_LEVEL[tile]);
      causes.push(cause);
      if (form === FORM_SEA) shown.delete(tile);
      else shown.set(tile, form);
    },
    tree: (tile, standing) => void (standing ? trees.add(tile) : trees.delete(tile)),
    land: (tile) => void land.add(tile),
    resetLand: () => land.clear(),
  };
  return { view, shown, trees, land, causes };
}

const LAND_TILES = [...TILE_OWNER.keys()].filter((k) => TILE_OWNER[k] !== SEA);
const SIDES = [1, -1, ISLAND_SIDE, -ISLAND_SIDE];

/** The rules every tile must obey, whatever happened before. */
function checkInvariants(terrain: Terrain, rec: ReturnType<typeof recorder>): void {
  const raised = (tile: number) => terrain.formAt(tile) !== FORM_SEA;
  for (const tile of LAND_TILES) {
    const form = terrain.formAt(tile);
    // the view was told exactly what the state holds
    expect(rec.shown.get(tile) ?? FORM_SEA).toBe(form);
    expect(rec.land.has(tile)).toBe(raised(tile));
    if (!raised(tile)) {
      expect(terrain.metaAt(tile)).toBeNull();
      continue;
    }
    const beach = TILE_LEVEL[tile] === 0 && SIDES.some((d) => !raised(tile + d));
    if (beach) expect(form).toBe(FORM_SAND);
    else expect(form).toBe(terrain.metaAt(tile) ? FORM_GRASS : FORM_BARE);
    if (terrain.hasTree(tile)) expect(form).toBe(FORM_GRASS);
    expect(rec.trees.has(tile)).toBe(terrain.hasTree(tile));
  }
}

const forms = (terrain: Terrain, slot: number) =>
  [...CELL_TILE_IDS[slot]].map((tile) => terrain.formAt(tile));

/** A level ≥ 1 cell (no beach), so its forms depend only on its own spends. */
const HILL = Array.from({ length: MAX_BLOCK_SLOTS }, (_, i) => i).find((i) => slotLevel(i) > 0)!;

test("cell tile ids follow the layout's cells", () => {
  for (let slot = 0; slot < MAX_BLOCK_SLOTS; slot++) {
    expect(CELL_TILE_IDS[slot].length).toBe(cellTiles(slot).length);
    for (const tile of CELL_TILE_IDS[slot]) expect(TILE_OWNER[tile]).toBe(slot);
  }
});

test("a block raises its whole cell at once, as bare land", () => {
  const rec = recorder();
  const terrain = new Terrain(rec.view);
  terrain.startBlock(HILL, 100);
  expect(forms(terrain, HILL).every((f) => f === FORM_BARE)).toBe(true);
  expect(rec.shown.size).toBe(CELL_TILE_IDS[HILL].length);
  expect(rec.causes.every((c) => c === "raise")).toBe(true);
  // no spend was invented for it
  for (const tile of CELL_TILE_IDS[HILL]) expect(terrain.metaAt(tile)).toBeNull();
  checkInvariants(terrain, rec);
});

test("XCH spends green the cell center-first; a full cell takes no more", () => {
  const rec = recorder();
  const terrain = new Terrain(rec.view);
  terrain.startBlock(HILL, 100);
  const ids = CELL_TILE_IDS[HILL];
  const first = spend(100);
  expect(terrain.greenNext(first)).toBe(true);
  expect(terrain.formAt(ids[0])).toBe(FORM_GRASS);
  expect(terrain.metaAt(ids[0])).toBe(first);
  expect(terrain.formAt(ids[1])).toBe(FORM_BARE);
  for (let i = 1; i < 5; i++) terrain.greenNext(spend(100));
  expect(forms(terrain, HILL).map((f) => f === FORM_GRASS)).toEqual([...ids].map((_, i) => i < 5));
  for (let i = 5; i < ids.length; i++) expect(terrain.greenNext(spend(100))).toBe(true);
  expect(terrain.greenNext(spend(100))).toBe(false);
  expect(forms(terrain, HILL).every((f) => f === FORM_GRASS)).toBe(true);
  checkInvariants(terrain, rec);
});

test("a seated special greens its own tile, and spends skip past it", () => {
  const rec = recorder();
  const terrain = new Terrain(rec.view);
  terrain.startBlock(HILL, 100);
  const ids = CELL_TILE_IDS[HILL];
  const cat = spend(100, "cat");
  terrain.greenAt(cellTiles(HILL)[0], cat);
  terrain.greenAt(cellTiles(HILL)[0], spend(100, "cat")); // stacked on the same column
  expect(terrain.metaAt(ids[0])).toBe(cat);
  const xch = spend(100);
  terrain.greenNext(xch);
  expect(terrain.metaAt(ids[1])).toBe(xch);
  checkInvariants(terrain, rec);
});

test("a lowest-level tile beside the sea is beach, until land rises next to it", () => {
  const rec = recorder();
  const terrain = new Terrain(rec.view);
  const low = Array.from({ length: 120 }, (_, i) => i).filter((i) => slotLevel(i) === 0);
  terrain.startBlock(low[3], 100);
  const ids = [...CELL_TILE_IDS[low[3]]];
  const lone = forms(terrain, low[3]);
  expect(lone).toContain(FORM_SAND);
  expect(lone).toContain(FORM_BARE); // its interior is not coast
  // a spend that lands on beach is remembered, but the tile stays sand...
  for (const _ of ids) terrain.greenNext(spend(100));
  const beach = ids.filter((tile) => terrain.formAt(tile) === FORM_SAND);
  expect(beach.length).toBeGreaterThan(0);
  expect(terrain.metaAt(beach[0])).not.toBeNull();
  checkInvariants(terrain, rec);
  // ...until the island closes around the cell: then it is all grass
  for (let slot = 0; slot < MAX_BLOCK_SLOTS; slot++) terrain.startBlock(slot, 200 + slot);
  expect(forms(terrain, low[3]).every((f) => f === FORM_GRASS)).toBe(true);
  checkInvariants(terrain, rec);
  // a full island still has a beach: every low tile on the rim
  expect([...rec.shown.values()]).toContain(FORM_SAND);
});

test("terrain persists when the spiral laps back onto a slot", () => {
  const rec = recorder();
  const terrain = new Terrain(rec.view);
  terrain.startBlock(HILL, 100);
  for (let i = 0; i < 4; i++) terrain.greenNext(spend(100));
  const before = forms(terrain, HILL);
  rec.causes.length = 0;
  terrain.startBlock(HILL, 300); // next lap
  expect(forms(terrain, HILL)).toEqual(before);
  expect(rec.causes).toEqual([]); // nothing re-raised
  terrain.greenNext(spend(300)); // and the new lap's spends carry on from tile 4
  expect(forms(terrain, HILL).filter((f) => f === FORM_GRASS).length).toBe(5);
  checkInvariants(terrain, rec);
});

test("a reorg sinks the invalidated blocks' cells and nothing else", () => {
  const rec = recorder();
  const terrain = new Terrain(rec.view);
  for (let slot = 0; slot < 30; slot++) {
    terrain.startBlock(slot, 100 + slot);
    for (let i = 0; i < 6; i++) terrain.greenNext(spend(100 + slot));
  }
  const survivors = new Map(LAND_TILES.map((tile) => [tile, terrain.metaAt(tile)]));
  terrain.clearAbove(120); // slots 20..29 are gone
  for (let slot = 0; slot < 30; slot++) {
    const standing = forms(terrain, slot).every((f) => f !== FORM_SEA);
    const sunk = forms(terrain, slot).every((f) => f === FORM_SEA);
    expect(slot < 20 ? standing : sunk).toBe(true);
    // surviving cells keep exactly the spends they had
    if (slot < 20) {
      for (const tile of CELL_TILE_IDS[slot])
        expect(terrain.metaAt(tile)).toBe(survivors.get(tile));
    }
  }
  checkInvariants(terrain, rec);
  // the replacement chain raises the fork's cell again, bare
  terrain.startBlock(20, 120);
  expect(forms(terrain, 20).every((f) => f === FORM_BARE || f === FORM_SAND)).toBe(true);
  for (const tile of CELL_TILE_IDS[20]) expect(terrain.metaAt(tile)).toBeNull();
  checkInvariants(terrain, rec);
  terrain.clearAbove(0); // everything
  expect(rec.shown.size).toBe(0);
  expect(rec.land.size).toBe(0);
});

test("a reorg of a later lap un-greens its spends but leaves the older land standing", () => {
  const rec = recorder();
  const terrain = new Terrain(rec.view);
  terrain.startBlock(HILL, 100);
  for (let i = 0; i < 3; i++) terrain.greenNext(spend(100));
  terrain.startBlock(HILL, 300);
  for (let i = 0; i < 4; i++) terrain.greenNext(spend(300));
  terrain.clearAbove(300);
  const ids = CELL_TILE_IDS[HILL];
  expect(forms(terrain, HILL).map((f) => f === FORM_GRASS)).toEqual([...ids].map((_, i) => i < 3));
  expect(forms(terrain, HILL).filter((f) => f === FORM_BARE).length).toBe(ids.length - 3);
  // the replacement block greens from the first bare tile again
  terrain.startBlock(HILL, 300);
  terrain.greenNext(spend(300));
  expect(terrain.formAt(ids[3])).toBe(FORM_GRASS);
  checkInvariants(terrain, rec);
});

test("a fully green cell grows trees on its outermost tiles; a seated special fells one", () => {
  const rec = recorder();
  const terrain = new Terrain(rec.view);
  terrain.startBlock(HILL, 100);
  const ids = CELL_TILE_IDS[HILL];
  for (let i = 0; i < ids.length - 1; i++) terrain.greenNext(spend(100));
  expect(rec.trees.size).toBe(0); // one tile short: no trees yet
  terrain.greenNext(spend(100));
  expect(rec.trees.size).toBe(TREES_PER_CELL);
  // on the far end of the seating order, and not side by side
  const order = [...rec.trees].map((tile) => ids.indexOf(tile));
  expect(Math.min(...order)).toBeGreaterThan(ids.length / 2);
  const [a, b] = [...rec.trees];
  expect(SIDES.map((d) => a + d)).not.toContain(b);
  checkInvariants(terrain, rec);
  // a special seated on a tree's tile takes the tree down
  const treeTile = [...rec.trees][0];
  terrain.greenAt(cellTiles(HILL)[ids.indexOf(treeTile)], spend(100, "cat"));
  expect(terrain.hasTree(treeTile)).toBe(false);
  expect(rec.trees.size).toBe(TREES_PER_CELL - 1);
  checkInvariants(terrain, rec);
  // and a reorg takes the rest with the cell
  terrain.clearAbove(100);
  expect(rec.trees.size).toBe(0);
});

test("tiles a special greened never grow a tree", () => {
  const rec = recorder();
  const terrain = new Terrain(rec.view);
  terrain.startBlock(HILL, 100);
  for (const cell of cellTiles(HILL)) terrain.greenAt(cell, spend(100, "cat"));
  expect(forms(terrain, HILL).every((f) => f === FORM_GRASS)).toBe(true);
  expect(rec.trees.size).toBe(0);
});

test("a tile layer never loses a live tile when its instance ring wraps", () => {
  // 6 live tiles in an 8-slot ring, with one tile churned far past the cap: the
  // ring keeps coming around onto live tiles and must move them along
  const layer = new TileLayer(new THREE.Scene(), new THREE.MeshBasicMaterial(), 8);
  const tiles = [...CELL_TILE_IDS[0]].slice(0, 6);
  tiles.forEach((tile, i) => layer.put(tile, spend(i), i, 1 + i, 0));
  for (let n = 0; n < 50; n++) {
    layer.remove(tiles[n % 6]);
    layer.put(tiles[n % 6], spend(n % 6), n % 6, 1 + (n % 6), n);
    layer.kind.update(n, 1);
    const live = layer.kind.slots.flatMap((s, slot) => (s.meta ? [slot] : []));
    expect(live.map((slot) => layer.tileAt(slot)).sort()).toEqual([...tiles].sort());
    for (const slot of live) {
      const i = tiles.indexOf(layer.tileAt(slot));
      expect(layer.kind.slots[slot].y).toBe(i);
      expect(layer.kind.slots[slot].height).toBe(1 + i);
      expect(layer.kind.slots[slot].meta!.height).toBe(i);
    }
  }
  layer.remove(tiles[0]);
  expect(layer.kind.slots.filter((s) => s.meta).length).toBe(5);
  expect(Number.isNaN(layer.bornAt(tiles[0]))).toBe(true);
});
