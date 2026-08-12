import * as THREE from "three";
import type { BlockEvent } from "@grove/shared";
import { MAX_BANDS, RIM_RADIUS, bandDepth } from "./layout.js";
import { LAKE } from "./palette.js";

/**
 * Fee level (mojos) at which a ring is fully warm: ~0.01 XCH. Chia block fees
 * are typically well under 0.001 XCH, so saturating any higher would pin the
 * warmth channel at zero for nearly every block and waste the encoding —
 * this keeps realistically fee-heavy blocks in the visible part of the curve.
 */
const FEE_FULL = 1e10;
/** Spend count at which a ring is fully bright. */
const SPENDS_FULL = 120;
const RING_TUBE = 0.07;
/** How far down the column a ring has faded to nothing. */
const FADE_BANDS = MAX_BANDS;
/** Labels only on the newest few bands; the deep column stays quiet. */
const LABELLED_BANDS = 5;
const LABEL_RADIUS = RIM_RADIUS + 2.5;

export interface BandEntry {
  height: number;
  spendCount: number;
  fees: string;
  bornBlock: number;
}

/**
 * Spend count → ring brightness in 0..1. Square-rooted rather than linear so
 * the difference between a quiet block and an average one is visible; a linear
 * ramp buries everything below ~40 spends in the same dim band.
 */
export function ringBrightness(spendCount: number): number {
  const n = Number.isFinite(spendCount) ? Math.max(0, spendCount) : 0;
  return 0.25 + 0.75 * Math.sqrt(Math.min(1, n / SPENDS_FULL));
}

/** Block fees (mojos, as a string) → 0..1 warmth. Junk reads as zero. */
export function feeWarmth(fees: string): number {
  const mojos = Number(fees);
  if (!Number.isFinite(mojos) || mojos <= 0) return 0;
  return Math.min(1, Math.log10(1 + mojos) / Math.log10(1 + FEE_FULL));
}

/** Band age (in blocks) → label opacity. Pure. */
export function labelOpacity(age: number): number {
  if (age <= 0) return 1;
  if (age >= LABELLED_BANDS) return 0;
  return 1 - age / LABELLED_BANDS;
}

/**
 * A block height drawn to a canvas texture. Redrawn once per block — at 18.75 s
 * a block this is free. Returns null under Node (tests), where the sprite is
 * still created and positioned but carries no texture.
 */
function labelTexture(height: number): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.font = "600 34px ui-monospace, Menlo, monospace";
  ctx.fillStyle = "#a8e0f5";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(height), 128, 32);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * The visible strata. The original lake deliberately kept no per-band state —
 * depth was `bandDepth(blocksSeen - bornBlock)` and nothing else. That was
 * right while a band was invisible; now the band must *be* something, so this
 * class holds one entry per block. `bandDepth` is untouched and still drives
 * every position, including these rings — this is presentation state layered
 * on top of the subtraction, not a replacement for it.
 *
 * Rings are additively blended, so brightness rides entirely in the instance
 * color and a dark ring is simply invisible. That lets one material fade all
 * eighteen rings independently with no per-instance opacity.
 */
export class Bands {
  readonly mesh: THREE.InstancedMesh;
  private readonly entries: (BandEntry | null)[];
  private next = 0;
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly quaternion = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private readonly color = new THREE.Color();
  private readonly base = new THREE.Color(LAKE.rim);
  private readonly warm = new THREE.Color(LAKE.rimWarm);
  private readonly labels: THREE.Sprite[];

