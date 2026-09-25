import * as THREE from "three";
import {
  ERUPT_SECONDS,
  IMPLODE_SECONDS,
  orbitPoint,
  reachAt,
  scaleAt,
  type Orbit,
  type Vec3,
} from "./layout.js";
import { FADE_GLSL, LIGHT_GLSL, type SceneUniforms } from "./shading.js";

/** Surface response for one kind of orbiter (coin metal, gem, halo, crystal). */
export interface OrbiterStyle {
  metal: number;
  spec: number;
  shininess: number;
  rim: number;
  ambient: number;
  /** constant self-illumination (fraction of base color) */
  glow: number;
}

const VERTEX = /* glsl */ `
attribute vec3 aCenter;
attribute vec4 aOrbit;  // radius, phase, speed, yOff
attribute vec4 aTilt;   // incl, node, spin, spinPhase
attribute vec4 aLife;   // born, dieAt, size, flash
attribute vec3 color;

uniform float uTime;
uniform float uOrbitTime;
uniform float uHover;
uniform float uLocalTilt;

varying vec3 vNormal;
varying vec3 vWorld;
varying vec3 vColor;
varying float vGlow;

vec3 rotY(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(p.x * c - p.z * s, p.y, p.x * s + p.z * c); }
vec3 rotX(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(p.x, p.y * c - p.z * s, p.y * s + p.z * c); }

void main() {
  float born = aLife.x;
  float dieAt = aLife.y;

  // eruption out of the crystal / implosion back into it (mirrors layout.ts reachAt/scaleAt)
  float p = clamp((uTime - born) / ${ERUPT_SECONDS.toFixed(3)}, 0.0, 1.0);
  float reach = 1.0 - pow(1.0 - p, 3.0);
  float ps = clamp((uTime - born) / ${(ERUPT_SECONDS * 0.7).toFixed(3)}, 0.0, 1.0);
  float scale = ps <= 0.0 ? 0.0 : 1.0 + 2.70158 * pow(ps - 1.0, 3.0) + 1.70158 * pow(ps - 1.0, 2.0);
  if (dieAt > 0.0) {
    float k = clamp((uTime - dieAt) / ${IMPLODE_SECONDS.toFixed(3)}, 0.0, 1.0);
    reach *= 1.0 - k * k;
    scale *= 1.0 - k;
  }

  bool hovered = float(gl_InstanceID) == uHover;
  float size = aLife.z * scale * (hovered ? 1.6 : 1.0);

  // self-rotation: tilt the body, then spin it about its own vertical axis
  float spin = aTilt.w + uOrbitTime * aTilt.z;
  vec3 local = rotY(rotX(position * size, aTilt.x * uLocalTilt), spin);
  vec3 n = rotY(rotX(normal, aTilt.x * uLocalTilt), spin);

  // orbit in its inclined plane about the block crystal
  float a = aOrbit.y + uOrbitTime * aOrbit.z;
  float r = aOrbit.x * reach;
  vec3 orb = vec3(cos(a) * r, aOrbit.w * reach, sin(a) * r);
  orb = rotY(rotX(orb, aTilt.x), aTilt.y);

  vec3 body = aCenter + orb;
  // bodies that swing right up against the lens (history view) shrink away
  float near = smoothstep(3.0, 8.0, length(cameraPosition - body));
  vec3 world = body + local * near;
  vWorld = world;
  vNormal = n;
  vColor = color;
  // a fresh spend flares as it erupts; hover lights it up
  float flare = aLife.w * (1.0 - smoothstep(0.0, 2.5, uTime - born));
  vGlow = flare + (hovered ? 1.2 : 0.0);
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
uniform float uMetal;
uniform float uSpec;
uniform float uShininess;
uniform float uRim;
uniform float uAmbient;
uniform float uSelfGlow;

varying vec3 vNormal;
varying vec3 vWorld;
varying vec3 vColor;
varying float vGlow;

${FADE_GLSL}
${LIGHT_GLSL}

void main() {
  vec3 N = normalize(vNormal);
  if (!gl_FrontFacing) N = -N;
  vec3 col = shade(vColor, N, vWorld, uMetal, uSpec, uShininess, uRim, uAmbient);
  col += vColor * (uSelfGlow + vGlow);
  gl_FragColor = vec4(fadeColor(col, vWorld), 1.0);
}
`;

