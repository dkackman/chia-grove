import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { SproutEvent } from "@grove/shared";
import { mulberry32, type XZ } from "../shared/util.js";
import { easeOutCubic, InstancedKind, type Pose } from "../shared/instanced.js";
import { catWidth, xchHeight } from "../shared/scales.js";
import { catColor } from "../shared/cat-color.js";
import { COLORS } from "./palette.js";
import { glowTexture } from "../shared/textures.js";
import { sproutOffset } from "./layout.js";

// caps are per geometry variant (3 variants per kind)
const CAPS = { grass: 1600, mushroom: 300, bloom: 80, wisp: 160 } as const;
const VARIANTS = 3;

// nominal height multiplier per grass variant (broad blades stay low)
const GRASS_VARIANT_HEIGHT = [1, 0.85, 0.6] as const;

interface Wisp {
  sprite: THREE.Sprite;
  meta: SproutEvent | null;
  bornAt: number;
  phase: number;
  baseScale: number;
}

/** Glow levels for a bloom's halo: births hot, then cools toward `rest`. */
export const GLOW = {
  birth: 0.3,
  rest: 0.3,
  mintBirth: 0.85,
  /** mints stay brighter than ordinary blooms for good, so they read as mints */
  mintRest: 0.45,
  /** per second; ~16 s for a mint to cool from birth to rest */
  mintDecay: 0.025,
} as const;

/** Bloom geometry variant: the ringed variant (1) is reserved for mints. */
export function bloomVariant(mint: boolean | undefined, r: number): number {
  if (mint) return 1;
  return r < 0.5 ? 0 : 2;
}

/** Cool a glow level toward its resting level; never below it. */
export function coolGlow(base: number, rest: number, decay: number, dt: number): number {
  return base > rest ? Math.max(rest, base - dt * decay) : base;
}

interface BloomGlow {
  sprite: THREE.Sprite;
  /** current glow level (0 = unplanted / cleared) */
  base: number;
  /** settled level the glow cools toward */
  rest: number;
  /** per-instance phase so blooms breathe out of sync, not as one throb */
  phase: number;
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

export class FloraSystem {
  private readonly grass: InstancedKind[];
  private readonly mushroom: InstancedKind[];
  private readonly bloom: InstancedKind[];
  private readonly wisps: Wisp[];
  private readonly bloomGlows: BloomGlow[][];
  /**
   * Ground pools for every bloom glow, one instanced draw: slot
   * `variant * CAPS.bloom + index`. Additive, so the instance colour
   * (emissive x level) is the pool's opacity.
   */
  private readonly pools: THREE.InstancedMesh;
  private readonly kinds: InstancedKind[];
  private readonly poolColor = new THREE.Color(COLORS.bloomEmissive);
  private readonly matrix = new THREE.Matrix4();
  private nextWisp = 0;
  private gustUntil = 0;
  private readonly color = new THREE.Color();

