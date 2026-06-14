import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { SproutEvent } from "@grove/shared";
import type { XZ } from "../shared/util.js";
import { cellLocal } from "./layout.js";

const VILLAGER_CAP = 80;

/** Blocky villager (robe body, head, big nose) merged into one geometry. */
export function villagerGeometry(): THREE.BufferGeometry {
  const body = new THREE.BoxGeometry(0.5, 0.7, 0.35);
  body.translate(0, 0.35, 0);
  const head = new THREE.BoxGeometry(0.45, 0.45, 0.45);
  head.translate(0, 0.92, 0);
  const nose = new THREE.BoxGeometry(0.14, 0.28, 0.18);
  nose.translate(0, 0.86, 0.22);
  return mergeGeometries([body, head, nose]);
}

interface Villager {
  mesh: THREE.Mesh;
  meta: SproutEvent | null;
  bornAt: number;
}

export class Villagers {
  private readonly pool: Villager[];
  private next = 0;
  private readonly group = new THREE.Group();

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
    const geometry = villagerGeometry();
    const material = new THREE.MeshStandardMaterial({ color: 0x7a6a52, roughness: 0.9, flatShading: true });
    this.pool = Array.from({ length: VILLAGER_CAP }, () => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.visible = false;
      this.group.add(mesh);
      return { mesh, meta: null, bornAt: 0 };
    });
  }

  plant(event: SproutEvent, chunk: XZ, seat: { col: number; row: number; layer: number }, t: number): void {
    const v = this.pool[this.next];
    this.next = (this.next + 1) % VILLAGER_CAP;
    const local = cellLocal({ col: seat.col, row: seat.row }, seat.layer);
    v.mesh.position.set(chunk.x + local.x, local.y, chunk.z + local.z);
    v.mesh.visible = true;
    v.meta = event;
    v.bornAt = t;
  }

  update(t: number): void {
    for (const v of this.pool) {
      if (!v.meta) continue;
      const p = Math.min((t - v.bornAt) / 0.6, 1);
      v.mesh.scale.setScalar(p); // pop-in
    }
  }
  clearAbove(forkHeight: number): void {
    for (const v of this.pool) {
      if (v.meta && v.meta.height >= forkHeight) {
        v.meta = null;
        v.mesh.visible = false;
      }
    }
  }
  pickables(): THREE.Object3D[] {
    return this.pool.filter((v) => v.meta).map((v) => v.mesh);
  }
  metaFor(object: THREE.Object3D): SproutEvent | null {
    return this.pool.find((v) => v.mesh === object)?.meta ?? null;
  }
}
