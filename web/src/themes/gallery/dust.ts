import * as THREE from "three";
import type { SproutEvent } from "@grove/shared";
import { catColor } from "../shared/cat-color.js";
import { WALL } from "./layout.js";

/** Filler colour for a non-NFT spend: cool for XCH, asset-hued for CAT, violet for DID. */
export function dustColor(event: SproutEvent): THREE.Color {
  if (event.kind === "cat" && event.assetId) {
    const { h, s, l } = catColor(event.assetId);
    return new THREE.Color().setHSL(h, s, Math.min(0.72, l + 0.12));
  }
  if (event.kind === "did") return new THREE.Color(0xc9a8ff); // soft violet accent
  return new THREE.Color(0x9fc4ff); // XCH + fallback: cool moonlight
}

const SPAWN_SPREAD = 16; // horizontal scatter around the viewed x
const RISE_MIN = 0.5;
const RISE_VAR = 0.5;
const LIFE_MIN = 5;
const LIFE_VAR = 4;

/**
 * Ambient "spend dust": each non-NFT spend emits a faint speck that drifts up
 * through the dark and fades — atmosphere that fills the gallery without ever
 * competing with the spotlit frames. A fixed pool; new specks overwrite oldest.
 */
export class SpendDust {
  private positions: Float32Array;
  private colors: Float32Array;
  private base: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private head = 0;
  private geom: THREE.BufferGeometry;
  private material: THREE.PointsMaterial;
  private targetOpacity = 0.5;

  constructor(
    scene: THREE.Scene,
    glow: THREE.Texture,
    private cap = 220
  ) {
    this.positions = new Float32Array(cap * 3);
    this.colors = new Float32Array(cap * 3);
    this.base = new Float32Array(cap * 3);
    this.vel = new Float32Array(cap * 3);
    this.life = new Float32Array(cap).fill(Infinity); // Infinity = inactive slot
    this.maxLife = new Float32Array(cap).fill(1);

    this.geom = new THREE.BufferGeometry();
    this.geom.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    this.geom.setAttribute("color", new THREE.BufferAttribute(this.colors, 3));
    this.material = new THREE.PointsMaterial({
      size: 0.16,
      map: glow,
      vertexColors: true,
      transparent: true,
      opacity: this.targetOpacity,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    const points = new THREE.Points(this.geom, this.material);
    points.frustumCulled = false;
    scene.add(points);
  }

  /** Spawn one speck for a spend, scattered around `atX` near the floor. */
  emit(event: SproutEvent, atX: number): void {
    const i = this.head;
    this.head = (this.head + 1) % this.cap;
    const c = dustColor(event);
    this.base[i * 3] = c.r;
    this.base[i * 3 + 1] = c.g;
    this.base[i * 3 + 2] = c.b;
    this.positions[i * 3] = atX + (Math.random() - 0.5) * SPAWN_SPREAD;
    this.positions[i * 3 + 1] = 0.2 + Math.random() * 0.6;
    this.positions[i * 3 + 2] = WALL.z + 1.5 + Math.random() * 4;
    this.vel[i * 3] = (Math.random() - 0.5) * 0.2;
    this.vel[i * 3 + 1] = RISE_MIN + Math.random() * RISE_VAR;
    this.vel[i * 3 + 2] = (Math.random() - 0.5) * 0.2;
    this.life[i] = 0;
    this.maxLife[i] = LIFE_MIN + Math.random() * LIFE_VAR;
  }

  /** Dim the dust while a piece is focused so it never competes with the art. */
  setFocused(focused: boolean): void {
    this.targetOpacity = focused ? 0.12 : 0.5;
  }

  activeCount(): number {
    let n = 0;
    for (let i = 0; i < this.cap; i++) if (this.life[i] !== Infinity) n++;
    return n;
  }

  update(dt: number): void {
    this.material.opacity += (this.targetOpacity - this.material.opacity) * Math.min(dt * 2, 1);
    for (let i = 0; i < this.cap; i++) {
      const l = this.life[i];
      if (l === Infinity) continue;
      const nl = l + dt;
      if (nl >= this.maxLife[i]) {
        this.life[i] = Infinity;
        this.colors[i * 3] = this.colors[i * 3 + 1] = this.colors[i * 3 + 2] = 0;
        continue;
      }
      this.life[i] = nl;
      this.positions[i * 3] += this.vel[i * 3] * dt;
      this.positions[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.positions[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const fade = Math.sin(Math.PI * (nl / this.maxLife[i])); // 0 → 1 → 0
      this.colors[i * 3] = this.base[i * 3] * fade;
      this.colors[i * 3 + 1] = this.base[i * 3 + 1] * fade;
      this.colors[i * 3 + 2] = this.base[i * 3 + 2] * fade;
    }
    this.geom.attributes.position.needsUpdate = true;
    this.geom.attributes.color.needsUpdate = true;
  }
}