  constructor(
    scene: THREE.Scene,
    private reducedMotion = false
  ) {
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
      // grey glow strength; multiplied by the per-instance color in the shader
      // below so each mushroom self-illuminates in its own CAT hue
      emissive: 0x4d4d4d,
      roughness: 0.6,
    });
    // The CAT hue lives in instanceColor (-> vColor). three.js already tints the
    // diffuse by it, but in the dark meadow only the emissive is really visible,
    // and a single global emissive flattens every mushroom to one colour. Route
    // vColor into the emissive too so the colony hues survive the night lighting.
    mushroomMaterial.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <emissivemap_fragment>",
        "#include <emissivemap_fragment>\n\ttotalEmissiveRadiance *= vColor.rgb;"
      );
    };
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

    this.kinds = [...this.grass, ...this.mushroom, ...this.bloom];

    const glowMap = glowTexture();
    this.pools = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({
        map: glowMap,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
      VARIANTS * CAPS.bloom
    );
    this.pools.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    const black = new THREE.Color(0);
    for (let i = 0; i < VARIANTS * CAPS.bloom; i++) {
      this.pools.setMatrixAt(i, zero);
      this.pools.setColorAt(i, black);
    }
    this.pools.instanceColor!.setUsage(THREE.DynamicDrawUsage);
    this.pools.frustumCulled = false;
    this.pools.raycast = () => {};
    scene.add(this.pools);

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
        // hidden until planted: an opacity-0 sprite still costs a draw call
        sprite.visible = false;
        scene.add(sprite);
        return { sprite, base: 0, rest: 0, phase: Math.random() * Math.PI * 2 };
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
      sprite.visible = false;
      scene.add(sprite);
      return { sprite, meta: null, bornAt: 0, phase: Math.random() * 10, baseScale: 0.9 };
    });
  }

  private allKinds(): InstancedKind[] {
    return this.kinds;
  }

  setReducedMotion(reduced: boolean): void {
    this.reducedMotion = reduced;
  }

  /** Reorg: remove every sprout from `height` up (0 = everything). */
  clearAbove(height: number): void {
    const doomed = (meta: SproutEvent) => meta.height >= height;
    this.bloom.forEach((kind, variant) => {
      kind.slots.forEach((slot, index) => {
        if (slot.meta && doomed(slot.meta)) this.hideGlow(variant, index);
      });
    });
    for (const kind of this.kinds) kind.clearWhere(doomed);
    for (const wisp of this.wisps) {
      if (wisp.meta && doomed(wisp.meta)) {
        if (this.hovered && "wisp" in this.hovered && this.hovered.wisp === wisp) {
          this.hovered = null;
        }
        wisp.meta = null;
        wisp.sprite.material.opacity = 0;
        wisp.sprite.visible = false;
      }
    }
    if (this.hovered && "kind" in this.hovered && !this.hovered.kind.metaAt(this.hovered.index)) {
      this.hovered = null;
    }
  }

  private hideGlow(variant: number, index: number): void {
    const glow = this.bloomGlows[variant][index];
    glow.base = 0;
    glow.rest = 0;
    glow.sprite.material.opacity = 0;
    glow.sprite.visible = false;
    const slot = variant * CAPS.bloom + index;
    this.pools.setMatrixAt(slot, this.matrix.makeScale(0, 0, 0));
    this.pools.setColorAt(slot, this.poolColor.setScalar(0));
    this.pools.instanceMatrix.needsUpdate = true;
    this.pools.instanceColor!.needsUpdate = true;
  }

  /** Live sprout counts per kind (tests / diagnostics). */
  activeCounts(): { grass: number; mushroom: number; bloom: number; wisp: number; glows: number } {
    const live = (kinds: InstancedKind[]) =>
      kinds.reduce((n, k) => n + k.slots.filter((s) => s.meta).length, 0);
    return {
      grass: live(this.grass),
      mushroom: live(this.mushroom),
      bloom: live(this.bloom),
      wisp: this.wisps.filter((w) => w.meta).length,
      glows: this.bloomGlows.flat().filter((g) => g.base > 0 && g.sprite.visible).length,
    };
  }

  plant(event: SproutEvent, blockPos: XZ, t: number): void {
    const offset = sproutOffset(event.coinId);
    const x = blockPos.x + offset.x;
    const z = blockPos.z + offset.z;

    // separate hash slice from sproutOffset's so pose doesn't correlate with
    // position within the cluster
    const rand = mulberry32(parseInt(event.coinId.slice(8, 16), 16));
    const variantRoll = rand();
    const variant = Math.floor(variantRoll * VARIANTS);
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
        this.color.setHSL(0.33 + jitter * 0.09, 0.45 + rand() * 0.25, 0.34 + rand() * 0.18);
        pose.color = this.color;
        pose.height =
          xchHeight(event.amount) * GRASS_VARIANT_HEIGHT[variant] * (0.85 + rand() * 0.35);
        this.grass[variant].plant(event, x, z, t, pose);
        break;
      }
      case "cat": {
        // hue keyed to the asset (colony identity); shade varies per coin
        const { h } = catColor(event.assetId ?? "0".repeat(64));
        this.color.setHSL(h, 0.58 + rand() * 0.25, 0.5 + rand() * 0.2);
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
        const bv = bloomVariant(event.mint, variantRoll);
        const index = this.bloom[bv].plant(event, x, z, t, pose);
        const glow = this.bloomGlows[bv][index];
        glow.sprite.position.set(x, 0.85 * pose.height, z);
        glow.base = event.mint ? GLOW.mintBirth : GLOW.birth;
        glow.rest = event.mint ? GLOW.mintRest : GLOW.rest;
        glow.sprite.material.opacity = glow.base;
        glow.sprite.scale.setScalar(event.mint ? 1.7 : 1.15);
        glow.sprite.visible = true;
        const poolScale = event.mint ? 2.6 : 1.8;
        this.matrix.makeScale(poolScale, 1, poolScale).setPosition(x, 0.05, z);
        this.pools.setMatrixAt(bv * CAPS.bloom + index, this.matrix);
        this.pools.instanceMatrix.needsUpdate = true;
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
        wisp.sprite.material.opacity = 0;
        wisp.sprite.visible = true;
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

    const breatheAmp = this.reducedMotion ? 0 : 0.16;
    let poolsDirty = false;
    this.bloomGlows.forEach((glows, variant) => {
      glows.forEach((g, index) => {
        if (g.base <= 0) return;
        // mint blooms cool slowly from their bright birth glow to a level that
        // stays above an ordinary bloom's, so mints remain recognizable
        g.base = coolGlow(g.base, g.rest, GLOW.mintDecay, dt);
        // gentle out-of-sync breathing on top of the settled level
        const breathe = 1 + breatheAmp * Math.sin(t * 0.7 + g.phase);
        g.sprite.material.opacity = g.base * breathe;
        // a fainter ground pool of the same light seats the bloom
        this.poolColor.setHex(COLORS.bloomEmissive).multiplyScalar(g.base * 0.5 * breathe);
        this.pools.setColorAt(variant * CAPS.bloom + index, this.poolColor);
        poolsDirty = true;
      });
    });
    if (poolsDirty) this.pools.instanceColor!.needsUpdate = true;
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
