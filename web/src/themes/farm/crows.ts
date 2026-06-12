import * as THREE from "three";
import { FARM } from "./palette.js";

const FLIGHT_SECONDS = 3;
const SPAN_X = 32; // sweep from +x to −x across the field

// Hoisted to avoid per-crow per-frame allocation in update()
const Y_AXIS = new THREE.Vector3(0, 1, 0);

export class Crows {
  private readonly mesh: THREE.InstancedMesh;
  private startedAt = -Infinity;
  private zMin = 0;
  private zMax = 0;
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly quaternion = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private readonly offsets: Array<{ dz: number; dy: number; dphase: number }>;

  constructor(
    scene: THREE.Scene,
    private readonly count: number
  ) {
    const wing = new THREE.ConeGeometry(0.18, 0.5, 3);
    wing.rotateX(Math.PI / 2); // point along −z, flat-ish silhouette
    wing.scale(1, 0.25, 1);
    this.mesh = new THREE.InstancedMesh(
      wing,
      new THREE.MeshBasicMaterial({ color: FARM.crow }),
      count
    );
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < count; i++) this.mesh.setMatrixAt(i, zero);
    scene.add(this.mesh);
    this.offsets = Array.from({ length: count }, () => ({
      dz: Math.random(),
      dy: Math.random() * 1.4,
      dphase: Math.random() * Math.PI * 2,
    }));
  }

  /** Reorg: sweep the flock across the band of recently planted rows. */
  fly(zMin: number, zMax: number, t: number): void {
    this.zMin = zMin;
    this.zMax = zMax;
    this.startedAt = t;
  }

  update(t: number): void {
    const progress = (t - this.startedAt) / FLIGHT_SECONDS;
    for (let i = 0; i < this.count; i++) {
      if (progress < 0 || progress > 1) {
        this.matrix.makeScale(0, 0, 0);
        this.mesh.setMatrixAt(i, this.matrix);
        continue;
      }
      const o = this.offsets[i];
      const flap = 1 + Math.sin(t * 11 + o.dphase) * 0.5;
      this.position.set(
        SPAN_X - progress * 2 * SPAN_X + Math.sin(o.dphase) * 3,
        2.2 + o.dy + Math.sin(t * 9 + o.dphase) * 0.25,
        this.zMin + o.dz * (this.zMax - this.zMin)
      );
      this.quaternion.setFromAxisAngle(Y_AXIS, Math.PI / 2);
      this.matrix.compose(this.position, this.quaternion, this.scale.set(flap, 1, 1));
      this.mesh.setMatrixAt(i, this.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
