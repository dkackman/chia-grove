import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { SproutEvent } from "@grove/shared";
import { sproutOffset, type XZ } from "./layout.js";
import { catHue, COLORS } from "./palette.js";
import { glowTexture } from "./textures.js";

const GROW_SECONDS = 1.6;
const CAPS = { grass: 2400, mushroom: 400, bloom: 120, wisp: 80 } as const;

const WHITE = new THREE.Color(0xffffff);
const HIGHLIGHT_BOOST = 2.2;

interface Slot {
  meta: SproutEvent | null;
  bornAt: number;
  x: number;
  z: number;
  height: number;
  baseColor: THREE.Color;
}

const easeOutCubic = (p: number) => 1 - (1 - p) ** 3;

function makeSlots(cap: number): Slot[] {
  return Array.from({ length: cap }, () => ({
    meta: null,
    bornAt: 0,
    x: 0,
    z: 0,
    height: 1,
    baseColor: WHITE.clone(),
  }));
}

class InstancedKind {
  readonly mesh: THREE.InstancedMesh;
  readonly slots: Slot[];
  private next = 0;
  private readonly matrix = new THREE.Matrix4();
  private readonly quaternion = new THREE.Quaternion();
  private readonly position = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();

  constructor(
    scene: THREE.Scene,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    cap: number
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
    scene.add(this.mesh);
  }

  plant(meta: SproutEvent, x: number, z: number, height: number, t: number,
        color?: THREE.Color): number {
    const i = this.next;
    this.next = (this.next + 1) % this.slots.length;
    this.slots[i] = {
      meta,
      bornAt: t,
      x,
      z,
      height,
      baseColor: color ? color.clone() : WHITE.clone(),
    };
    // always write: clears any leftover highlight from the recycled slot
    this.mesh.setColorAt(i, this.slots[i].baseColor);
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
    this.mesh.instanceColor!.needsUpdate = true;
  }

  private readonly highlightColor = new THREE.Color();

