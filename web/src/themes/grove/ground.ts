import * as THREE from "three";
import { COLORS } from "./palette.js";
import { glowTexture } from "../shared/textures.js";
import { NOISE_GLSL } from "./glsl.js";

export const RIPPLE_SECONDS = 3.5;
/** Ripple radius grows from 1 to 1 + RIPPLE_REACH world units over its life. */
const RIPPLE_REACH = 22;
export const RIPPLE_POOL = 6;
const MIST_RADIUS = 60;

export interface Ground {
  ripple(x: number, z: number): void;
  update(dt: number): void;
}

/**
 * Block-ripple bookkeeping packed straight into a shader uniform: one vec4 per
 * slot — (x, z, progress 0..1, unused), progress < 0 = idle. Slots wrap, so a
 * burst of blocks overwrites the oldest ripple. Pure data, no GPU — testable.
 */
export class RipplePool {
  readonly data: Float32Array;
  private next = 0;

  constructor(
    readonly size = RIPPLE_POOL,
    private readonly seconds = RIPPLE_SECONDS
  ) {
    this.data = new Float32Array(size * 4);
    for (let i = 0; i < size; i++) this.data[i * 4 + 2] = -1;
  }

  spawn(x: number, z: number): void {
    const o = this.next * 4;
    this.data[o] = x;
    this.data[o + 1] = z;
    this.data[o + 2] = 0;
    this.next = (this.next + 1) % this.size;
  }

  advance(dt: number): void {
    for (let i = 0; i < this.size; i++) {
      const o = i * 4 + 2;
      if (this.data[o] < 0) continue;
      const p = this.data[o] + dt / this.seconds;
      this.data[o] = p >= 1 ? -1 : p;
    }
  }
}

const GROUND_VERT = /* glsl */ `
#include <fog_pars_vertex>
varying vec2 vXZ;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vXZ = world.xz;
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

/*
 * Living meadow floor. Three layers, all kept well under the bloom threshold
 * so the plants stay the stars:
 *  - soil: near-black green with large, faint moss patches
 *  - mycelium: a domain-warped Voronoi-edge network (thick veins + fine
 *    threads) that grows mostly inside the moss, breathing slowly
 *  - block ripples: a soft luminous wavefront; the mycelium lights up in the
 *    wake just behind it, so a new block visibly "runs through" the meadow
 */
const GROUND_FRAG = /* glsl */ `
#include <fog_pars_fragment>
uniform float uTime;
uniform vec4 uRipples[${RIPPLE_POOL}];
uniform vec3 uSoil;
uniform vec3 uMoss;
uniform vec3 uVein;
uniform vec3 uRipple;
varying vec2 vXZ;
${NOISE_GLSL}

// distance to the nearest Voronoi cell edge (F2 - F1)
float cellEdge(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float d1 = 8.0;
  float d2 = 8.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 r = g + gHash22(i + g) - f;
      float d = dot(r, r);
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
    }
  }
  return sqrt(d2) - sqrt(d1);
}

