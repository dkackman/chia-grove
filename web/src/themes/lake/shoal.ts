import * as THREE from "three";
import type { SproutEvent } from "@grove/shared";
import { BAND_RADIUS_MAX, BED_Y, TOP_BAND_Y, bandDepth, seatOffset } from "./layout.js";
import type { Seat } from "./layout.js";
import { fishGeometry, applySwimShader } from "./bodies.js";
import { wanderedRadius, wanderedAngle, bankRoll } from "./motion.js";
import { entryScale, entryDrop } from "./entry.js";

const WHITE = new THREE.Color(0xffffff);
const HIGHLIGHT_BOOST = 2.2;
// 18 bands rather than 40 means a smaller standing population; a cap far above
// it only delays pool wrap without ever being reached.
const DEFAULT_CAP = 500;
const BOB_AMPLITUDE = 0.35;

interface FishSlot {
  meta: SproutEvent | null;
  bornBlock: number;
  bornAt: number;
  seat: Seat;
  size: number;
  baseColor: THREE.Color;
}

/**
 * A pool of instanced fish sharing one mesh. This does not use `InstancedKind`:
 * that class pins an instance at (x, z) and grows it upward from a base, which
 * cannot express a fish that moves along a path and turns to face its heading.
 * The parts of it that did earn their keep are reproduced here — the wrapping
 * slot pool, the reorg cull with its draw-count shrink, metaAt for picking, and
 * the white instance-color init (skip that and untinted instances render black).
 *
 * Body motion (tail beat, spine wave) is GPU-side via `applySwimShader`; the
 * CPU here owns only the path — the wandering, banked circuit each fish swims.
 */
export class Shoal {
  readonly mesh: THREE.InstancedMesh;
  private readonly slots: FishSlot[];
  private readonly swim: { uniforms: { uTime: { value: number } } };
  private readonly swimPhase: THREE.InstancedBufferAttribute;
  private next = 0;
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly euler = new THREE.Euler();
  private readonly quaternion = new THREE.Quaternion();
  private readonly highlightColor = new THREE.Color();