  constructor(scene: THREE.Scene, cap = MAX_BANDS) {
    const geometry = new THREE.TorusGeometry(RIM_RADIUS, RING_TUBE, 6, 120);
    geometry.rotateX(Math.PI / 2); // lie flat in the XZ plane
    const material = new THREE.MeshBasicMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false, // depth fade is explicit below; fog would double-dim it
    });
    this.mesh = new THREE.InstancedMesh(geometry, material, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.entries = Array.from({ length: cap }, () => null);
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < cap; i++) {
      this.mesh.setMatrixAt(i, zero);
      this.mesh.setColorAt(i, this.base);
    }
    this.mesh.count = 0;
    scene.add(this.mesh);
    this.labels = Array.from({ length: cap }, () => {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({ transparent: true, depthWrite: false, fog: false, opacity: 0 })
      );
      sprite.scale.set(7, 1.75, 1);
      sprite.visible = false;
      scene.add(sprite);
      return sprite;
    });
  }

  push(event: BlockEvent, bornBlock: number): void {
    const i = this.next;
    this.next = (this.next + 1) % this.entries.length;
    if (i + 1 > this.mesh.count) this.mesh.count = i + 1;
    this.entries[i] = {
      height: event.height,
      spendCount: event.spendCount,
      fees: event.fees,
      bornBlock,
    };
    const sprite = this.labels[i];
    const material = sprite.material as THREE.SpriteMaterial;
    material.map?.dispose(); // the recycled slot's texture is now unreachable
    material.map = labelTexture(event.height);
    material.needsUpdate = true;
    sprite.visible = true;
  }

  update(blocksSmooth: number, camera: THREE.Camera): void {
    for (let i = 0; i < this.entries.length; i++) {
      const entry = this.entries[i];
      if (!entry) continue;
      const age = blocksSmooth - entry.bornBlock;
      this.position.set(0, bandDepth(age), 0);
      // vertical scale thickens the tube for a busy block without moving the
      // ring's radius, which a uniform scale would
      const brightness = ringBrightness(entry.spendCount);
      this.scale.set(1, 1 + brightness * 2.5, 1);
      this.matrix.compose(this.position, this.quaternion, this.scale);
      this.mesh.setMatrixAt(i, this.matrix);

      const fade = Math.max(0, 1 - Math.max(0, age) / FADE_BANDS);
      this.color.copy(this.base).lerp(this.warm, feeWarmth(entry.fees));
      this.color.multiplyScalar(brightness * fade * fade);
      this.mesh.setColorAt(i, this.color);

      const sprite = this.labels[i];
      const opacity = labelOpacity(age);
      sprite.visible = opacity > 0;
      if (sprite.visible) {
        // ride the near edge: the bearing of the camera, so an orbiting camera
        // always reads the label face-on rather than watching it swing behind
        const bearing = Math.atan2(camera.position.z, camera.position.x);
        sprite.position.set(
          Math.cos(bearing) * LABEL_RADIUS,
          bandDepth(age),
          Math.sin(bearing) * LABEL_RADIUS
        );
        (sprite.material as THREE.SpriteMaterial).opacity = opacity;
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** Reorg: drop the orphaned bands and shrink the draw count. */
  clearAbove(forkHeight: number): void {
    let highestActive = -1;
    let clearedAny = false;
    for (let i = 0; i < this.entries.length; i++) {
      const entry = this.entries[i];
      if (entry && entry.height >= forkHeight) {
        this.entries[i] = null;
        this.matrix.makeScale(0, 0, 0);
        this.mesh.setMatrixAt(i, this.matrix);
        this.labels[i].visible = false;
        clearedAny = true;
      } else if (entry) {
        highestActive = i;
      }
    }
    if (!clearedAny) return;
    this.mesh.count = Math.min(this.mesh.count, highestActive + 1);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  count(): number {
    return this.entries.reduce((n, e) => (e ? n + 1 : n), 0);
  }

  /** Test seam. */
  entryAt(i: number): BandEntry | null {
    return this.entries[i] ?? null;
  }

  /** Test seam. */
  ringColorAt(i: number): THREE.Color {
    const c = new THREE.Color();
    this.mesh.getColorAt(i, c);
    return c;
  }

  /** Test seam. */
  labelPosition(i: number): THREE.Vector3 {
    return this.labels[i].position;
  }

  /** Test seam. */
  labelVisible(i: number): boolean {
    return this.labels[i].visible;
  }
}
