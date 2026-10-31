import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { FIELD, rowZ } from "./layout.js";
import { FARM } from "./palette.js";

// the flock's home range, on the turf near the barn
const HOME = { x: -14, z: rowZ(FIELD.rows - 1) - 3, spread: 7 };
/** How quickly a hen turns toward where she is heading (1/s). */
const TURN_RATE = 6;

interface Hen {
  x: number;
  z: number;
  wx: number;
  wz: number;
  yaw: number;
  phase: number;
  speed: number;
  chaseUntil: number;
  /** while chasing: how far behind the plow, and across the row, she trails */
  trail: number;
  side: number;
}

/** Where a following hen heads along the row: `trail` behind the plow at
 *  `plowX`, which is heading `direction`. Exported for testing. */
export function followTarget(plowX: number, direction: 1 | -1, trail: number): number {
  return plowX - direction * trail;
}

/** How many hens chase a block: one per mempool item it included (live
 *  blocks carry `mempoolIncluded`), else ~40% of the flock; never more than
 *  are out. Exported for testing. */
export function chaseCount(included: number | undefined, visible: number): number {
  if (included === undefined) return Math.round(visible * 0.4);
  return Math.max(0, Math.min(visible, Math.round(included)));
}

function chickenGeometry(): THREE.BufferGeometry {
  const body = new THREE.SphereGeometry(0.16, 8, 6);
  body.scale(1.2, 1, 1);
  body.translate(0, 0.16, 0);
  const head = new THREE.SphereGeometry(0.08, 8, 6);
  head.translate(0.16, 0.32, 0);
  const beak = new THREE.ConeGeometry(0.03, 0.08, 4);
  beak.rotateZ(-Math.PI / 2);
  beak.translate(0.26, 0.32, 0);
  return mergeGeometries([body, head, beak]);
}

export class Chickens {
  private readonly mesh: THREE.InstancedMesh;
  private readonly hens: Hen[];
  private visible = 8;
  private chaseZ = 0;
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly quaternion = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3(1, 1, 1);
  // yaw first, then the peck's pitch about the hen's own sideways axis
  private readonly euler = new THREE.Euler(0, 0, 0, "YZX");

  constructor(
    scene: THREE.Scene,
    private readonly max: number
  ) {
    this.mesh = new THREE.InstancedMesh(
      chickenGeometry(),
      new THREE.MeshStandardMaterial({ color: FARM.chicken, roughness: 0.8 }),
      max
    );
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    // only the hens that are out get drawn
    this.mesh.count = this.visible;
    scene.add(this.mesh);
    this.hens = Array.from({ length: max }, () => ({
      x: HOME.x + (Math.random() - 0.5) * HOME.spread,
      z: HOME.z + (Math.random() - 0.5) * HOME.spread,
      wx: HOME.x + (Math.random() - 0.5) * HOME.spread,
      wz: HOME.z + (Math.random() - 0.5) * HOME.spread,
      yaw: Math.random() * Math.PI * 2,
      phase: Math.random() * Math.PI * 2,
      speed: 0.6 + Math.random() * 0.5,
      chaseUntil: 0,
      trail: 0,
      side: 0,
    }));
  }

  /** Flock size tracks pending transactions. */
  setMempool(size: number): void {
    this.visible = Math.max(8, Math.min(this.max, 8 + Math.round(size / 4)));
    this.mesh.count = this.visible;
  }

  /** Hens currently out (drawn). */
  visibleCount(): number {
    return this.visible;
  }

  /** Hens chasing the plow at `t`. */
  chasingCount(t: number): number {
    let n = 0;
    for (let i = 0; i < this.visible; i++) if (this.hens[i].chaseUntil > t) n++;
    return n;
  }

  /**
   * A new block: `count` of the hens that are out (see `chaseCount`) run after
   * the plow along the row at `z` until `until`, trailing behind it.
   */
  chase(z: number, until: number, count: number): void {
    this.chaseZ = z;
    const n = Math.min(count, this.visible);
    // a random subset of the visible hens (partial Fisher-Yates)
    const order = Array.from({ length: this.visible }, (_, i) => i);
    for (let k = 0; k < n; k++) {
      const j = k + Math.floor(Math.random() * (order.length - k));
      [order[k], order[j]] = [order[j], order[k]];
      const hen = this.hens[order[k]];
      hen.chaseUntil = until;
      hen.trail = 1.2 + Math.random() * 5;
      hen.side = (Math.random() - 0.5) * 1.6;
    }
  }

  /** `plow` is where the tractor is now (null before the first block). */
  update(t: number, dt: number, plow: { x: number; direction: 1 | -1 } | null): void {
    for (let i = 0; i < this.visible; i++) {
      const hen = this.hens[i];
      const chasing = hen.chaseUntil > t;
      if (chasing && plow) {
        hen.wx = followTarget(plow.x, plow.direction, hen.trail);
        hen.wz = this.chaseZ + hen.side;
      }
      const dx = hen.wx - hen.x;
      const dz = hen.wz - hen.z;
      const dist = Math.hypot(dx, dz);
      let pecking = true;
      if (dist < 0.2) {
        // arrived: peck a while, then wander home range
        if (!chasing) {
          hen.wx = HOME.x + (Math.random() - 0.5) * HOME.spread;
          hen.wz = HOME.z + (Math.random() - 0.5) * HOME.spread;
        }
      } else {
        const step = Math.min(dist, (chasing ? 2.2 : 0.8) * hen.speed * dt);
        hen.x += (dx / dist) * step;
        hen.z += (dz / dist) * step;
        // turn smoothly toward the heading; local +x is the beak, and
        // rotation.y = θ points it at (cos θ, 0, −sin θ)
        const target = Math.atan2(-dz, dx);
        let delta = (target - hen.yaw) % (Math.PI * 2);
        if (delta > Math.PI) delta -= Math.PI * 2;
        if (delta < -Math.PI) delta += Math.PI * 2;
        hen.yaw += delta * Math.min(1, dt * TURN_RATE);
        pecking = !chasing; // a hen running after the plow doesn't stop to peck
      }
      // peck: tip forward about the feet, beak to the ground
      const peck = pecking ? Math.max(0, Math.sin(t * 5 * hen.speed + hen.phase)) : 0;
      this.quaternion.setFromEuler(this.euler.set(0, hen.yaw, -peck * 0.55));
      this.matrix.compose(this.position.set(hen.x, 0, hen.z), this.quaternion, this.scale);
      this.mesh.setMatrixAt(i, this.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
