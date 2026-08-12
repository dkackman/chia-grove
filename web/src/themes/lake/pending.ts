import * as THREE from "three";
import { mulberry32 } from "../shared/util.js";
import { BAND_RADIUS_MIN, BAND_RADIUS_MAX, PENDING_Y_MIN, PENDING_Y_MAX } from "./layout.js";
import { LAKE } from "./palette.js";
import { fishGeometry, applySwimShader } from "./bodies.js";

/** Mempool size that fills the layer — the same "full" the board gauge uses. */
const MEMPOOL_FULL = 5000;
/** Average cost per pending spend at which churn is fully agitated. */
const COST_FULL = 5e8;
const CHURN_CAP = 600;
const SILHOUETTE_SIZE = 0.32;

/** Mempool size → how many silhouettes are lit. Pure. */
export function litCount(mempoolSize: number, cap: number): number {
  if (!Number.isFinite(mempoolSize) || mempoolSize <= 0) return 0;
  return Math.min(cap, Math.round((mempoolSize / MEMPOOL_FULL) * cap));
}

/**
 * Average cost per pending spend → churn speed multiplier in 0.5..1.5.
 * A congested mempool is a turbulent one. Never returns 0: an idle layer
 * should still drift, or it reads as frozen rather than calm.
 *
 * `mempoolCost` is a string — like `feeWarmth(fees: string)` in bands.ts and
 * `clarityFromNetspace(bytes: string)` in scales.ts, mojo/cost totals can
 * exceed Number.MAX_SAFE_INTEGER, so the wire type is a string and this
 * coerces internally rather than pushing that onto every call site.
 */
export function churnRate(mempoolSize: number, mempoolCost: string): number {
  const cost = Number(mempoolCost);
  if (!Number.isFinite(mempoolSize) || !Number.isFinite(cost) || mempoolSize <= 0) {
    return 0.5;
  }
  const avg = cost / mempoolSize;
  if (!Number.isFinite(avg) || avg <= 0) return 0.5;
  return 0.5 + Math.min(1, avg / COST_FULL);
}

interface ChurnSlot {
  radius: number;
  angle: number;
  speed: number;
  bob: number;
  y: number;
}

/**
 * The mempool, rendered where the mempool belongs: a restless layer under the
 * surface, above the newest band. The silhouettes are deliberately anonymous —
 * small, dark, uncolored, unpickable. The server reports mempool size, cost and
 * fees and never reports *what* is pending, so giving these a kind or an asset
 * color would be inventing data the chain did not send.
 *
 * Slots are seeded from a fixed PRNG, so a snapshot replay rebuilds the same
 * layer rather than reshuffling it.
 */
export class Pending {
  readonly mesh: THREE.InstancedMesh;
  private readonly slots: ChurnSlot[];
  private readonly swim: { uniforms: { uTime: { value: number } } };
  private litSlots = 0;
  private rate = 0.5;
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly quaternion = new THREE.Quaternion();
  private readonly euler = new THREE.Euler();
  private readonly scale = new THREE.Vector3();

  constructor(scene: THREE.Scene, cap = CHURN_CAP) {
    const material = new THREE.MeshStandardMaterial({
      color: LAKE.pending,
      roughness: 0.9,
      metalness: 0,
      transparent: true,
      opacity: 0.75,
      side: THREE.DoubleSide,
    });
    this.swim = applySwimShader(material, {
      instanced: true,
      amp: 0.1,
      freq: 8.0, // faster than a real fish: these are agitated, not swimming
      waveLen: 3.2,
      nose: 0.6,
      span: 1.2,
    });
    this.mesh = new THREE.InstancedMesh(fishGeometry(), material, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    const phase = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
    this.mesh.geometry.setAttribute("aSwimPhase", phase);

    const rand = mulberry32(0x9a7e1c03);
    this.slots = Array.from({ length: cap }, (_, i) => {
      phase.setX(i, rand() * Math.PI * 2);
      return {
        radius: BAND_RADIUS_MIN + Math.sqrt(rand()) * (BAND_RADIUS_MAX - BAND_RADIUS_MIN),
        angle: rand() * Math.PI * 2,
        speed: (0.12 + rand() * 0.28) * (rand() < 0.5 ? -1 : 1), // both bearings: churn, not a parade
        bob: rand() * Math.PI * 2,
        y: PENDING_Y_MIN + rand() * (PENDING_Y_MAX - PENDING_Y_MIN),
      };
    });
    phase.needsUpdate = true;

    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < cap; i++) this.mesh.setMatrixAt(i, zero);
    this.mesh.count = cap;
    scene.add(this.mesh);
  }

  setMempool(size: number, cost: string): void {
    this.litSlots = litCount(size, this.slots.length);
    this.rate = churnRate(size, cost);
  }

  lit(): number {
    return this.litSlots;
  }

  update(_dt: number, t: number): void {
    this.swim.uniforms.uTime.value = t;
    for (let i = 0; i < this.slots.length; i++) {
      if (i >= this.litSlots) {
        this.matrix.makeScale(0, 0, 0);
        this.mesh.setMatrixAt(i, this.matrix);
        continue;
      }
      const slot = this.slots[i];
      const angle = slot.angle + t * slot.speed * this.rate;
      // a shallow vertical mill inside the layer, never leaving it
      const span = (PENDING_Y_MAX - PENDING_Y_MIN) / 2;
      const mid = (PENDING_Y_MAX + PENDING_Y_MIN) / 2;
      const y = mid + Math.sin(t * 0.6 * this.rate + slot.bob) * span;
      const heading = -(angle + Math.PI / 2);
      this.euler.set(0, heading, 0);
      this.quaternion.setFromEuler(this.euler);
      this.matrix.compose(
        this.position.set(Math.cos(angle) * slot.radius, y, Math.sin(angle) * slot.radius),
        this.quaternion,
        this.scale.setScalar(SILHOUETTE_SIZE)
      );
      this.mesh.setMatrixAt(i, this.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
