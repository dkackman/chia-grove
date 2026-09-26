import * as THREE from "three";
import { FADE_GLSL, type SceneUniforms } from "./shading.js";
import type { Vec3 } from "./layout.js";

/** Pixel-accurate point sizing: world-unit `size` → gl_PointSize at the vertex's depth. */
const POINT_SIZE_GLSL = /* glsl */ `
uniform float uViewportH;
float pointSize(float worldSize, vec4 mv) {
  return worldSize * projectionMatrix[1][1] * uViewportH * 0.5 / max(-mv.z, 0.1);
}
`;

const GLOW_VERTEX = /* glsl */ `
attribute vec3 color;
attribute float aSize;
attribute vec2 aLife; // born, dieAt
uniform float uTime;
varying vec3 vColor;
varying vec3 vWorld;
varying float vAlpha;
${POINT_SIZE_GLSL}
uniform vec3 uHeadPos;
void main() {
  float p = clamp((uTime - aLife.x) / 1.1, 0.0, 1.0);
  float grow = 1.0 - pow(1.0 - p, 3.0);
  float alive = aLife.y > 0.0 ? 1.0 - clamp((uTime - aLife.y) / 0.9, 0.0, 1.0) : 1.0;
  // the newest crystal breathes
  float isHead = 1.0 - smoothstep(0.05, 0.4, distance(position, uHeadPos));
  float breathe = 1.0 + isHead * (0.35 + 0.2 * sin(uTime * 2.4));
  // a birth flare that settles to a steady halo
  float flare = 1.0 + 1.2 * (1.0 - smoothstep(0.0, 1.8, uTime - aLife.x));
  vec4 mv = viewMatrix * vec4(position, 1.0);
  gl_PointSize = pointSize(aSize * grow * breathe * flare * alive, mv);
  gl_Position = projectionMatrix * mv;
  vColor = color;
  vWorld = position;
  vAlpha = alive * (1.0 + isHead * 0.6);
}
`;

const GLOW_FRAGMENT = /* glsl */ `
varying vec3 vColor;
varying vec3 vWorld;
varying float vAlpha;
${FADE_GLSL}
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  float core = exp(-d * d * 18.0);
  float halo = exp(-d * d * 3.5) * 0.35;
  gl_FragColor = vec4(vColor * (core * 0.9 + halo * 0.7) * vAlpha * visibility(vWorld), 1.0);
}
`;

/** Soft additive halos around block crystals (and the occasional effect flare). */
export class Glows {
  private readonly geometry = new THREE.BufferGeometry();
  private readonly position: THREE.BufferAttribute;
  private readonly color: THREE.BufferAttribute;
  private readonly size: THREE.BufferAttribute;
  private readonly life: THREE.BufferAttribute;
  private readonly material: THREE.ShaderMaterial;
  private next = 0;
  private used = 0;

