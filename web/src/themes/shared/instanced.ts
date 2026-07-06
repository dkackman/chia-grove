import * as THREE from "three";
import type { SproutEvent } from "@grove/shared";

const GROW_SECONDS = 1.6;

const WHITE = new THREE.Color(0xffffff);
const HIGHLIGHT_BOOST = 2.2;

interface Slot {
  meta: SproutEvent | null;
  bornAt: number;
  x: number;
  z: number;
  y: number;
  height: number;
  width: number;
  baseColor: THREE.Color;
  rotation: THREE.Quaternion;
  swayPhase: number;
}

/** Per-instance pose, derived deterministically from the coin id. */
export interface Pose {
  height: number;
  width?: number;
  color?: THREE.Color;
  rotY: number;
  tiltX: number;
  tiltZ: number;
  swayPhase: number;
  /** vertical offset of the instance base; defaults to 0 (ground plane). */
  y?: number;
}

export const easeOutCubic = (p: number) => 1 - (1 - p) ** 3;

function makeSlots(cap: number): Slot[] {
  return Array.from({ length: cap }, () => ({
    meta: null,
    bornAt: 0,
    x: 0,
    z: 0,
    y: 0,
    height: 1,
    width: 1,
    baseColor: WHITE.clone(),
    rotation: new THREE.Quaternion(),
    swayPhase: 0,
  }));
}

export class InstancedKind {
  readonly mesh: THREE.InstancedMesh;
  readonly slots: Slot[];
  private next = 0;
  // Dirty-tracking so a settled, non-swaying mesh (terrain, CAT cubes) stops
  // re-uploading its instance matrices every frame. `matrixDirty` covers
  // structural changes (plant/clear); `settleAt` is the time the last grow
  // animation finishes; `lastGust` catches the gust→rest transition.
  private matrixDirty = true;
  private settleAt = 0;
  private lastGust = 1;
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly euler = new THREE.Euler();
  private readonly swayQuat = new THREE.Quaternion();
  private readonly worldQuat = new THREE.Quaternion();

