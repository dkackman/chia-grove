import * as THREE from "three";
import type { SproutEvent } from "@grove/shared";
import { InstancedKind, type Pose } from "../shared/instanced.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { ISLAND_HALF, ISLAND_SIDE, type Cell } from "./layout.js";
import {
  Terrain,
  CELL_TILE_IDS,
  FORM_BARE,
  FORM_GRASS,
  FORM_SAND,
  TREES_PER_CELL,
  type Cause,
  type TerrainView,
} from "./terrain.js";
import type { Water } from "./water.js";
import {
  grassTopTexture,
  dirtTexture,
  grassSideTexture,
  sandTexture,
  stoneTexture,
  logTexture,
  leavesTexture,
} from "./textures.js";

const TILE_COUNT = ISLAND_SIDE * ISLAND_SIDE;
const LAND_TILES = CELL_TILE_IDS.reduce((n, ids) => n + ids.length, 0);

// Each layer holds at most one instance per land tile, so a cap past the land's
// tile count means terrain never has to recycle. The headroom is what the ring
// allocator burns through as tiles change form (see TileLayer.put) before it
// has to shuffle live tiles along; InstancedKind only draws what is planted.
const HEADROOM = 2048;

/** InstancedKind's grow-in time: a column younger than this is still rising. */
const RISE_SECONDS = 1.6;
/** bornAt for an instance that should appear at full size, with no grow-in. */
const SETTLED = -1e6;
/** A tile greened on settled land starts this far into its grow-in: already full
 *  width (no hole in the terrain), with the last fifth of its height to pop. */
const GREEN_POP = 0.64;

/** Placeholder metadata for bare land — never returned from `metaFor`. */
const LAND: SproutEvent = { type: "sprout", kind: "xch", height: -1, coinId: "", amount: "0" };

/** Unit cube whose base sits at y=0 so it grows upward from its seat. */
export function groundGeometry(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(1, 1, 1);
  g.translate(0, 0.5, 0);
  return g;
}

/**
 * A small blocky oak, base at y=0 and kept inside its own tile's footprint so it
 * never reaches into a neighbor's stack: a one-block trunk under a stepped
 * canopy. Groups: 0 = trunk, 1 and 2 = leaves.
 */
export function treeGeometry(): THREE.BufferGeometry {
  const trunk = new THREE.BoxGeometry(0.34, 1, 0.34);
  trunk.translate(0, 0.5, 0);
  const canopy = new THREE.BoxGeometry(1, 0.8, 1);
  canopy.translate(0, 1.4, 0);
  const crown = new THREE.BoxGeometry(0.6, 0.45, 0.6);
  crown.translate(0, 2.025, 0);
  return mergeGeometries([trunk, canopy, crown], true);
}

function treeMaterials(): THREE.Material[] {
  const trunk = new THREE.MeshStandardMaterial({
    map: logTexture(),
    roughness: 0.95,
    flatShading: true,
  });
  const leaves = new THREE.MeshStandardMaterial({
    map: leavesTexture(),
    roughness: 0.9,
    flatShading: true,
  });
  return [trunk, leaves, leaves];
}

/**
 * Per-face materials for a grass block. BoxGeometry group order is
 * +x, -x, +y(top), -y(bottom), +z, -z — so the top is green grass, the bottom
 * is dirt, and the four sides carry the grass-overhang texture.
 */
function grassMaterials(): THREE.Material[] {
  const side = new THREE.MeshStandardMaterial({
    map: grassSideTexture(),
    roughness: 0.9,
    flatShading: true,
  });
  const top = new THREE.MeshStandardMaterial({
    map: grassTopTexture(),
    roughness: 0.9,
    flatShading: true,
  });
  const bottom = new THREE.MeshStandardMaterial({
    map: dirtTexture(),
    roughness: 0.9,
    flatShading: true,
  });
  return [side, side, top, bottom, side, side];
}

/**
 * A land column is one cube stretched from the waterline to its height, so the
 * side faces repeat the 16px texture once per block instead of smearing it down
 * the cliff. Rows more than `dirtRows` below the column's top are stone: with
 * the dirt (or dirt + grass block) above them, a tall cliff shows two blocks of
 * soil over rock.
 */
