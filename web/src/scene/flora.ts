import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { SproutEvent } from "@grove/shared";
import { mulberry32, sproutOffset, type XZ } from "./layout.js";
import { catColor, COLORS } from "./palette.js";
import { glowTexture } from "./textures.js";

const GROW_SECONDS = 1.6;
// caps are per geometry variant (3 variants per kind)
const CAPS = { grass: 800, mushroom: 140, bloom: 40, wisp: 80 } as const;
const VARIANTS = 3;

const WHITE = new THREE.Color(0xffffff);
const HIGHLIGHT_BOOST = 2.2;

interface Slot {
  meta: SproutEvent | null;
  bornAt: number;
  x: number;
  z: number;
  height: number;
  width: number;
  baseColor: THREE.Color;
  rotation: THREE.Quaternion;
  swayPhase: number;
}

/** Per-instance pose, derived deterministically from the coin id. */
interface Pose {
  height: number;
  width?: number;
  color?: THREE.Color;
  rotY: number;
  tiltX: number;
  tiltZ: number;
  swayPhase: number;
}

const easeOutCubic = (p: number) => 1 - (1 - p) ** 3;

function makeSlots(cap: number): Slot[] {
  return Array.from({ length: cap }, () => ({
    meta: null,
    bornAt: 0,
    x: 0,
    z: 0,
    height: 1,
    width: 1,
    baseColor: WHITE.clone(),
    rotation: new THREE.Quaternion(),
    swayPhase: 0,
  }));
}

class InstancedKind {
  readonly mesh: THREE.InstancedMesh;
  readonly slots: Slot[];
  private next = 0;
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly euler = new THREE.Euler();
  private readonly swayQuat = new THREE.Quaternion();
  private readonly worldQuat = new THREE.Quaternion();

