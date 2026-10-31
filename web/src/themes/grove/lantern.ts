import * as THREE from "three";
import { glowTexture } from "../shared/textures.js";
import { type XZ } from "../shared/util.js";
import { COLORS } from "./palette.js";

/** Lantern glow right after a block, and the floor it settles to. */
export const LANTERN_FRESH = 0.6;
export const LANTERN_FLOOR = 0.1;
/** e-folding time of the fade (mean tx-block interval is ~52 s). */
const LANTERN_TAU = 45;

/**
 * Lantern brightness by seconds since the newest block: bright on arrival,
 * fading as the quiet stretches on — a long dim lantern means a long wait.
 */
export function lanternLevel(ageSeconds: number): number {
  const age = Math.max(0, ageSeconds);
  return LANTERN_FLOOR + (LANTERN_FRESH - LANTERN_FLOOR) * Math.exp(-age / LANTERN_TAU);
}

/**
 * A soft persistent glow hovering over the newest block's cluster, so "which
 * block is newest" reads at a glance even between ripples. Two additive draws:
 * a hovering halo and a pool of light on the ground beneath it.
 */
export class Lantern {
  private readonly halo: THREE.Sprite;
  private readonly pool: THREE.Mesh;
  /** unix seconds of the newest block (NaN before the first) */
  private blockAt = NaN;
  private reducedMotion = false;

  constructor(scene: THREE.Scene) {
    const map = glowTexture();
    this.halo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map,
        color: COLORS.lantern,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    this.halo.scale.setScalar(3.2);
    this.halo.visible = false;
    this.halo.raycast = () => {};
    scene.add(this.halo);

    this.pool = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({
        map,
        color: COLORS.lantern,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    this.pool.scale.set(6, 1, 6);
    this.pool.visible = false;
    this.pool.raycast = () => {};
    scene.add(this.pool);
  }

  setReducedMotion(reduced: boolean): void {
    this.reducedMotion = reduced;
  }

  /** Move to the newest block; `timestamp` (unix s) drives the fade. */
  moveTo(pos: XZ, timestamp: number): void {
    this.blockAt = Number.isFinite(timestamp) && timestamp > 0 ? timestamp : Date.now() / 1000;
    this.halo.position.set(pos.x, 2.4, pos.z);
    this.pool.position.set(pos.x, 0.06, pos.z);
    this.halo.visible = this.pool.visible = true;
  }

  /** No blocks left (reorg removed everything). */
  hide(): void {
    this.blockAt = NaN;
    this.halo.visible = this.pool.visible = false;
  }

  update(t: number, nowSec: number): void {
    if (Number.isNaN(this.blockAt)) return;
    const level = lanternLevel(nowSec - this.blockAt);
    const breathe = this.reducedMotion ? 1 : 1 + 0.08 * Math.sin(t * 1.1);
    this.halo.material.opacity = level * breathe;
    (this.pool.material as THREE.MeshBasicMaterial).opacity = level * 0.45 * breathe;
    if (!this.reducedMotion) this.halo.position.y = 2.4 + Math.sin(t * 0.6) * 0.12;
  }
}