  constructor(
    scene: THREE.Scene,
    shared: SceneUniforms,
    private readonly cap: number
  ) {
    const attr = (n: number) => {
      const a = new THREE.BufferAttribute(new Float32Array(cap * n), n);
      a.setUsage(THREE.DynamicDrawUsage);
      return a;
    };
    this.position = attr(3);
    this.color = attr(3);
    this.size = attr(1);
    this.life = attr(2);
    this.geometry.setAttribute("position", this.position);
    this.geometry.setAttribute("color", this.color);
    this.geometry.setAttribute("aSize", this.size);
    this.geometry.setAttribute("aLife", this.life);
    this.geometry.setDrawRange(0, 0);
    this.material = new THREE.ShaderMaterial({
      vertexShader: GLOW_VERTEX,
      fragmentShader: GLOW_FRAGMENT,
      uniforms: { ...shared, uTime: { value: 0 }, uViewportH: { value: innerHeight } },
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    const points = new THREE.Points(this.geometry, this.material);
    points.frustumCulled = false;
    scene.add(points);
  }

  /** `slot` pins the halo to a caller-owned index (e.g. the block's ring slot). */
  add(p: Vec3, color: THREE.Color, size: number, t: number, slot?: number): number {
    const i = slot ?? this.next;
    if (slot === undefined) this.next = (this.next + 1) % this.cap;
    this.used = Math.max(this.used, i + 1);
    this.position.setXYZ(i, p.x, p.y, p.z);
    this.color.setXYZ(i, color.r, color.g, color.b);
    this.size.setX(i, size);
    this.life.setXY(i, t, 0);
    for (const a of [this.position, this.color, this.size, this.life]) {
      a.addUpdateRange(i * a.itemSize, a.itemSize);
      a.needsUpdate = true;
    }
    this.geometry.setDrawRange(0, this.used);
    return i;
  }

  kill(index: number, t: number): void {
    this.life.setY(index, t);
    this.life.addUpdateRange(index * 2, 2);
    this.life.needsUpdate = true;
  }

  update(t: number, viewportH: number): void {
    this.material.uniforms.uTime.value = t;
    this.material.uniforms.uViewportH.value = viewportH;
  }
}

/** After arriving, migrated motes flare and spray outward for this long. */
const MIGRATE_BURST_SECONDS = 0.5;

const VORTEX_VERTEX = /* glsl */ `
attribute vec4 aSeed; // radius, angle, speed, offset
uniform float uTime;
uniform vec3 uCenter;
uniform float uActive;
uniform float uSwell;
uniform vec2 uMigRange; // [from, to) mote indices being drawn into the next block
uniform vec2 uMigTime;  // start, travel duration
uniform vec3 uMigTarget; // the new block's slot on the thread
varying float vAlpha;
varying vec3 vWorld;
varying float vHeat;
${POINT_SIZE_GLSL}
void main() {
  float id = float(gl_VertexID);
  bool migrating = id >= uMigRange.x && id < uMigRange.y;
  if (!migrating && id >= uActive) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    vAlpha = 0.0;
    return;
  }
  // progress down the funnel: pending transactions spiral in and down toward
  // the slot where the next block will be infused
  float s = fract(aSeed.w + uTime * 0.045 * aSeed.z);
  float fall = 1.0 - s;
  float r = mix(0.25, aSeed.x * (1.0 + uSwell * 0.4), pow(fall, 1.4));
  float a = aSeed.y + s * 9.0 * aSeed.z + uTime * 0.25;
  vec3 world = uCenter + vec3(cos(a) * r, fall * fall * 5.0 + 0.5 - uSwell * 0.3, sin(a) * r);
  vec4 mv = viewMatrix * vec4(world, 1.0);
  gl_PointSize = pointSize(0.16 + 0.1 * s, mv);
  gl_Position = projectionMatrix * mv;
  vAlpha = smoothstep(0.0, 0.15, s) * (1.0 - smoothstep(0.93, 1.0, s));
  vHeat = s;

  if (migrating) {
    // included transactions peel off the swirl, staggered, and whirl down
    // into the block's slot, all arriving as its coins erupt; then they flare
    // and spray outward with that burst
    float k = clamp((uTime - uMigTime.x - aSeed.w * 0.6) / (uMigTime.y - 0.6), 0.0, 1.0);
    float burst = clamp((uTime - uMigTime.x - uMigTime.y) / ${MIGRATE_BURST_SECONDS.toFixed(2)}, 0.0, 1.0);
    float e = k * k;
    vec3 off = world - uMigTarget;
    float spin = e * 5.0 * aSeed.z;
    off.xz = mat2(cos(spin), sin(spin), -sin(spin), cos(spin)) * off.xz;
    vec3 spray = normalize(vec3(cos(aSeed.y), aSeed.z - 1.05, sin(aSeed.y))) * aSeed.x * 0.35;
    world = uMigTarget + off * (1.0 - e) + spray * (1.0 - (1.0 - burst) * (1.0 - burst));
    mv = viewMatrix * vec4(world, 1.0);
    float size = mix(0.16 + 0.1 * s, 0.34, smoothstep(0.0, 0.3, k)) * (1.0 + 0.8 * sin(burst * 3.14159));
    gl_PointSize = pointSize(size, mv);
    gl_Position = projectionMatrix * mv;
    vAlpha = max(vAlpha, smoothstep(0.0, 0.2, k)) * 1.6 * (1.0 - burst) * (1.0 - burst);
    vHeat = mix(s, 1.0, smoothstep(0.0, 0.4, k));
  }
  vWorld = world;
}
`;

const VORTEX_FRAGMENT = /* glsl */ `
varying float vAlpha;
varying vec3 vWorld;
varying float vHeat;
${FADE_GLSL}
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  float g = exp(-d * d * 6.0);
  // cold, ghostly at the rim; warming to white-gold as they near infusion
  vec3 col = mix(vec3(0.35, 0.55, 1.0), vec3(1.0, 0.92, 0.7), vHeat * vHeat);
  gl_FragColor = vec4(col * g * vAlpha * 0.9 * visibility(vWorld), 1.0);
}
`;

/**
 * The mempool: a whirlpool of unconfirmed motes spiralling down into the empty
 * slot above the head, where the next block will be infused. Its population
 * tracks mempool size; each new block, the funnel glides up to the next slot.
 * migrate() draws the motes a block included down into its slot first.
 */
export class Vortex {
  private readonly material: THREE.ShaderMaterial;
  private readonly target = new THREE.Vector3();
  private readonly center: THREE.Vector3;
  private activeTarget = 40;
  private active = 0;
  private swell = 0;
  private migEnd = -1;
  private migFrom = 0;

  constructor(
    scene: THREE.Scene,
    shared: SceneUniforms,
    readonly cap: number
  ) {
    const seeds = new Float32Array(cap * 4);
    for (let i = 0; i < cap; i++) {
      seeds[i * 4] = 1.4 + Math.random() * 3.6;
      seeds[i * 4 + 1] = Math.random() * Math.PI * 2;
      seeds[i * 4 + 2] = 0.6 + Math.random() * 0.9;
      seeds[i * 4 + 3] = Math.random();
    }
    const geometry = new THREE.BufferGeometry();
    // position is unused (the shader places every mote) but three needs a count
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(cap * 3), 3));
    geometry.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 4));
    this.center = new THREE.Vector3();
    this.material = new THREE.ShaderMaterial({
      vertexShader: VORTEX_VERTEX,
      fragmentShader: VORTEX_FRAGMENT,
      uniforms: {
        ...shared,
        uTime: { value: 0 },
        uCenter: { value: this.center },
        uActive: { value: 0 },
        uSwell: { value: 0 },
        uMigRange: { value: new THREE.Vector2(0, 0) },
        uMigTime: { value: new THREE.Vector2(0, 1) },
        uMigTarget: { value: new THREE.Vector3() },
        uViewportH: { value: innerHeight },
      },
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    const points = new THREE.Points(geometry, this.material);
    points.frustumCulled = false;
    scene.add(points);
  }

  setCount(n: number): void {
    this.activeTarget = Math.min(this.cap, n);
  }

  /** Motes currently swirling. */
  get count(): number {
    return Math.floor(this.active);
  }

  /**
   * Pull the top `n` swirling motes down to `target` over `duration` seconds,
   * burst them outward, then drop them from the swirl.
   */
  migrate(n: number, target: Vec3, t: number, duration: number): void {
    this.finishMigration();
    const to = Math.floor(this.active);
    const from = Math.max(0, to - Math.round(n));
    if (from >= to) return;
    this.migFrom = from;
    this.migEnd = t + duration + MIGRATE_BURST_SECONDS;
    const u = this.material.uniforms;
    (u.uMigTarget.value as THREE.Vector3).set(target.x, target.y, target.z);
    (u.uMigRange.value as THREE.Vector2).set(from, to);
    (u.uMigTime.value as THREE.Vector2).set(t, duration);
    this.active = from;
    this.activeTarget = Math.max(0, this.activeTarget - (to - from));
  }

  private finishMigration(): void {
    if (this.migEnd < 0) return;
    this.migEnd = -1;
    (this.material.uniforms.uMigRange.value as THREE.Vector2).set(0, 0);
  }

  /** Move the funnel to the next empty slot; `snap` skips the glide (snapshot replay). */
  moveTo(p: Vec3, snap: boolean): void {
    this.target.set(p.x, p.y, p.z);
    if (snap) this.center.copy(this.target);
    this.swell = 1;
  }

  update(t: number, dt: number, viewportH: number): void {
    this.center.lerp(this.target, Math.min(1, dt * 1.6));
    this.active += (this.activeTarget - this.active) * Math.min(1, dt * 0.8);
    // keep the swirl from regrowing into motes that are still mid-flight
    if (this.migEnd >= 0) this.active = Math.min(this.active, this.migFrom);
    this.swell = Math.max(0, this.swell - dt * 0.7);
    if (this.migEnd >= 0 && t >= this.migEnd) this.finishMigration();
    const u = this.material.uniforms;
    u.uTime.value = t;
    u.uActive.value = this.active;
    u.uSwell.value = this.swell;
    u.uViewportH.value = viewportH;
  }
}