function columnMaterial(dirtRows: number, dirt: THREE.Texture, stone: THREE.Texture) {
  const mat = new THREE.MeshStandardMaterial({ map: dirt, roughness: 0.95, flatShading: true });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uStone = { value: stone };
    shader.vertexShader =
      "varying float vStoneTop;\n" +
      shader.vertexShader.replace(
        "#include <uv_vertex>",
        `#include <uv_vertex>
  vStoneTop = 0.0;
#if defined(USE_MAP) && defined(USE_INSTANCING)
  if (abs(normal.y) < 0.5) {
    float rows = max(1.0, floor(length(instanceMatrix[1].xyz) + 0.5));
    vMapUv.y *= rows;
    vStoneTop = rows - ${dirtRows.toFixed(1)};
  }
#endif`
      );
    shader.fragmentShader =
      "uniform sampler2D uStone;\nvarying float vStoneTop;\n" +
      shader.fragmentShader.replace(
        "#include <map_fragment>",
        `#ifdef USE_MAP
  diffuseColor *= vMapUv.y < vStoneTop ? texture2D(uStone, vMapUv) : texture2D(map, vMapUv);
#endif`
      );
  };
  // both column materials share one program shape but differ in `dirtRows`
  mat.customProgramCacheKey = () => `mine-column-${dirtRows}`;
  return mat;
}

/**
 * One InstancedKind addressed by tile: at most one instance per land tile, put
 * and removed individually as tiles change form.
 *
 * InstancedKind allocates from a ring, so a slot freed by `remove` is not
 * reused until the ring comes back around — and when it does, it overwrites
 * whatever is there. `put` mirrors that cursor: if the slot about to be taken
 * still holds a live tile, that tile is re-planted (settled, at the next slot)
 * right after, cascading until a free slot absorbs it. With the cap above the
 * land's tile count there is always one, so terrain is never lost to recycling.
 */
export class TileLayer {
  readonly kind: InstancedKind;
  private readonly slotOf = new Int32Array(TILE_COUNT).fill(-1); // tile → slot
  private readonly tileOf: Int32Array; // slot → tile
  private cursor = 0; // the slot InstancedKind.plant will take next
  private readonly pose: Pose = { height: 1, rotY: 0, tiltX: 0, tiltZ: 0, swayPhase: 0, y: 0 };
  private readonly zero = new THREE.Matrix4().makeScale(0, 0, 0);

  constructor(
    scene: THREE.Scene,
    material: THREE.Material | THREE.Material[],
    private readonly cap: number,
    geometry = groundGeometry()
  ) {
    // no instance color → white → the baked textures show their own hues
    this.kind = new InstancedKind(scene, geometry, material, cap, 0, 140, 1);
    this.tileOf = new Int32Array(cap).fill(-1);
  }

  /** The tile drawn by instance `slot`, or -1. */
  tileAt(slot: number): number {
    return this.tileOf[slot] ?? -1;
  }

  /** When the tile's instance was planted (NaN if it has none). */
  bornAt(tile: number): number {
    const slot = this.slotOf[tile];
    return slot < 0 ? NaN : this.kind.slots[slot].bornAt;
  }

  put(tile: number, meta: SproutEvent, y: number, height: number, bornAt: number): void {
    this.remove(tile);
    for (;;) {
      const slot = this.cursor;
      const evicted = this.tileOf[slot];
      const old = this.kind.slots[slot];
      const oldMeta = old.meta;
      const oldY = old.y;
      const oldHeight = old.height;
      this.pose.y = y;
      this.pose.height = height;
      this.kind.plant(
        meta,
        (tile % ISLAND_SIDE) - ISLAND_HALF,
        Math.floor(tile / ISLAND_SIDE) - ISLAND_HALF,
        bornAt,
        this.pose
      );
      this.cursor = (slot + 1) % this.cap;
      this.tileOf[slot] = tile;
      this.slotOf[tile] = slot;
      if (evicted < 0 || !oldMeta) return;
      // the ring wrapped onto a live tile: move it along
      this.slotOf[evicted] = -1;
      tile = evicted;
      meta = oldMeta;
      y = oldY;
      height = oldHeight;
      bornAt = SETTLED;
    }
  }

  remove(tile: number): void {
    const slot = this.slotOf[tile];
    if (slot < 0) return;
    this.slotOf[tile] = -1;
    this.tileOf[slot] = -1;
    this.kind.slots[slot].meta = null;
    const mesh = this.kind.mesh;
    mesh.setMatrixAt(slot, this.zero);
    mesh.instanceMatrix.addUpdateRange(slot * 16, 16);
    mesh.instanceMatrix.needsUpdate = true;
  }
}

/**
 * The island's terrain, drawn: `Terrain` (pure state) decides what every tile
 * shows, and this view keeps one instance per tile per layer to match —
 * a bare dirt column, or a grass block on a dirt pillar, or a beach block,
 * plus the odd tree. Every layer is a single instanced draw.
 */
export class Island implements TerrainView {
  private readonly terrain = new Terrain(this);
  private readonly bare: TileLayer;
  private readonly pillar: TileLayer;
  private readonly grass: TileLayer;
  private readonly sand: TileLayer;
  private readonly trees: TileLayer;
  private readonly layers: TileLayer[];
  /** scene time of the event being applied (terrain changes animate from it) */
  private now = 0;