/**
 * A pool of instanced bodies whose motion lives entirely in the vertex shader:
 * each instance erupts from its block's crystal, settles into an inclined
 * Keplerian orbit and spins about its own axis, all as a pure function of
 * time. The CPU only writes attributes when something is born or dies, so
 * thousands of orbiting coins cost nothing per frame.
 *
 * Because positions are computed on the GPU, `raycast` is overridden to run the
 * same math on the CPU (`orbitPoint`) — picking hits exactly what is drawn.
 */
export class Orbiters<T> {
  readonly mesh: THREE.Mesh;
  private readonly geometry: THREE.InstancedBufferGeometry;
  private readonly metas: (T | null)[];
  private readonly centers: Vec3[];
  private readonly orbits: Orbit[];
  private readonly born: Float32Array;
  private readonly dieAt: Float32Array;
  private readonly sizes: Float32Array;
  private readonly aCenter: THREE.InstancedBufferAttribute;
  private readonly aOrbit: THREE.InstancedBufferAttribute;
  private readonly aTilt: THREE.InstancedBufferAttribute;
  private readonly aLife: THREE.InstancedBufferAttribute;
  private readonly aColor: THREE.InstancedBufferAttribute;
  private readonly uniforms: Record<string, THREE.IUniform>;
  private next = 0;
  private used = 0;
  private dirtyMin = Infinity;
  private dirtyMax = -1;
  private time = 0;
  private orbitTime = 0;
  /** radius of the pick sphere relative to the drawn size */
  private readonly pickScale: number;

