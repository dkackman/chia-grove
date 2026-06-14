import * as THREE from "three";
import type { XZ } from "../shared/util.js";
import { MINE } from "./palette.js";

const BEACON_CAP = 12;
const TORCH_CAP = 60;

export function torchGeometry(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(0.12, 0.6, 0.12);
  g.translate(0, 0.3, 0);
  return g;
}

interface Beacon {
  mesh: THREE.Mesh;
  bornAt: number;
  active: boolean;
}

export class Vfx {
  private readonly beacons: Beacon[];
  private nextBeacon = 0;
  private readonly torches: THREE.Mesh[];
  private readonly flames: THREE.Sprite[];
  private litCount = 0;

  constructor(
    scene: THREE.Scene,
    private readonly sky: { daylight: number }
  ) {
    const beamGeo = new THREE.CylinderGeometry(0.18, 0.18, 60, 8, 1, true);
    beamGeo.translate(0, 30, 0);
    this.beacons = Array.from({ length: BEACON_CAP }, () => {
      const mesh = new THREE.Mesh(
        beamGeo,
        new THREE.MeshBasicMaterial({ color: MINE.beacon, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false })
      );
      mesh.visible = false;
      scene.add(mesh);
      return { mesh, bornAt: 0, active: false };
    });

    const torchGeo = torchGeometry();
    const torchMat = new THREE.MeshStandardMaterial({ color: 0x5a3d23, roughness: 0.9 });
    const flameMat = () => new THREE.SpriteMaterial({ color: MINE.torch, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    this.torches = [];
    this.flames = [];
    for (let i = 0; i < TORCH_CAP; i++) {
      const angle = (i / TORCH_CAP) * Math.PI * 2;
      const r = 40;
      const torch = new THREE.Mesh(torchGeo, torchMat);
      torch.position.set(Math.cos(angle) * r, 0, Math.sin(angle) * r);
      torch.visible = false;
      scene.add(torch);
      const flame = new THREE.Sprite(flameMat());
      flame.scale.setScalar(0.9);
      flame.position.copy(torch.position).setY(0.7);
      scene.add(flame);
      this.torches.push(torch);
      this.flames.push(flame);
    }
  }

  /** Mint flag → fire a beacon beam from the block's chunk. */
  beacon(chunk: XZ, t: number): void {
    const b = this.beacons[this.nextBeacon];
    this.nextBeacon = (this.nextBeacon + 1) % BEACON_CAP;
    b.mesh.position.set(chunk.x, 0, chunk.z);
    b.mesh.visible = true;
    b.active = true;
    b.bornAt = t;
  }

  /** Mempool size → number of lit rim torches. */
  setMempool(size: number): void {
    this.litCount = Math.max(0, Math.min(TORCH_CAP, Math.round(size / 4)));
  }

  update(t: number): void {
    for (const b of this.beacons) {
      if (!b.active) continue;
      const age = t - b.bornAt;
      const op = Math.max(0, 0.7 - age * 0.25);
      (b.mesh.material as THREE.MeshBasicMaterial).opacity = op;
      if (op <= 0) { b.active = false; b.mesh.visible = false; }
    }
    const night = 1 - this.sky.daylight;
    for (let i = 0; i < TORCH_CAP; i++) {
      const lit = i < this.litCount;
      this.torches[i].visible = lit;
      const flicker = 0.7 + 0.3 * Math.sin(t * 6 + i);
      (this.flames[i].material as THREE.SpriteMaterial).opacity = lit ? night * flicker : 0;
    }
  }
}
