import * as THREE from "three";
import type { SproutEvent } from "@grove/shared";
import type { XZ } from "../shared/util.js";
import { InstancedKind, type Pose } from "../shared/instanced.js";
import { floorCell, cellLocal, chunkElevation, type Cell } from "./layout.js";
import { grassTopTexture, dirtTexture, grassSideTexture } from "./textures.js";

// Big enough that ground for the whole island footprint persists without
// recycling — terrain accumulates and stays. InstancedKind only draws the
// instances actually planted, so this headroom is cheap until it fills.
const GRASS_CAP = 6000;
const DIRT_CAP = 6000;

/** Unit cube whose base sits at y=0 so it grows upward from its seat. */
export function groundGeometry(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(1, 1, 1);
  g.translate(0, 0.5, 0);
  return g;
}

const FLAT_POSE = (): Pose => ({ height: 1, rotY: 0, tiltX: 0, tiltZ: 0, swayPhase: 0 });

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
function dirtMaterial(): THREE.Material {
  return new THREE.MeshStandardMaterial({ map: dirtTexture(), roughness: 0.95, flatShading: true });
}

interface ChunkGround {
  cursor: number; // next floor tile for this chunk's XCH spends (persists across visits)
  occupied: Map<string, number>; // cell key → height of the block that grounded it
}

export class Island {
  private readonly grass: InstancedKind;
  private readonly dirt: InstancedKind;
  // Terrain is keyed by chunk (block-slot) index and persists across the
  // block-slot cycle, so the island builds up and stays rather than churning.
  // Specials (CATs/NFTs/villagers) still recycle on their own caps — only the
  // activity on top churns; the ground beneath it is permanent.
  private readonly chunks = new Map<number, ChunkGround>();
  private current: ChunkGround = { cursor: 0, occupied: new Map() };
  private chunk: XZ = { x: 0, z: 0 };

  constructor(scene: THREE.Scene) {
    // grass carries the 6-material array (green top, dirt sides/bottom); dirt is
    // uniform brown. Both render their baked textures untinted — instances keep
    // the default white instanceColor.
    this.grass = new InstancedKind(scene, groundGeometry(), grassMaterials(), GRASS_CAP, 0, 140, 1);
    this.dirt = new InstancedKind(scene, groundGeometry(), dirtMaterial(), DIRT_CAP, 0, 140, 1);
  }

  /** Begin (or revisit) a block's chunk; ground state for that slot persists. */
  startBlock(chunk: XZ, index: number): void {
    this.chunk = chunk;
    let state = this.chunks.get(index);
    if (!state) {
      state = { cursor: 0, occupied: new Map() };
      this.chunks.set(index, state);
    }
    this.current = state;
  }

  /** XCH spend → next still-empty grass floor tile for this chunk. */
  placeGrass(event: SproutEvent, t: number): void {
    const cell = floorCell(this.current.cursor++);
    this.place(event, cell, this.grass, t);
  }

  /**
   * Ground a special's own seat cell so it rests on land instead of floating
   * over water. Specials seat center-first on adjacent cells, so a cluster's
   * seat tiles already merge into one contiguous patch — no wider apron needed.
   * (A halo would also mislead hover: these tiles carry the special's event as
   * metadata, so surrounding grass would wrongly report the special.)
   */
  ensureGround(event: SproutEvent, cell: Cell, t: number): void {
    this.place(event, cell, this.grass, t);
  }

  // One ground cube per cell per chunk for the island's lifetime; whichever kind
  // reaches the cell first wins. Ground persists, so a special always has terrain
  // beneath it even after the special itself recycles.
  private place(event: SproutEvent, cell: Cell, kind: InstancedKind, t: number): void {
    const key = `${cell.col},${cell.row}`;
    if (this.current.occupied.has(key)) return;
    this.current.occupied.set(key, event.height);
    const local = cellLocal(cell, 0);
    const e = chunkElevation(this.chunk);
    const wx = this.chunk.x + local.x;
    const wz = this.chunk.z + local.z;
    // the surface block sits at the chunk's terrace height
    const top = FLAT_POSE();
    top.y = e; // no color → white → the baked textures show their own hues
    kind.plant(event, wx, wz, t, top);
    // one dirt pillar fills the cliff down to the waterline when the chunk is raised
    if (e > 0) {
      const pillar = FLAT_POSE();
      pillar.y = 0;
      pillar.height = e;
      this.dirt.plant(event, wx, wz, t, pillar);
    }
  }

  update(t: number): void {
    this.grass.update(t, 1);
    this.dirt.update(t, 1);
  }

  clearAbove(forkHeight: number): void {
    this.grass.clearWhere((m) => m.height >= forkHeight);
    this.dirt.clearWhere((m) => m.height >= forkHeight);
    // re-open the cleared cells so replayed blocks re-ground them
    for (const state of this.chunks.values()) {
      for (const [cellKey, height] of state.occupied) {
        if (height >= forkHeight) state.occupied.delete(cellKey);
      }
    }
  }

  pickables(): THREE.Object3D[] {
    return [this.grass.mesh, this.dirt.mesh];
  }
  metaFor(object: THREE.Object3D, instanceId: number | undefined): SproutEvent | null {
    if (object === this.grass.mesh) return this.grass.metaAt(instanceId ?? -1);
    if (object === this.dirt.mesh) return this.dirt.metaAt(instanceId ?? -1);
    return null;
  }
  setHighlight(object: THREE.Object3D, instanceId: number, on: boolean): boolean {
    if (object !== this.grass.mesh) return false;
    this.grass.setHighlight(instanceId, on);
    return true;
  }
}
