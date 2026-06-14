import * as THREE from "three";
import type { SproutEvent } from "@grove/shared";
import type { XZ } from "../shared/util.js";
import { InstancedKind, type Pose } from "../shared/instanced.js";
import { MINE } from "./palette.js";
import { floorCell, cellLocal, type Cell } from "./layout.js";
import { speckleTexture } from "./textures.js";

const GROUND_CAP = 2000;

/** Unit cube whose base sits at y=0 so it grows upward from its seat. */
export function groundGeometry(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(1, 1, 1);
  g.translate(0, 0.5, 0);
  return g;
}

const FLAT_POSE = (): Pose => ({ height: 1, rotY: 0, tiltX: 0, tiltZ: 0, swayPhase: 0 });

export class Island {
  private readonly ground: InstancedKind;
  private readonly grass = new THREE.Color(MINE.grassTop);
  private readonly dirt = new THREE.Color(MINE.dirt);
  // per-current-block occupancy + floor cursor (reset on each new block)
  private occupied = new Set<string>();
  private floorCursor = 0;
  private chunk: XZ = { x: 0, z: 0 };

  constructor(scene: THREE.Scene) {
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.95,
      flatShading: true,
      map: speckleTexture(),
    });
    this.ground = new InstancedKind(scene, groundGeometry(), material, GROUND_CAP, 0, 140, 1);
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

  private place(event: SproutEvent, cell: Cell, color: THREE.Color, t: number): void {
    const key = `${cell.col},${cell.row}`;
    if (this.occupied.has(key)) return;
    this.occupied.add(key);
    const local = cellLocal(cell, 0);
    const pose = FLAT_POSE();
    pose.color = color;
    pose.y = local.y;
    this.ground.plant(event, this.chunk.x + local.x, this.chunk.z + local.z, t, pose);
  }

  update(t: number): void {
    this.ground.update(t, 1);
  }

  clearAbove(forkHeight: number): void {
    this.ground.clearWhere((m) => m.height >= forkHeight);
  }

  pickables(): THREE.Object3D[] {
    return [this.ground.mesh];
  }
  metaFor(object: THREE.Object3D, instanceId: number | undefined): SproutEvent | null {
    return object === this.ground.mesh ? this.ground.metaAt(instanceId ?? -1) : null;
  }
}
