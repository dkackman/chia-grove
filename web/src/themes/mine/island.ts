import * as THREE from "three";
import type { SproutEvent } from "@grove/shared";
import type { XZ } from "../shared/util.js";
import { InstancedKind, type Pose } from "../shared/instanced.js";
import { floorCell, cellLocal, chunkElevation, type Cell } from "./layout.js";
import { grassTopTexture, dirtTexture, grassSideTexture } from "./textures.js";

const GRASS_CAP = 2000;
const DIRT_CAP = 3000;

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
  const side = new THREE.MeshStandardMaterial({ map: grassSideTexture(), roughness: 0.9, flatShading: true });
  const top = new THREE.MeshStandardMaterial({ map: grassTopTexture(), roughness: 0.9, flatShading: true });
  const bottom = new THREE.MeshStandardMaterial({ map: dirtTexture(), roughness: 0.9, flatShading: true });
  return [side, side, top, bottom, side, side];
}
function dirtMaterial(): THREE.Material {
  return new THREE.MeshStandardMaterial({ map: dirtTexture(), roughness: 0.95, flatShading: true });
}

export class Island {
  private readonly grass: InstancedKind;
  private readonly dirt: InstancedKind;
  // per-current-block occupancy + floor cursor (reset on each new block)
  private occupied = new Set<string>();
  private floorCursor = 0;
  private chunk: XZ = { x: 0, z: 0 };

  constructor(scene: THREE.Scene) {
    // grass carries the 6-material array (green top, dirt sides/bottom); dirt is
    // uniform brown. Both render their baked textures untinted — instances keep
    // the default white instanceColor.
    this.grass = new InstancedKind(scene, groundGeometry(), grassMaterials(), GRASS_CAP, 0, 140, 1);
    this.dirt = new InstancedKind(scene, groundGeometry(), dirtMaterial(), DIRT_CAP, 0, 140, 1);
  }

  /** Begin a new block's chunk. */
  startBlock(chunk: XZ): void {
    this.chunk = chunk;
    this.occupied = new Set();
    this.floorCursor = 0;
  }

  /** XCH spend → next grass floor tile. */
  placeGrass(event: SproutEvent, t: number): void {
    const cell = floorCell(this.floorCursor++);
    this.place(event, cell, this.grass, t);
  }

  /** Ensure a ground cube under a special's cell (dirt if XCH didn't pave it). */
  ensureGround(event: SproutEvent, cell: Cell, t: number): void {
    this.place(event, cell, this.dirt, t);
  }

  // One ground cube per cell per block; whichever kind (grass/dirt) reaches the
  // cell first wins, so a special never double-stacks ground beneath it.
  private place(event: SproutEvent, cell: Cell, kind: InstancedKind, t: number): void {
    const key = `${cell.col},${cell.row}`;
    if (this.occupied.has(key)) return;
    this.occupied.add(key);
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
  }

  pickables(): THREE.Object3D[] {
    return [this.grass.mesh, this.dirt.mesh];
  }
  metaFor(object: THREE.Object3D, instanceId: number | undefined): SproutEvent | null {
    if (object === this.grass.mesh) return this.grass.metaAt(instanceId ?? -1);
    if (object === this.dirt.mesh) return this.dirt.metaAt(instanceId ?? -1);
    return null;
  }
}