  constructor(scene: THREE.Scene, color: number, cap = DEFAULT_CAP) {
    const material = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.55,
      metalness: 0.15,
      side: THREE.DoubleSide, // the fins are single-sided blades
    });
    this.swim = applySwimShader(material, {
      instanced: true,
      amp: 0.1,
      freq: 6.5,
      waveLen: 3.2,
      nose: 0.6,
      span: 1.2,
    });
    this.mesh = new THREE.InstancedMesh(fishGeometry(), material, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // per-instance constant swim phase — a seeded value, not derived from the
    // moving instance translation, so the beat frequency stays true to `freq`
    this.swimPhase = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
    this.swimPhase.setUsage(THREE.DynamicDrawUsage);
    this.mesh.geometry.setAttribute("aSwimPhase", this.swimPhase);
    this.slots = Array.from({ length: cap }, () => ({
      meta: null,
      bornBlock: 0,
      bornAt: 0,
      seat: { radius: 0, angle: 0, bob: 0, speed: 0, wanderPhase: 0, wanderRate: 0.2 },
      size: 1,
      baseColor: WHITE.clone(),
    }));
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < cap; i++) {
      this.mesh.setMatrixAt(i, zero);
      this.mesh.setColorAt(i, WHITE);
    }
    // An InstancedMesh caches its bounding sphere on first raycast, which would
    // otherwise happen while every slot is still scale-0 and leave a radius-0
    // sphere that makes every later pick miss. Derived from the column so a
    // reshaped column cannot silently break picking.
    this.mesh.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(0, (TOP_BAND_Y + BED_Y) / 2, 0),
      (TOP_BAND_Y - BED_Y) / 2 + BAND_RADIUS_MAX + 8
    );
    this.mesh.count = 0;
    scene.add(this.mesh);
  }

  /**
   * @param member index within a CAT school (0 for a lone fish) — nudges the
   * circuit so schoolmates swim together without any neighbour queries.
   */
  plant(
    event: SproutEvent,
    bornBlock: number,
    size: number,
    color: THREE.Color | null,
    member = 0,
    bornAt = 0
  ): void {
    const i = this.next;
    this.next = (this.next + 1) % this.slots.length;
    if (i + 1 > this.mesh.count) this.mesh.count = i + 1;

    const seat = seatOffset(event.coinId);
    const slot = this.slots[i];
    slot.meta = event;
    slot.bornBlock = bornBlock;
    slot.bornAt = bornAt;
    slot.seat = {
      ...seat,
      radius: seat.radius + member * 0.4,
      angle: seat.angle + member * 0.07,
      bob: seat.bob + member * 0.5,
    };
    slot.size = size;
    slot.baseColor = color ? color.clone() : WHITE.clone();
    // always write: clears any leftover highlight from the recycled slot
    this.mesh.setColorAt(i, slot.baseColor);
    this.mesh.instanceColor!.addUpdateRange(i * 3, 3);
    this.mesh.instanceColor!.needsUpdate = true;
    // deterministic per-fish phase (already seeded from the coin id via seat.bob)
    this.swimPhase.setX(i, seat.bob + member);
    this.swimPhase.addUpdateRange(i, 1);
    this.swimPhase.needsUpdate = true;
  }

  update(t: number, blocksSeen: number): void {
    this.swim.uniforms.uTime.value = t;
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      if (!slot.meta) continue;
      const seat = slot.seat;
      const angle = wanderedAngle(seat, t);
      const radius = wanderedRadius(seat, t);
      const entryAge = t - slot.bornAt;
      const y =
        bandDepth(blocksSeen - slot.bornBlock) +
        Math.sin(t * 0.8 + seat.bob) * BOB_AMPLITUDE +
        entryDrop(entryAge);
      // Heading: the fish points +X; the circuit tangent at `angle` is
      // (-sin a, cos a) in XZ, and a Y-rotation by θ sends +X to (cos θ, -sin θ),
      // so θ = -(a + π/2) lines the nose up with the tangent.
      const heading = -(angle + Math.PI / 2);
      this.euler.set(0, heading, bankRoll(seat, t));
      this.quaternion.setFromEuler(this.euler);
      this.matrix.compose(
        this.position.set(Math.cos(angle) * radius, y, Math.sin(angle) * radius),
        this.quaternion,
        this.scale.setScalar(slot.size * entryScale(entryAge))
      );
      this.mesh.setMatrixAt(i, this.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Reorg cull: drop every fish from the orphaned blocks. */
  clearAbove(forkHeight: number): void {
    let highestActive = -1;
    let clearedAny = false;
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      if (slot.meta && slot.meta.height >= forkHeight) {
        slot.meta = null;
        this.matrix.makeScale(0, 0, 0);
        this.mesh.setMatrixAt(i, this.matrix);
        clearedAny = true;
      } else if (slot.meta) {
        highestActive = i;
      }
    }
    if (!clearedAny) return;
    // The GPU draws every instance below `count` regardless of whether its
    // matrix is degenerate — shrink so a mass cull stops paying for dead slots.
    this.mesh.count = Math.min(this.mesh.count, highestActive + 1);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  metaAt(index: number): SproutEvent | null {
    return this.slots[index]?.meta ?? null;
  }

  pickables(): THREE.Object3D[] {
    return this.mesh.count > 0 ? [this.mesh] : [];
  }

  metaFor(object: THREE.Object3D, instanceId: number | undefined): SproutEvent | null {
    if (object !== this.mesh || instanceId === undefined) return null;
    return this.metaAt(instanceId);
  }

  /** @returns true if this shoal owns the object (so callers can chain). */
  setHighlight(object: THREE.Object3D, index: number, on: boolean): boolean {
    if (object !== this.mesh) return false;
    const slot = this.slots[index];
    if (!slot?.meta) return false;
    const color = on
      ? this.highlightColor.copy(slot.baseColor).multiplyScalar(HIGHLIGHT_BOOST)
      : slot.baseColor;
    this.mesh.setColorAt(index, color);
    this.mesh.instanceColor!.addUpdateRange(index * 3, 3);
    this.mesh.instanceColor!.needsUpdate = true;
    return true;
  }
}