  constructor(
    scene: THREE.Scene,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    cap: number,
    private readonly swayAmp: number
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
    this.mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 2, 0), 80);
    scene.add(this.mesh);
  }

  plant(meta: SproutEvent, x: number, z: number, t: number, pose: Pose): number {
    const i = this.next;
    this.next = (this.next + 1) % this.slots.length;
    const slot = this.slots[i];
    slot.meta = meta;
    slot.bornAt = t;
    slot.x = x;
    slot.z = z;
    slot.height = pose.height;
    slot.width = pose.width ?? 1;
    slot.baseColor = pose.color ? pose.color.clone() : WHITE.clone();
    slot.rotation.setFromEuler(this.euler.set(pose.tiltX, pose.rotY, pose.tiltZ));
    slot.swayPhase = pose.swayPhase;
    // always write: clears any leftover highlight from the recycled slot
    this.mesh.setColorAt(i, slot.baseColor);
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
        this.position.set(slot.x, 0, slot.z),
        this.worldQuat,
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

/** Tilt a grown-from-base geometry outward without lifting it off the ground. */
function lean(geometry: THREE.BufferGeometry, angleZ: number, shiftX = 0): THREE.BufferGeometry {
  geometry.rotateZ(angleZ);
  geometry.translate(shiftX, 0, 0);
  return geometry;
}

export function grassGeometries(): THREE.BufferGeometry[] {
  // single tall blade, slightly leaning
  const blade = new THREE.ConeGeometry(0.055, 1, 5);
  blade.translate(0, 0.5, 0);
  lean(blade, 0.08);

  // tuft of three blades splayed from a shared base
  const mid = new THREE.ConeGeometry(0.06, 1, 5);
  mid.translate(0, 0.5, 0);
  const left = new THREE.ConeGeometry(0.05, 0.8, 5);
  left.translate(0, 0.4, 0);
  lean(left, 0.32, -0.04);
  const right = new THREE.ConeGeometry(0.05, 0.7, 5);
  right.translate(0, 0.35, 0);
  lean(right, -0.38, 0.04);
  const tuft = mergeGeometries([mid, left, right]);

  // broad squat blade
  const broad = new THREE.ConeGeometry(0.11, 1, 4);
  broad.translate(0, 0.5, 0);

  return [blade, tuft, broad];
}

export function mushroomGeometries(): THREE.BufferGeometry[] {
  // classic toadstool
  const stem1 = new THREE.CylinderGeometry(0.05, 0.08, 0.5, 6);
  stem1.translate(0, 0.25, 0);
  const cap1 = new THREE.SphereGeometry(0.24, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  cap1.translate(0, 0.5, 0);

  // tall slender, small cap
  const stem2 = new THREE.CylinderGeometry(0.035, 0.06, 0.78, 6);
  stem2.translate(0, 0.39, 0);
  const cap2 = new THREE.SphereGeometry(0.14, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2);
  cap2.translate(0, 0.78, 0);

  // squat button with a wide flattened cap
  const stem3 = new THREE.CylinderGeometry(0.07, 0.1, 0.26, 6);
  stem3.translate(0, 0.13, 0);
  const cap3 = new THREE.SphereGeometry(0.3, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  cap3.scale(1, 0.55, 1);
  cap3.translate(0, 0.26, 0);

  return [
    mergeGeometries([stem1, cap1]),
    mergeGeometries([stem2, cap2]),
    mergeGeometries([stem3, cap3]),
  ];
}

export function bloomGeometries(): THREE.BufferGeometry[] {
  // toNonIndexed: mergeGeometries returns null when inputs mix indexed and
  // non-indexed geometries (icosahedra are non-indexed), and a null geometry
  // crashes the render loop
  const stalk = () => {
    const s = new THREE.CylinderGeometry(0.025, 0.04, 0.7, 5).toNonIndexed();
    s.translate(0, 0.35, 0);
    return s;
  };

  // single orb on a stalk
  const core1 = new THREE.IcosahedronGeometry(0.18, 1);
  core1.translate(0, 0.85, 0);
  const orb = mergeGeometries([core1, stalk()]);

  // orb with a flat petal halo
  const core2 = new THREE.IcosahedronGeometry(0.15, 1);
  core2.translate(0, 0.85, 0);
  const halo = new THREE.TorusGeometry(0.27, 0.035, 6, 16).toNonIndexed();
  halo.rotateX(Math.PI / 2);
  halo.translate(0, 0.85, 0);
  const ringed = mergeGeometries([core2, halo, stalk()]);

  // twin orbs at staggered heights
  const small = new THREE.IcosahedronGeometry(0.11, 1);
  small.translate(0.13, 0.62, 0);
  const big = new THREE.IcosahedronGeometry(0.16, 1);
  big.translate(-0.07, 0.92, 0);
  const tallStalk = new THREE.CylinderGeometry(0.025, 0.04, 0.78, 5).toNonIndexed();
  tallStalk.translate(-0.02, 0.39, 0);
  const twin = mergeGeometries([small, big, tallStalk]);

  return [orb, ringed, twin];
}

/** XCH amount (mojos, string) → grass height. log scale, dust→blade, whale→stalk. */
function xchHeight(amount: string): number {
  const mojos = Number(amount);
  return Math.min(3.2, 0.4 + 0.55 * Math.log10(1 + mojos / 1e9));
}

/**
 * CAT amount (mojos, string) → mushroom cap width. CATs carry 3 decimals
 * (1 token = 1000 mojos); per-token value varies wildly across assets, so
 * this only conveys relative magnitude within a colony. log scale and
 * sublinear, dust→slim, whale→chunky toadstool.
 */
function catWidth(amount: string): number {
  const tokens = Number(amount) / 1000;
  return 0.75 + 0.25 * Math.min(2.2, 0.5 + 0.3 * Math.log10(1 + tokens));
}

// nominal height multiplier per grass variant (broad blades stay low)
const GRASS_VARIANT_HEIGHT = [1, 0.85, 0.6] as const;

interface Wisp {
  sprite: THREE.Sprite;
  meta: SproutEvent | null;
  bornAt: number;
  phase: number;
  baseScale: number;
}

export class FloraSystem {
  private readonly grass: InstancedKind[];
  private readonly mushroom: InstancedKind[];
  private readonly bloom: InstancedKind[];
  private readonly wisps: Wisp[];
  private readonly bloomGlows: THREE.Sprite[][];
  private nextWisp = 0;
  private gustUntil = 0;
  private readonly color = new THREE.Color();

  constructor(scene: THREE.Scene) {
    const grassMaterial = new THREE.MeshStandardMaterial({
      color: COLORS.grass,
      emissive: COLORS.grassEmissive,
      roughness: 0.8,
    });
    this.grass = grassGeometries().map(
      (geometry) => new InstancedKind(scene, geometry, grassMaterial, CAPS.grass, 0.09)
    );

    const mushroomMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff, // tinted per-instance from assetId
      emissive: 0x10101a,
      roughness: 0.6,
    });
    this.mushroom = mushroomGeometries().map(
      (geometry) => new InstancedKind(scene, geometry, mushroomMaterial, CAPS.mushroom, 0.022)
    );

    const bloomMaterial = new THREE.MeshStandardMaterial({
      color: COLORS.bloom,
      emissive: COLORS.bloomEmissive,
      emissiveIntensity: 1.3,
      roughness: 0.4,
    });
    this.bloom = bloomGeometries().map(
      (geometry) => new InstancedKind(scene, geometry, bloomMaterial, CAPS.bloom, 0.04)
    );

    const glowMap = glowTexture();
    this.bloomGlows = this.bloom.map(() =>
      Array.from({ length: CAPS.bloom }, () => {
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
      })
    );

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
      return { sprite, meta: null, bornAt: 0, phase: Math.random() * 10, baseScale: 0.9 };
    });
  }

  private allKinds(): InstancedKind[] {
    return [...this.grass, ...this.mushroom, ...this.bloom];
  }

  plant(event: SproutEvent, blockPos: XZ, t: number): void {
    const offset = sproutOffset(event.coinId);
    const x = blockPos.x + offset.x;
    const z = blockPos.z + offset.z;

    // separate hash slice from sproutOffset's so pose doesn't correlate with
    // position within the cluster
    const rand = mulberry32(parseInt(event.coinId.slice(8, 16), 16));
    const variant = Math.floor(rand() * VARIANTS);
    const pose: Pose = {
      height: 1,
      rotY: rand() * Math.PI * 2,
      tiltX: (rand() - 0.5) * 0.2,
      tiltZ: (rand() - 0.5) * 0.2,
      swayPhase: rand() * Math.PI * 2,
    };

    switch (event.kind) {
      case "xch": {
        const jitter = rand();
        this.color.setHSL(0.33 + jitter * 0.09, 0.45 + rand() * 0.25, 0.26 + rand() * 0.16);
        pose.color = this.color;
        pose.height =
          xchHeight(event.amount) * GRASS_VARIANT_HEIGHT[variant] * (0.85 + rand() * 0.35);
        this.grass[variant].plant(event, x, z, t, pose);
        break;
      }
      case "cat": {
        // hue keyed to the asset (colony identity); shade varies per coin
        const { h } = catColor(event.assetId ?? "0".repeat(64));
        this.color.setHSL(h, 0.58 + rand() * 0.25, 0.42 + rand() * 0.18);
        pose.color = this.color;
        pose.height = 0.8 + rand() * 0.5;
        pose.width = catWidth(event.amount);
        pose.tiltX *= 0.6;
        pose.tiltZ *= 0.6;
        this.mushroom[variant].plant(event, x, z, t, pose);
        break;
      }
      case "nft": {
        // slight warm tint variation so blooms aren't all the same amber
        this.color.setHSL(0.07 + rand() * 0.07, 0.5, 0.78 + rand() * 0.1);
        pose.color = this.color;
        pose.height = (event.mint ? 1.35 : 1) * (0.9 + rand() * 0.3);
        const index = this.bloom[variant].plant(event, x, z, t, pose);
        const glow = this.bloomGlows[variant][index];
        glow.position.set(x, 0.85 * pose.height, z);
        glow.material.opacity = event.mint ? 0.9 : 0.55;
        glow.scale.setScalar(event.mint ? 2.6 : 1.7);
        break;
      }
      case "did": {
        const wisp = this.wisps[this.nextWisp];
        this.nextWisp = (this.nextWisp + 1) % CAPS.wisp;
        wisp.meta = event;
        wisp.bornAt = t;
        wisp.baseScale = 0.65 + rand() * 0.5;
        wisp.sprite.scale.setScalar(wisp.baseScale);
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
      remaining > 0 ? 1 - 0.18 * Math.min(1, remaining / 2) * Math.abs(Math.sin(remaining * 6)) : 1;
    for (const kind of this.allKinds()) {
      kind.update(t, gustDip);
    }

    for (const glows of this.bloomGlows) {
      for (const glow of glows) {
        if (glow.material.opacity > 0.55) {
          glow.material.opacity = Math.max(0.55, glow.material.opacity - dt * 0.12);
        }
      }
    }
    for (const wisp of this.wisps) {
      if (!wisp.meta) continue;
      const progress = Math.min((t - wisp.bornAt) / 2, 1);
      wisp.sprite.material.opacity = easeOutCubic(progress) * 0.85;
      wisp.sprite.position.y = easeOutCubic(progress) * 1.4 + Math.sin(t * 1.3 + wisp.phase) * 0.25;
    }
  }

  /** Objects the picker may raycast, with metadata lookup. */
  pickables(): THREE.Object3D[] {
    return [
      ...this.allKinds().map((kind) => kind.mesh),
      ...this.wisps.filter((w) => w.meta).map((w) => w.sprite),
    ];
  }

  metaFor(object: THREE.Object3D, instanceId: number | undefined): SproutEvent | null {
    const kind = this.allKinds().find((k) => k.mesh === object);
    if (kind) return kind.metaAt(instanceId ?? -1);
    const wisp = this.wisps.find((w) => w.sprite === object);
    return wisp?.meta ?? null;
  }

  private hovered: { kind: InstancedKind; index: number } | { wisp: Wisp } | null = null;

  /** Brighten the plant under the pointer; pass null to clear. */
  setHovered(object: THREE.Object3D | null, instanceId: number | undefined): void {
    if (this.hovered) {
      if ("kind" in this.hovered) {
        this.hovered.kind.setHighlight(this.hovered.index, false);
      } else {
        this.hovered.wisp.sprite.scale.setScalar(this.hovered.wisp.baseScale);
      }
      this.hovered = null;
    }
    if (!object) return;

    const kind = this.allKinds().find((k) => k.mesh === object) ?? null;
    if (kind && instanceId !== undefined) {
      kind.setHighlight(instanceId, true);
      this.hovered = { kind, index: instanceId };
      return;
    }
    const wisp = this.wisps.find((w) => w.sprite === object);
    if (wisp?.meta) {
      wisp.sprite.scale.setScalar(wisp.baseScale * 1.35);
      this.hovered = { wisp };
    }
  }
}
