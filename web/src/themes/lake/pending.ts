import * as THREE from "three";
import { mulberry32 } from "../shared/util.js";
import {
  BAND_RADIUS_MIN,
  BAND_RADIUS_MAX,
  PENDING_Y_MIN,
  PENDING_Y_MAX,
  TOP_BAND_Y,
} from "./layout.js";
import { LAKE } from "./palette.js";
import { fishGeometry, applySwimShader } from "./bodies.js";

/** Mempool size that fills the layer — the same "full" the board gauge uses. */
const MEMPOOL_FULL = 5000;
/** Average cost per pending spend at which churn is fully agitated. */
const COST_FULL = 5e8;
const CHURN_CAP = 600;
const SILHOUETTE_SIZE = 0.32;
/** Reserved tail-region instance slots for released silhouettes mid-descent. */
const FALL_CAP = 200;
/** Seconds a released silhouette takes to sink through the newest band. */
const FALL_SECONDS = 1.1;
/** How far below the newest band a released silhouette fades out. */
const FALL_DEPTH = 3;

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
}

/** A silhouette detached from the churn layer, sinking through the newest band. */
interface FallSlot {
  fromY: number;
  radius: number;
  angle: number;
  bornAt: number;
  active: boolean;
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
  private readonly falls: FallSlot[];
  private nextFall = 0;
  private activeFalls = 0;

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
    // Falling silhouettes get their own reserved tail slots on this same mesh
    // (one draw call) rather than borrowing churn slots — a shrinking mempool
    // must not yank a silhouette out of the air mid-descent.
    this.mesh = new THREE.InstancedMesh(fishGeometry(), material, cap + FALL_CAP);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    const phase = new THREE.InstancedBufferAttribute(new Float32Array(cap + FALL_CAP), 1);
    this.mesh.geometry.setAttribute("aSwimPhase", phase);

    const rand = mulberry32(0x9a7e1c03);
    this.slots = Array.from({ length: cap }, (_, i) => {
      phase.setX(i, rand() * Math.PI * 2);
      return {
        radius: BAND_RADIUS_MIN + Math.sqrt(rand()) * (BAND_RADIUS_MAX - BAND_RADIUS_MIN),
        angle: rand() * Math.PI * 2,
        speed: (0.12 + rand() * 0.28) * (rand() < 0.5 ? -1 : 1), // both bearings: churn, not a parade
        bob: rand() * Math.PI * 2,
      };
    });
    phase.needsUpdate = true;

    this.falls = Array.from({ length: FALL_CAP }, () => ({
      fromY: 0,
      radius: 0,
      angle: 0,
      bornAt: 0,
      active: false,
    }));

    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < cap + FALL_CAP; i++) this.mesh.setMatrixAt(i, zero);
    this.mesh.count = cap + FALL_CAP;
    scene.add(this.mesh);
  }

  setMempool(size: number, cost: string): void {
    this.litSlots = litCount(size, this.slots.length);
    this.rate = churnRate(size, cost);
  }

  lit(): number {
    return this.litSlots;
  }

  /**
   * A block confirmed: detach `count` silhouettes from the churn layer and sink
   * them through the newest band. Releases `min(count, lit, FALL_CAP)` — a big
   * block can outrun a small mempool, and a snapshot replay arrives with no
   * ambient history at all, so this is a gesture rather than an accounting.
   *
   * @returns how many actually fell.
   */
  release(count: number, t: number): number {
    if (!Number.isFinite(count) || count <= 0) return 0;
    const n = Math.min(Math.floor(count), this.litSlots, FALL_CAP);
    for (let k = 0; k < n; k++) {
      // take from the churn layer's tail so the visible thinning reads as the
      // layer being drained rather than punched through the middle
      const source = this.slots[this.litSlots - 1 - k];
      const fall = this.falls[this.nextFall];
      this.nextFall = (this.nextFall + 1) % FALL_CAP;
      if (!fall.active) this.activeFalls++;
      fall.fromY = (PENDING_Y_MAX + PENDING_Y_MIN) / 2;
      fall.radius = source.radius;
      fall.angle = source.angle + t * source.speed * this.rate;
      fall.bornAt = t;
      fall.active = true;
    }
    return n;
  }

  /** How many silhouettes are mid-descent. Test seam. */
  falling(): number {
    return this.activeFalls;
  }

  /** Instance index of the nth fall slot. Test seam. */
  fallSlotIndex(n: number): number {
    return this.slots.length + n;
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

    // the descent: released silhouettes sink past the newest band and fade.
    // Inactive slots are left untouched rather than re-zeroed every frame:
    // the eased scale below already reaches exactly 0 at p===1, so a slot
    // that just finished is already invisible in the last matrix it wrote.
    // Skipping the write (instead of overwriting it with a fresh zero-scale
    // matrix whose *position* is also zeroed) keeps that last real position
    // — past the band, not snapped back to the origin — readable in the
    // buffer for one frame's grace, which is what confirms the silhouette
    // actually crossed the band before its slot goes quiet.
    const target = TOP_BAND_Y - FALL_DEPTH;
    for (let k = 0; k < this.falls.length; k++) {
      const fall = this.falls[k];
      if (!fall.active) continue;
      const index = this.slots.length + k;
      const raw = (t - fall.bornAt) / FALL_SECONDS;
      // ease-in: hesitates, then commits — a sinking motion, not a drop.
      // Clamp at 1 so a slot lingering past its fall time (it deactivates
      // below, same frame) still renders its resting position, not an
      // overshoot.
      const p = Math.min(1, raw);
      const eased = p * p;
      const y = fall.fromY + (target - fall.fromY) * eased;
      const heading = -(fall.angle + Math.PI / 2);
      this.euler.set(0, heading, 0);
      this.quaternion.setFromEuler(this.euler);
      this.matrix.compose(
        this.position.set(Math.cos(fall.angle) * fall.radius, y, Math.sin(fall.angle) * fall.radius),
        this.quaternion,
        this.scale.setScalar(SILHOUETTE_SIZE * (1 - eased)) // shrink away as it crosses
      );
      this.mesh.setMatrixAt(index, this.matrix);
      if (raw >= 1) {
        fall.active = false;
        this.activeFalls--;
      }
    }

    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
