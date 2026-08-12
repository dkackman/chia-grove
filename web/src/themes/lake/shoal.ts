import * as THREE from "three";
import type { SproutEvent } from "@grove/shared";
import { bandDepth, seatOffset } from "./layout.js";

const WHITE = new THREE.Color(0xffffff);
const HIGHLIGHT_BOOST = 2.2;
const DEFAULT_CAP = 1200;
const BOB_AMPLITUDE = 0.35;

/**
 * One fish, built by hand rather than composed from primitives: an InstancedMesh
 * takes a single geometry, so a fish has to be one BufferGeometry, and merging
 * cones would drag in BufferGeometryUtils for a shape this simple.
 *
 * Points along +X (its swimming direction), nose at +0.6, tail fin at -0.6.
 * Non-indexed and rendered DoubleSide, so winding order does not matter.
 */
export function fishGeometry(): THREE.BufferGeometry {
  const nose: [number, number, number] = [0.6, 0, 0];
  const top: [number, number, number] = [0.1, 0.18, 0];
  const bottom: [number, number, number] = [0.1, -0.18, 0];
  const left: [number, number, number] = [0.1, 0, 0.13];
  const right: [number, number, number] = [0.1, 0, -0.13];
  const tail: [number, number, number] = [-0.35, 0, 0];
  const finTop: [number, number, number] = [-0.62, 0.3, 0];
  const finBottom: [number, number, number] = [-0.62, -0.3, 0];

  const tris: Array<[number, number, number]> = [
    // nose cone
    nose,
    top,
    left,
    nose,
    left,
    bottom,
    nose,
    bottom,
    right,
    nose,
    right,
    top,
    // body tapering to the tail
    tail,
    left,
    top,
    tail,
    bottom,
    left,
    tail,
    right,
    bottom,
    tail,
    top,
    right,
    // tail fin
    tail,
    finTop,
    finBottom,
  ];

  const positions = new Float32Array(tris.length * 3);
  for (let i = 0; i < tris.length; i++) {
    positions[i * 3] = tris[i][0];
    positions[i * 3 + 1] = tris[i][1];
    positions[i * 3 + 2] = tris[i][2];
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  g.computeVertexNormals();
  return g;
}

interface FishSlot {
  meta: SproutEvent | null;
  bornBlock: number;
  radius: number;
  angle: number;
  speed: number;
  bob: number;
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
 */
export class Shoal {
  readonly mesh: THREE.InstancedMesh;
  private readonly slots: FishSlot[];
  private next = 0;
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly euler = new THREE.Euler();
  private readonly quaternion = new THREE.Quaternion();
  private readonly highlightColor = new THREE.Color();

  constructor(scene: THREE.Scene, color: number, cap = DEFAULT_CAP) {
    this.mesh = new THREE.InstancedMesh(
      fishGeometry(),
      new THREE.MeshStandardMaterial({
        color,
        roughness: 0.55,
        metalness: 0.15,
        flatShading: true,
        side: THREE.DoubleSide,
      }),
      cap
    );
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.slots = Array.from({ length: cap }, () => ({
      meta: null,
      bornBlock: 0,
      radius: 0,
      angle: 0,
      speed: 0,
      bob: 0,
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
    // sphere that makes every later pick miss.
    this.mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, -33, 0), 70);
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
    member = 0
  ): void {
    const i = this.next;
    this.next = (this.next + 1) % this.slots.length;
    if (i + 1 > this.mesh.count) this.mesh.count = i + 1;

    const seat = seatOffset(event.coinId);
    const slot = this.slots[i];
    slot.meta = event;
    slot.bornBlock = bornBlock;
    slot.radius = seat.radius + member * 0.4;
    slot.angle = seat.angle + member * 0.07;
    slot.speed = seat.speed;
    slot.bob = seat.bob + member * 0.5;
    slot.size = size;
    slot.baseColor = color ? color.clone() : WHITE.clone();
    // always write: clears any leftover highlight from the recycled slot
    this.mesh.setColorAt(i, slot.baseColor);
    this.mesh.instanceColor!.addUpdateRange(i * 3, 3);
    this.mesh.instanceColor!.needsUpdate = true;
  }

  update(t: number, blocksSeen: number): void {
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      if (!slot.meta) continue;
      const angle = slot.angle + t * slot.speed;
      const y =
        bandDepth(blocksSeen - slot.bornBlock) + Math.sin(t * 0.8 + slot.bob) * BOB_AMPLITUDE;
      // Heading: the fish points +X, and its velocity around the circuit is the
      // tangent (-sin a, cos a) in XZ. A Y-rotation by θ sends +X to
      // (cos θ, -sin θ), so θ = -(a + π/2) lines the nose up with the tangent.
      const heading = -(angle + Math.PI / 2);
      const wiggle = Math.sin(t * 5 + slot.bob) * 0.18;
      this.euler.set(0, heading, wiggle);
      this.quaternion.setFromEuler(this.euler);
      this.matrix.compose(
        this.position.set(Math.cos(angle) * slot.radius, y, Math.sin(angle) * slot.radius),
        this.quaternion,
        this.scale.setScalar(slot.size)
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