  constructor(
    scene: THREE.Scene,
    private readonly shore?: Pick<Water, "markLand" | "resetLand">
  ) {
    const dirt = dirtTexture();
    dirt.wrapT = THREE.RepeatWrapping;
    const stone = stoneTexture();
    stone.wrapT = THREE.RepeatWrapping;
    const cap = LAND_TILES + HEADROOM;
    this.bare = new TileLayer(scene, columnMaterial(2, dirt, stone), cap);
    this.pillar = new TileLayer(scene, columnMaterial(1, dirt, stone), cap);
    this.grass = new TileLayer(scene, grassMaterials(), cap);
    const sand = new THREE.MeshStandardMaterial({
      map: sandTexture(),
      roughness: 0.95,
      flatShading: true,
    });
    this.sand = new TileLayer(scene, sand, cap);
    this.trees = new TileLayer(
      scene,
      treeMaterials(),
      CELL_TILE_IDS.length * TREES_PER_CELL + HEADROOM / 8,
      treeGeometry()
    );
    this.layers = [this.grass, this.bare, this.pillar, this.sand, this.trees];
  }

  /** Begin (or revisit) a block's cell; the first block on a slot raises it. */
  startBlock(index: number, height: number, t: number): void {
    this.now = t;
    this.terrain.startBlock(index, height);
  }

  /** XCH spend → the cell's next bare tile turns to grass. */
  placeGrass(event: SproutEvent, t: number): void {
    this.now = t;
    this.terrain.greenNext(event);
  }

  /** Green the tile a special is seated on (its event becomes the tile's metadata). */
  ensureGround(event: SproutEvent, cell: Cell, t: number): void {
    this.now = t;
    this.terrain.greenAt(cell, event);
  }

  /** Reorg: cells raised by invalidated blocks sink; their spends' grass reverts. */
  clearAbove(forkHeight: number): void {
    this.terrain.clearAbove(forkHeight);
  }

  // TerrainView
  show(tile: number, form: number, level: number, cause: Cause): void {
    // a tile greened while its column is still rising rises with the rest of
    // the cell; on settled land the grass pops in place
    const columnBorn = this.bare.bornAt(tile);
    const rising = cause === "raise" || (cause === "green" && this.now - columnBorn < RISE_SECONDS);
    const bornAt =
      cause === "raise"
        ? this.now
        : cause === "settle"
          ? SETTLED
          : rising
            ? columnBorn
            : this.now - GREEN_POP;
    this.bare.remove(tile);
    this.pillar.remove(tile);
    this.grass.remove(tile);
    this.sand.remove(tile);
    if (form === FORM_BARE) this.bare.put(tile, LAND, 0, level + 1, bornAt);
    else if (form === FORM_SAND) this.sand.put(tile, LAND, 0, 1, bornAt);
    else if (form === FORM_GRASS) {
      if (level > 0) this.pillar.put(tile, LAND, 0, level, rising ? bornAt : SETTLED);
      this.grass.put(tile, this.terrain.metaAt(tile) ?? LAND, level, 1, bornAt);
    }
  }
  tree(tile: number, standing: boolean, level: number): void {
    if (standing) this.trees.put(tile, LAND, level + 1, 1, this.now);
    else this.trees.remove(tile);
  }
  land(tile: number): void {
    this.shore?.markLand(
      (tile % ISLAND_SIDE) - ISLAND_HALF,
      Math.floor(tile / ISLAND_SIDE) - ISLAND_HALF
    );
  }
  resetLand(): void {
    this.shore?.resetLand();
  }

  update(t: number): void {
    for (const layer of this.layers) layer.kind.update(t, 1);
  }

  pickables(): THREE.Object3D[] {
    return this.layers.map((l) => l.kind.mesh);
  }
  /**
   * A grass block reports the spend that greened it — as do the pillar beneath
   * it, a tree on it, and a beach tile a spend landed on. Bare land has no
   * spend of its own, so it reports nothing.
   */
  metaFor(object: THREE.Object3D, instanceId: number | undefined): SproutEvent | null {
    for (const layer of this.layers) {
      if (object !== layer.kind.mesh) continue;
      const tile = layer.tileAt(instanceId ?? -1);
      return tile < 0 ? null : this.terrain.metaAt(tile);
    }
    return null;
  }
  setHighlight(object: THREE.Object3D, instanceId: number, on: boolean): boolean {
    if (object !== this.grass.kind.mesh) return false;
    this.grass.kind.setHighlight(instanceId, on);
    return true;
  }
}