  constructor(
    scene: THREE.Scene,
    shared: SceneUniforms,
    base: THREE.BufferGeometry,
    private readonly cap: number,
    style: OrbiterStyle,
    opts: { localTilt?: number; pickScale?: number } = {}
  ) {
    this.geometry = new THREE.InstancedBufferGeometry();
    this.geometry.index = base.index;
    this.geometry.setAttribute("position", base.getAttribute("position"));
    this.geometry.setAttribute("normal", base.getAttribute("normal"));
    const attr = (size: number) => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * size), size);
      a.setUsage(THREE.DynamicDrawUsage);
      return a;
    };
    this.aCenter = attr(3);
    this.aOrbit = attr(4);
    this.aTilt = attr(4);
    this.aLife = attr(4);
    this.aColor = attr(3);
    this.geometry.setAttribute("aCenter", this.aCenter);
    this.geometry.setAttribute("aOrbit", this.aOrbit);
    this.geometry.setAttribute("aTilt", this.aTilt);
    this.geometry.setAttribute("aLife", this.aLife);
    this.geometry.setAttribute("color", this.aColor);
    this.geometry.instanceCount = 0;

    this.uniforms = {
      ...shared,
      uTime: { value: 0 },
      uOrbitTime: { value: 0 },
      uHover: { value: -1 },
      uLocalTilt: { value: opts.localTilt ?? 1 },
      uMetal: { value: style.metal },
      uSpec: { value: style.spec },
      uShininess: { value: style.shininess },
      uRim: { value: style.rim },
      uAmbient: { value: style.ambient },
      uSelfGlow: { value: style.glow },
    };
    const material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: this.uniforms,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.raycast = (raycaster, hits) => this.raycastInto(raycaster, hits);
    scene.add(this.mesh);

    this.metas = new Array<T | null>(cap).fill(null);
    this.centers = Array.from({ length: cap }, () => ({ x: 0, y: 0, z: 0 }));
    this.orbits = new Array<Orbit>(cap);
    this.born = new Float32Array(cap);
    this.dieAt = new Float32Array(cap);
    this.sizes = new Float32Array(cap);
    this.pickScale = opts.pickScale ?? 0.75;
  }

  /** Launch a body; returns its slot. The ring overwrites the oldest once full. */
  add(
    meta: T,
    center: Vec3,
    orbit: Orbit,
    size: number,
    color: THREE.Color,
    t: number,
    flash = 1
  ): number {
    const i = this.next;
    this.next = (this.next + 1) % this.cap;
    this.used = Math.max(this.used, i + 1);
    this.metas[i] = meta;
    this.centers[i] = center;
    this.orbits[i] = orbit;
    this.born[i] = t;
    this.dieAt[i] = 0;
    this.sizes[i] = size;
    this.aCenter.setXYZ(i, center.x, center.y, center.z);
    this.aOrbit.setXYZW(i, orbit.radius, orbit.phase, orbit.speed, orbit.yOff);
    this.aTilt.setXYZW(i, orbit.incl, orbit.node, orbit.spin, orbit.phase * 1.7);
    this.aLife.setXYZW(i, t, 0, size, flash);
    this.aColor.setXYZ(i, color.r, color.g, color.b);
    this.markDirty(i);
    this.geometry.instanceCount = this.used;
    return i;
  }

  /** Implode every live body whose meta matches (reorg, block recycling). */
  kill(predicate: (meta: T) => boolean, t: number, instant = false): void {
    for (let i = 0; i < this.used; i++) {
      const meta = this.metas[i];
      if (!meta || !predicate(meta)) continue;
      this.metas[i] = null;
      // instant: backdate the death so the implosion is already complete
      this.dieAt[i] = instant ? t - IMPLODE_SECONDS - 1 : t;
      this.aLife.setY(i, this.dieAt[i]);
      this.markDirty(i);
    }
  }

  /** Re-tint a live body in place (e.g. a late content flag). */
  forEach(fn: (meta: T, index: number) => void): void {
    for (let i = 0; i < this.used; i++) {
      const meta = this.metas[i];
      if (meta) fn(meta, i);
    }
  }

  setMeta(index: number, meta: T): void {
    if (this.metas[index]) this.metas[index] = meta;
  }

  metaAt(index: number | undefined): T | null {
    return index === undefined ? null : (this.metas[index] ?? null);
  }

  setHovered(index: number | undefined): void {
    this.uniforms.uHover.value = index ?? -1;
  }

  /** Current world position of a live body (for effects anchored to it). */
  positionOf(index: number): Vec3 {
    const reach = reachAt(this.time, this.born[index], this.dieAt[index]);
    return orbitPoint(this.centers[index], this.orbits[index], this.orbitTime, reach);
  }

  update(t: number, orbitTime: number): void {
    this.time = t;
    this.orbitTime = orbitTime;
    this.uniforms.uTime.value = t;
    this.uniforms.uOrbitTime.value = orbitTime;
    if (this.dirtyMax < 0) return;
    // one contiguous upload per attribute per frame, however many slots changed
    const count = this.dirtyMax - this.dirtyMin + 1;
    for (const a of [this.aCenter, this.aOrbit, this.aTilt, this.aLife, this.aColor]) {
      a.clearUpdateRanges();
      a.addUpdateRange(this.dirtyMin * a.itemSize, count * a.itemSize);
      a.needsUpdate = true;
    }
    this.dirtyMin = Infinity;
    this.dirtyMax = -1;
  }

  private markDirty(i: number): void {
    if (i < this.dirtyMin) this.dirtyMin = i;
    if (i > this.dirtyMax) this.dirtyMax = i;
  }

  private readonly scratch = new THREE.Vector3();

  private raycastInto(raycaster: THREE.Raycaster, hits: THREE.Intersection[]): void {
    const ray = raycaster.ray;
    const focusY = (this.uniforms.uFocusY.value as number) ?? 0;
    for (let i = 0; i < this.used; i++) {
      if (!this.metas[i]) continue;
      const scale = scaleAt(this.time, this.born[i], this.dieAt[i]);
      if (scale < 0.3) continue;
      const p = this.positionOf(i);
      // bodies faded into the depths of history aren't pickable
      if (p.y < focusY - 40 || p.y > focusY + 30) continue;
      const radius = Math.max(0.22, this.sizes[i] * this.pickScale);
      this.scratch.set(p.x, p.y, p.z);
      if (ray.distanceSqToPoint(this.scratch) > radius * radius) continue;
      const distance = ray.origin.distanceTo(this.scratch);
      // shrunk away against the lens (see the vertex shader) → not pickable
      if (distance < Math.max(5, raycaster.near) || distance > raycaster.far) continue;
      hits.push({ distance, point: this.scratch.clone(), object: this.mesh, instanceId: i });
    }
  }
}
