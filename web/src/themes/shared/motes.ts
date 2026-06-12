import * as THREE from "three";
import { glowTexture } from "./textures.js";

export interface MotesOptions {
  count: number;
  color: number;
  size: number;
  opacity: number;
  /** half-extent of the square drift region on x and z */
  radius: number;
  /** centre of the drift region (defaults to the origin) */
  centerX?: number;
  centerZ?: number;
  /** vertical band the motes occupy */
  minY: number;
  maxY: number;
  /** horizontal wind direction; need not be normalised */
  windX: number;
  windZ: number;
  /** mean horizontal wind speed (world units / second) */
  windSpeed: number;
  /** how much travelling gusts swell the wind (0 = steady) */
  gust: number;
  /** mean upward drift (world units / second) */
  rise: number;
  /** global motion damping, e.g. 0.12 for prefers-reduced-motion */
  motion?: number;
}

/**
 * A drift of faint, additive particles — atmosphere, not data. The motes ride
 * a coherent wind whose gusts ripple along the wind axis as a travelling wave,
 * so the same diagonal breeze that bends the grass/wheat (see
 * `InstancedKind.update`) is also visible in the air. Purely ambient: no event
 * drives them, so the eye learns to read them as background.
 */
export class Motes {
  private readonly points: THREE.Points;
  private readonly positions: Float32Array;
  private readonly phase: Float32Array;
  private readonly count: number;
  private readonly o: Required<MotesOptions>;
  private readonly dirX: number;
  private readonly dirZ: number;

  constructor(scene: THREE.Scene, opts: MotesOptions) {
    this.o = { centerX: 0, centerZ: 0, motion: 1, ...opts };
    this.count = opts.count;
    const len = Math.hypot(opts.windX, opts.windZ) || 1;
    this.dirX = opts.windX / len;
    this.dirZ = opts.windZ / len;

    this.positions = new Float32Array(this.count * 3);
    this.phase = new Float32Array(this.count);
    for (let i = 0; i < this.count; i++) {
      this.positions[i * 3] = this.o.centerX + (Math.random() * 2 - 1) * opts.radius;
      this.positions[i * 3 + 1] = opts.minY + Math.random() * (opts.maxY - opts.minY);
      this.positions[i * 3 + 2] = this.o.centerZ + (Math.random() * 2 - 1) * opts.radius;
      this.phase[i] = Math.random() * Math.PI * 2;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    this.points = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        size: opts.size,
        map: glowTexture(),
        color: opts.color,
        transparent: true,
        opacity: opts.opacity,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  update(t: number, dt: number): void {
    const o = this.o;
    const m = o.motion;
    const span = o.maxY - o.minY;
    const minX = o.centerX - o.radius;
    const minZ = o.centerZ - o.radius;
    const width = o.radius * 2;
    for (let i = 0; i < this.count; i++) {
      const ix = i * 3;
      let x = this.positions[ix];
      let y = this.positions[ix + 1];
      let z = this.positions[ix + 2];

      // gusts travel along the wind axis as a wave; a slow per-mote wander
      // keeps neighbours from drifting in lockstep
      const along = x * this.dirX + z * this.dirZ;
      const gust = 1 + o.gust * Math.sin(along * 0.12 - t * 0.6);
      const speed = o.windSpeed * gust * m;
      x += (this.dirX * speed + Math.sin(t * 0.3 + this.phase[i]) * 0.15 * m) * dt;
      z += (this.dirZ * speed + Math.cos(t * 0.27 + this.phase[i]) * 0.15 * m) * dt;
      y += (o.rise + Math.sin(t * 0.5 + this.phase[i]) * 0.1) * m * dt;

      // toroidal wrap keeps the drift region evenly populated
      if (x > minX + width) x -= width;
      else if (x < minX) x += width;
      if (z > minZ + width) z -= width;
      else if (z < minZ) z += width;
      if (y > o.maxY) y -= span;
      else if (y < o.minY) y += span;

      this.positions[ix] = x;
      this.positions[ix + 1] = y;
      this.positions[ix + 2] = z;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}