void main() {
  vec2 p = vXZ;

  float moss = gFbm(p * 0.085 + 4.0);
  float grain = gNoise(p * 0.9 + 3.1);
  float patchMask = smoothstep(0.42, 0.72, moss);

  // domain-warped network: organic, not a honeycomb
  vec2 warp = vec2(gNoise(p * 0.18), gNoise(p * 0.18 + 7.3)) - 0.5;
  vec2 w = p * 0.32 + warp * 2.4;
  float e1 = cellEdge(w);
  float e2 = cellEdge(w * 2.6 + 11.0);
  float aa1 = fwidth(e1);
  float aa2 = fwidth(e2);
  float veins = 1.0 - smoothstep(0.0, 0.03 + aa1 * 1.5, e1);
  float threads = 1.0 - smoothstep(0.0, 0.02 + aa2 * 1.5, e2);
  // fade detail out where it would shimmer (far away / grazing angles)
  float detail = 1.0 - smoothstep(0.08, 0.35, fwidth(w.x) + fwidth(w.y));
  // break the cells into loose, wandering strands rather than closed polygons
  float strands = smoothstep(0.38, 0.62, gNoise(p * 0.45 + 9.0));
  float wisps = smoothstep(0.45, 0.7, gNoise(p * 1.1 + 2.0));
  float network = (veins * strands + threads * wisps * 0.35) * detail;
  network *= mix(0.04, 1.0, patchMask);

  // slow breathing that drifts across the meadow instead of throbbing in unison
  float breathe = 0.55 + 0.45 * sin(uTime * 0.5 + moss * 16.0 - length(p) * 0.12);

  // spores: sparse tiny twinkling specks inside the moss
  vec2 sp = p * 2.2;
  vec2 si = floor(sp);
  float sh = gHash21(si + 3.7);
  vec2 so = fract(sp) - 0.5 - (gHash22(si) - 0.5) * 0.6;
  float spore = smoothstep(0.09, 0.0, length(so)) * step(0.955, sh) * patchMask * detail;
  spore *= 0.4 + 0.6 * sin(uTime * (0.8 + sh * 2.0) + sh * 50.0);

  float front = 0.0;
  float wake = 0.0;
  for (int i = 0; i < ${RIPPLE_POOL}; i++) {
    vec4 r = uRipples[i];
    if (r.z < 0.0) continue;
    float radius = 1.0 + r.z * ${RIPPLE_REACH.toFixed(1)};
    float fade = 1.0 - r.z;
    float x = length(p - r.xy) - radius;
    front += exp(-x * x * 1.6) * fade * fade;
    // lit band trailing ~5 units behind the wavefront
    wake += smoothstep(-5.0, 0.0, x) * (1.0 - smoothstep(0.0, 0.4, x)) * fade;
  }

  vec3 col = uSoil * (0.65 + 0.7 * grain * (0.5 + moss));
  col += uMoss * patchMask * (0.55 + 0.45 * grain);
  col += uVein * network * (0.05 * breathe + 0.6 * min(wake, 1.2));
  col += uVein * spore * 0.35;
  col += uRipple * front * (0.24 + network * 0.6);
  // break up 8-bit banding in the dark gradients
  col += (gHash21(gl_FragCoord.xy) - 0.5) / 255.0;

  gl_FragColor = vec4(col, 1.0);
  #include <fog_fragment>
}
`;

export function createGround(scene: THREE.Scene, reducedMotion = false): Ground {
  const ripples = new RipplePool();
  const lin = (hex: number) => new THREE.Color(hex);
  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uTime: { value: 0 },
      uRipples: { value: [] },
      uSoil: { value: lin(COLORS.ground).multiplyScalar(0.55) },
      uMoss: { value: lin(0x0f3a24).multiplyScalar(0.35) },
      uVein: { value: lin(COLORS.mycelium) },
      uRipple: { value: lin(COLORS.ripple) },
    },
  ]);
  // UniformsUtils.merge clones values; hand the vec4 array to the shader as
  // Vector4s viewing the pool's live data (read each frame, zero allocations)
  const rippleVecs = Array.from({ length: RIPPLE_POOL }, () => new THREE.Vector4());
  uniforms.uRipples.value = rippleVecs;

  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(70, 96),
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader: GROUND_VERT,
      fragmentShader: GROUND_FRAG,
      fog: true,
    })
  );
  disc.rotation.x = -Math.PI / 2;
  scene.add(disc);

  // low-lying luminous mist: large faint flat glow patches drifting just above
  // the meadow floor, adding depth between the dark ground and the flora
  const mistMap = glowTexture();
  const mist = Array.from({ length: 4 }, (_, i) => {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: mistMap,
        color: 0x2f8a55,
        transparent: true,
        opacity: 0.12,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    mesh.rotation.x = -Math.PI / 2;
    const s = 34 + i * 8;
    mesh.scale.set(s, s, 1);
    mesh.position.set(
      (Math.random() * 2 - 1) * MIST_RADIUS,
      0.35 + i * 0.05,
      (Math.random() * 2 - 1) * MIST_RADIUS
    );
    scene.add(mesh);
    return { mesh, vx: (Math.random() - 0.5) * 1.1, vz: (Math.random() - 0.5) * 1.1 };
  });

  let time = 0;

  return {
    ripple(x, z) {
      ripples.spawn(x, z);
    },
    update(dt) {
      const m = reducedMotion ? 0.2 : 1;
      time += dt * m;
      uniforms.uTime.value = time;
      for (const p of mist) {
        p.mesh.position.x += p.vx * dt * m;
        p.mesh.position.z += p.vz * dt * m;
        if (p.mesh.position.x > MIST_RADIUS) p.mesh.position.x = -MIST_RADIUS;
        else if (p.mesh.position.x < -MIST_RADIUS) p.mesh.position.x = MIST_RADIUS;
        if (p.mesh.position.z > MIST_RADIUS) p.mesh.position.z = -MIST_RADIUS;
        else if (p.mesh.position.z < -MIST_RADIUS) p.mesh.position.z = MIST_RADIUS;
      }
      ripples.advance(dt);
      const d = ripples.data;
      for (let i = 0; i < RIPPLE_POOL; i++) {
        rippleVecs[i].set(d[i * 4], d[i * 4 + 1], d[i * 4 + 2], 0);
      }
    },
  };
}