  constructor(
    scene: THREE.Scene,
    geometry: THREE.BufferGeometry,
    material: THREE.Material | THREE.Material[],
    cap: number,
    private readonly swayAmp: number,
    boundsRadius = 80,
    boundsCenterY = 2
  ) {
    this.mesh = new THREE.InstancedMesh(geometry, material, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.slots = makeSlots(cap);
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < cap; i++) {
      this.mesh.setMatrixAt(i, zero);
      // initialize every instance color: setColorAt zero-fills the buffer on
      // first use, which would render untinted instances black
      this.mesh.setColorAt(i, WHITE);
    }
    // InstancedMesh caches its bounding sphere on the first raycast — which
    // happens while every instance is still scale-0, leaving a radius-0
    // sphere that makes every later raycast miss. Pin a fixed sphere that
    // covers the whole meadow instead (spiral max ~44 + cluster + height).
    this.mesh.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(0, boundsCenterY, 0),
      boundsRadius
    );
    scene.add(this.mesh);
    // Only draw instances that have actually been planted; grows toward `cap`
    // in plant(). Lets a theme allocate a big cap (e.g. persistent terrain)
    // without paying to render thousands of empty scale-0 slots every frame.
    this.mesh.count = 0;
  }

  plant(meta: SproutEvent, x: number, z: number, t: number, pose: Pose): number {
    const i = this.next;
    this.next = (this.next + 1) % this.slots.length;
    if (i + 1 > this.mesh.count) this.mesh.count = i + 1;
    this.matrixDirty = true;
    this.settleAt = Math.max(this.settleAt, t + GROW_SECONDS);
    const slot = this.slots[i];
    slot.meta = meta;
    slot.bornAt = t;
    slot.x = x;
    slot.z = z;
    slot.y = pose.y ?? 0;
    slot.height = pose.height;
    slot.width = pose.width ?? 1;
    slot.baseColor = pose.color ? pose.color.clone() : WHITE.clone();
    slot.rotation.setFromEuler(this.euler.set(pose.tiltX, pose.rotY, pose.tiltZ));
    slot.swayPhase = pose.swayPhase;
    // always write: clears any leftover highlight from the recycled slot
    this.mesh.setColorAt(i, slot.baseColor);
    this.mesh.instanceColor!.addUpdateRange(i * 3, 3);
    this.mesh.instanceColor!.needsUpdate = true;
    return i;
  }

  setHighlight(index: number, on: boolean): void {
    const slot = this.slots[index];
    if (!slot?.meta) return;
    const color = on
      ? this.highlightColor.copy(slot.baseColor).multiplyScalar(HIGHLIGHT_BOOST)
      : slot.baseColor;
    this.mesh.setColorAt(index, color);
    this.mesh.instanceColor!.addUpdateRange(index * 3, 3);
    this.mesh.instanceColor!.needsUpdate = true;
  }

  /** Release every active slot whose metadata matches — used by reorg culling. */
  clearWhere(predicate: (meta: SproutEvent) => boolean): void {
    let highestActive = -1;
    let clearedAny = false;
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      if (slot.meta && predicate(slot.meta)) {
        slot.meta = null;
        this.matrix.makeScale(0, 0, 0);
        this.mesh.setMatrixAt(i, this.matrix);
        this.mesh.instanceMatrix.addUpdateRange(i * 16, 16);
        clearedAny = true;
      } else if (slot.meta) {
        highestActive = i;
      }
    }
    if (!clearedAny) return;
    // The GPU draws every instance below `count` every frame regardless of
    // whether its matrix is degenerate — shrink to the highest still-active
    // slot so a mass clear (reorg) doesn't leave it drawing dead tail slots
    // forever.
    this.mesh.count = Math.min(this.mesh.count, highestActive + 1);
    this.matrixDirty = true;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  private readonly highlightColor = new THREE.Color();

  update(t: number, gustDip: number): void {
    // Skip the recompute + GPU upload when nothing can have moved: a
    // non-swaying mesh whose grow animations have all settled, with no gust
    // dipping it and no structural change since the last write. Swaying meshes
    // (grass) animate continuously and always fall through.
    const swaying = this.swayAmp !== 0;
    const growing = t < this.settleAt;
    const gusting = gustDip !== 1 || this.lastGust !== 1;
    if (!swaying && !growing && !gusting && !this.matrixDirty) return;
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      if (!slot.meta) continue;
      const progress = Math.min((t - slot.bornAt) / GROW_SECONDS, 1);
      const eased = easeOutCubic(progress);
      const width = Math.min(1, eased * 1.3) * slot.width;
      // wind: lean from the base. A wave travels diagonally across the
      // meadow (~21-unit wavelength, so several crests are visible at
      // once); the small swayPhase term keeps the front ragged without
      // destroying coherence. A second incommensurate harmonic breaks the
      // pendulum regularity, and a faster per-plant flutter (frequency
      // varied by swayPhase) desyncs neighbors. The 0.35 bias keeps plants
      // leaning slightly downwind rather than swinging symmetrically about
      // vertical. Gusts (gustDip < 1) deepen the lean and dip the height.
      const wavePhase = t * 1.2 + (slot.x + slot.z * 0.6) * 0.3 + slot.swayPhase * 0.15;
      const breeze =
        Math.sin(wavePhase) +
        0.35 * Math.sin(wavePhase * 1.7 + 1.3) +
        0.22 * Math.sin(t * (2.3 + slot.swayPhase * 0.12) + slot.swayPhase * 7);
      const lean = this.swayAmp * (1 + (1 - gustDip) * 6) * (0.35 + breeze * 0.55);
      this.swayQuat.setFromEuler(this.euler.set(lean * 0.4, 0, lean));
      this.worldQuat.multiplyQuaternions(this.swayQuat, slot.rotation);
      this.matrix.compose(
        this.position.set(slot.x, slot.y, slot.z),
        this.worldQuat,
        this.scale.set(width, eased * slot.height * gustDip, width)
      );
      this.mesh.setMatrixAt(i, this.matrix);
      this.mesh.instanceMatrix.addUpdateRange(i * 16, 16);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.matrixDirty = false;
    this.lastGust = gustDip;
  }

  metaAt(index: number): SproutEvent | null {
    return this.slots[index]?.meta ?? null;
  }
}