  update(t: number, gustDip: number): void {
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      if (!slot.meta) continue;
      const progress = Math.min((t - slot.bornAt) / GROW_SECONDS, 1);
      const eased = easeOutCubic(progress);
      const width = Math.min(1, eased * 1.3);
      this.matrix.compose(
        this.position.set(slot.x, 0, slot.z),
        this.quaternion,
        this.scale.set(width, eased * slot.height * gustDip, width)
      );
      this.mesh.setMatrixAt(i, this.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  metaAt(index: number): SproutEvent | null {
    return this.slots[index]?.meta ?? null;
  }
}

export function grassGeometry(): THREE.BufferGeometry {
  const cone = new THREE.ConeGeometry(0.07, 1, 5);
  cone.translate(0, 0.5, 0);
  return cone;
}

export function mushroomGeometry(): THREE.BufferGeometry {
  const stem = new THREE.CylinderGeometry(0.05, 0.08, 0.5, 6);
  stem.translate(0, 0.25, 0);
  const cap = new THREE.SphereGeometry(0.24, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  cap.translate(0, 0.5, 0);
  return mergeGeometries([stem, cap]);
}

export function bloomGeometry(): THREE.BufferGeometry {
  const core = new THREE.IcosahedronGeometry(0.18, 1); // non-indexed (polyhedron)
  core.translate(0, 0.85, 0);
  // toNonIndexed: mergeGeometries returns null when inputs mix indexed and
  // non-indexed geometries, and a null geometry crashes the render loop
  const stalk = new THREE.CylinderGeometry(0.025, 0.04, 0.7, 5).toNonIndexed();
  stalk.translate(0, 0.35, 0);
  return mergeGeometries([core, stalk]);
}

/** XCH amount (mojos, string) → grass height. log scale, dust→blade, whale→stalk. */
function xchHeight(amount: string): number {
  const mojos = Number(amount);
  return Math.min(3.2, 0.4 + 0.55 * Math.log10(1 + mojos / 1e9));
}

export class FloraSystem {
  private readonly grass: InstancedKind;
  private readonly mushroom: InstancedKind;
  private readonly bloom: InstancedKind;
  private readonly wisps: Array<{
    sprite: THREE.Sprite;
    meta: SproutEvent | null;
    bornAt: number;
    phase: number;
  }>;
  private readonly bloomGlows: THREE.Sprite[];
  private nextWisp = 0;
  private gustUntil = 0;
  private readonly color = new THREE.Color();

  constructor(scene: THREE.Scene) {
    this.grass = new InstancedKind(
      scene,
      grassGeometry(),
      new THREE.MeshStandardMaterial({
        color: COLORS.grass,
        emissive: COLORS.grassEmissive,
        roughness: 0.8,
      }),
      CAPS.grass
    );
    this.mushroom = new InstancedKind(
      scene,
      mushroomGeometry(),
      new THREE.MeshStandardMaterial({
        color: 0xffffff, // tinted per-instance from assetId
        emissive: 0x10101a,
        roughness: 0.6,
      }),
      CAPS.mushroom
    );
    this.bloom = new InstancedKind(
      scene,
      bloomGeometry(),
      new THREE.MeshStandardMaterial({
        color: COLORS.bloom,
        emissive: COLORS.bloomEmissive,
        emissiveIntensity: 1.3,
        roughness: 0.4,
      }),
      CAPS.bloom
    );

    const glowMap = glowTexture();
    this.bloomGlows = Array.from({ length: CAPS.bloom }, () => {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: glowMap,
          color: COLORS.bloomEmissive,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        })
      );
      scene.add(sprite);
      return sprite;
    });

    this.wisps = Array.from({ length: CAPS.wisp }, () => {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: glowMap,
          color: COLORS.wisp,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        })
      );
      sprite.scale.setScalar(0.9);
      scene.add(sprite);
      return { sprite, meta: null, bornAt: 0, phase: Math.random() * 10 };
    });
  }

  plant(event: SproutEvent, blockPos: XZ, t: number): void {
    const offset = sproutOffset(event.coinId);
    const x = blockPos.x + offset.x;
    const z = blockPos.z + offset.z;

    switch (event.kind) {
      case "xch": {
        // subtle per-blade hue/lightness jitter, seeded by coin id
        const jitter = (parseInt(event.coinId.slice(8, 12), 16) % 100) / 100;
        this.color.setHSL(0.36 + jitter * 0.05, 0.55, 0.3 + jitter * 0.12);
        this.grass.plant(event, x, z, xchHeight(event.amount), t, this.color);
        break;
      }
      case "cat": {
        this.color.setHSL(catHue(event.assetId ?? "0".repeat(64)) / 360, 0.6, 0.55);
        this.mushroom.plant(event, x, z, 1, t, this.color);
        break;
      }
      case "nft": {
        const index = this.bloom.plant(event, x, z, event.mint ? 1.35 : 1, t);
        const glow = this.bloomGlows[index];
        glow.position.set(x, 0.85, z);
        glow.material.opacity = event.mint ? 0.9 : 0.55;
        glow.scale.setScalar(event.mint ? 2.6 : 1.7);
        break;
      }
      case "did": {
        const wisp = this.wisps[this.nextWisp];
        this.nextWisp = (this.nextWisp + 1) % CAPS.wisp;
        wisp.meta = event;
        wisp.bornAt = t;
        wisp.sprite.position.set(x, 0, z);
        break;
      }
    }
  }

  gust(t: number): void {
    this.gustUntil = t + 2;
  }

  update(t: number, dt: number): void {
    const remaining = Math.max(0, this.gustUntil - t);
    const gustDip =
      remaining > 0
        ? 1 - 0.18 * Math.min(1, remaining / 2) * Math.abs(Math.sin(remaining * 6))
        : 1;
    this.grass.update(t, gustDip);
    this.mushroom.update(t, gustDip);
    this.bloom.update(t, gustDip);

    for (const glow of this.bloomGlows) {
      if (glow.material.opacity > 0.55) {
        glow.material.opacity = Math.max(0.55, glow.material.opacity - dt * 0.12);
      }
    }
    for (const wisp of this.wisps) {
      if (!wisp.meta) continue;
      const progress = Math.min((t - wisp.bornAt) / 2, 1);
      wisp.sprite.material.opacity = easeOutCubic(progress) * 0.85;
      wisp.sprite.position.y =
        easeOutCubic(progress) * 1.4 + Math.sin(t * 1.3 + wisp.phase) * 0.25;
    }
  }

  /** Objects the picker may raycast, with metadata lookup. */
  pickables(): THREE.Object3D[] {
    return [
      this.grass.mesh,
      this.mushroom.mesh,
      this.bloom.mesh,
      ...this.wisps.filter((w) => w.meta).map((w) => w.sprite),
    ];
  }

  metaFor(object: THREE.Object3D, instanceId: number | undefined): SproutEvent | null {
    if (object === this.grass.mesh) return this.grass.metaAt(instanceId ?? -1);
    if (object === this.mushroom.mesh) return this.mushroom.metaAt(instanceId ?? -1);
    if (object === this.bloom.mesh) return this.bloom.metaAt(instanceId ?? -1);
    const wisp = this.wisps.find((w) => w.sprite === object);
    return wisp?.meta ?? null;
  }

  private hovered:
    | { kind: InstancedKind; index: number }
    | { wisp: THREE.Sprite }
    | null = null;

  /** Brighten the plant under the pointer; pass null to clear. */
  setHovered(
    object: THREE.Object3D | null,
    instanceId: number | undefined
  ): void {
    if (this.hovered) {
      if ("kind" in this.hovered) {
        this.hovered.kind.setHighlight(this.hovered.index, false);
      } else {
        this.hovered.wisp.scale.setScalar(0.9);
      }
      this.hovered = null;
    }
    if (!object) return;

    const kind =
      object === this.grass.mesh
        ? this.grass
        : object === this.mushroom.mesh
          ? this.mushroom
          : object === this.bloom.mesh
            ? this.bloom
            : null;
    if (kind && instanceId !== undefined) {
      kind.setHighlight(instanceId, true);
      this.hovered = { kind, index: instanceId };
      return;
    }
    const wisp = this.wisps.find((w) => w.sprite === object);
    if (wisp?.meta) {
      wisp.sprite.scale.setScalar(1.25);
      this.hovered = { wisp: wisp.sprite };
    }
  }
}
