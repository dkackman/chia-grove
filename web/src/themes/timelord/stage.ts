import * as THREE from "three";
import { BLOCKS_PER_TURN, HELIX_RADIUS } from "./layout.js";
import { FADE_GLSL, type SceneUniforms } from "./shading.js";

/** Mean spacing of Chia transaction blocks — the dial's sweep hand runs on it. */
export const TX_BLOCK_SECONDS = 52;

const NEBULA_VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww; // pin to the far plane
}
`;

const NEBULA_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uPulse;
uniform float uLost;
varying vec3 vDir;
float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
void main() {
  vec3 d = normalize(vDir);
  float drift = uTime * 0.004;
  float n = fbm(d * 2.2 + vec3(drift, 0.0, -drift));
  float m = fbm(d * 4.5 + vec3(3.1, n * 1.5, 1.7));
  // a tilted galactic band for structure
  float band = exp(-pow(dot(d, normalize(vec3(0.35, 1.0, -0.2))) * 3.2, 2.0));
  vec3 base = mix(vec3(0.006, 0.007, 0.02), vec3(0.012, 0.01, 0.035), d.y * 0.5 + 0.5);
  vec3 violet = vec3(0.16, 0.05, 0.26) * smoothstep(0.45, 0.85, n) * (0.5 + band);
  vec3 teal = vec3(0.02, 0.16, 0.17) * smoothstep(0.5, 0.9, m) * (0.4 + band * 0.8);
  vec3 dust = vec3(0.05, 0.04, 0.07) * band * smoothstep(0.3, 0.7, m);
  vec3 col = base + violet + teal + dust;
  col *= 1.0 + uPulse * 0.35;
  col = mix(col, vec3(dot(col, vec3(0.33))) * vec3(1.2, 0.6, 0.5), uLost * 0.7);
  gl_FragColor = vec4(col, 1.0);
}
`;

const STAR_VERTEX = /* glsl */ `
attribute vec4 aStar; // size, twinkle rate, phase, rank
uniform float uTime;
uniform float uFrac;
uniform float uViewportH;
varying float vBright;
varying float vWarm;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_Position.z = gl_Position.w * 0.9999;
  // each star is a farmer's plot: the sky fills in as netspace grows
  float shown = step(aStar.w, uFrac);
  float tw = 0.65 + 0.35 * sin(uTime * aStar.y + aStar.z);
  vBright = shown * tw;
  vWarm = fract(aStar.z * 3.7);
  gl_PointSize = aStar.x * uViewportH / 900.0 * shown;
}
`;

const STAR_FRAGMENT = /* glsl */ `
varying float vBright;
varying float vWarm;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  float g = exp(-d * d * 5.0);
  vec3 col = mix(vec3(0.7, 0.8, 1.0), vec3(1.0, 0.85, 0.7), step(0.7, vWarm));
  gl_FragColor = vec4(col * g * vBright * 1.4, 1.0);
}
`;

const SPINDLE_FRAGMENT = /* glsl */ `
uniform float uTime;
varying vec3 vWorld;
varying vec2 vUv;
${FADE_GLSL}
void main() {
  // bright core fading at the tube's silhouette (uv.x wraps around it)
  float across = abs(sin(vUv.x * 3.14159));
  float flow = 0.7 + 0.3 * sin(vWorld.y * 0.35 - uTime * 1.4);
  float v = visibility(vWorld);
  gl_FragColor = vec4(vec3(0.3, 0.75, 1.0) * pow(across, 6.0) * flow * 0.12 * v, 1.0);
}
`;

const DIAL_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uHeadAngle;
uniform float uSweep;
uniform float uLost;
varying vec3 vWorld;
varying vec2 vUv;
${FADE_GLSL}
const float TAU = 6.2831853;
const float SLOTS = ${BLOCKS_PER_TURN.toFixed(1)};
void main() {
  float ang = atan(vWorld.z, vWorld.x);
  if (ang < 0.0) ang += TAU;
  float r = length(vWorld.xz);
  float inner = ${(HELIX_RADIUS + 2.3).toFixed(2)};
  float t = (r - inner) / 1.0; // 0 at the inner edge, 1 at the outer
  // one tick per block slot, a finer minute track between them
  float slot = ang / TAU * SLOTS;
  float tick = 1.0 - smoothstep(0.0, 0.05, abs(fract(slot + 0.5) - 0.5));
  float fine = 1.0 - smoothstep(0.0, 0.08, abs(fract(slot * 5.0 + 0.5) - 0.5));
  float rim = 1.0 - smoothstep(0.0, 0.05, abs(t - 0.1));
  float mark = rim * 0.5 + tick * smoothstep(0.15, 0.3, t) * 0.9 + fine * smoothstep(0.55, 0.7, t) * 0.25;

  // the sweep hand: an arc from the head slot toward the next one, filling as
  // the timelords grind out the next proof of time
  float rel = mod(ang - uHeadAngle + TAU, TAU) / (TAU / SLOTS);
  float arc = step(0.0, rel) * (1.0 - step(uSweep, rel)) * smoothstep(0.25, 0.45, t) * (1.0 - smoothstep(0.75, 0.95, t));
  float hand = exp(-pow((rel - uSweep) * 40.0, 2.0)) * smoothstep(0.3, 0.5, t) * (1.0 - smoothstep(0.8, 1.0, t));
  float head = exp(-pow(min(rel, SLOTS - rel) * 5.0, 2.0));

  vec3 col = vec3(0.3, 0.7, 0.9) * mark * 0.45
           + vec3(0.25, 1.0, 0.55) * (arc * 0.18 + hand * 0.8)
           + vec3(0.6, 1.0, 0.8) * head * tick * 0.35;
  col = mix(col, vec3(1.0, 0.35, 0.2) * length(col), uLost);
  gl_FragColor = vec4(col * visibility(vWorld), 1.0);
}
`;

const WORLD_VERTEX = /* glsl */ `
varying vec3 vWorld;
varying vec2 vUv;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

export interface Stage {
  setNetspace(fraction: number): void;
  setSignalLost(lost: boolean): void;
  update(
    t: number,
    dt: number,
    camera: THREE.Camera,
    focusY: number,
    headAngle: number,
    sweep: number,
    viewportH: number
  ): void;
}

/**
 * Everything that isn't data: the nebula, a starfield whose density tracks
 * netspace, the luminous spindle the helix winds around, and a timelord's dial
 * at the focus height — one tick per block slot, with a sweep hand that fills
 * toward the next slot as time passes since the last block.
 */
export function createStage(
  scene: THREE.Scene,
  shared: SceneUniforms,
  reducedMotion: boolean
): Stage {
  const nebulaUniforms = { uTime: { value: 0 }, uPulse: shared.uPulse, uLost: { value: 0 } };
  const nebula = new THREE.Mesh(
    new THREE.SphereGeometry(400, 48, 24),
    new THREE.ShaderMaterial({
      vertexShader: NEBULA_VERTEX,
      fragmentShader: NEBULA_FRAGMENT,
      uniforms: nebulaUniforms,
      side: THREE.BackSide,
      depthWrite: false,
    })
  );
  nebula.renderOrder = -10;
  nebula.frustumCulled = false;
  scene.add(nebula);

  const STAR_COUNT = 4000;
  const starPos = new Float32Array(STAR_COUNT * 3);
  const starAttr = new Float32Array(STAR_COUNT * 4);
  for (let i = 0; i < STAR_COUNT; i++) {
    const u = Math.random() * 2 - 1;
    const th = Math.random() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    starPos.set([Math.cos(th) * s * 300, u * 300, Math.sin(th) * s * 300], i * 3);
    const big = Math.random() < 0.06;
    starAttr.set(
      [
        big ? 5 + Math.random() * 4 : 1.8 + Math.random() * 2.2,
        0.5 + Math.random() * 2.5,
        Math.random() * 6.28,
        Math.random(),
      ],
      i * 4
    );
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
  starGeo.setAttribute("aStar", new THREE.BufferAttribute(starAttr, 4));
  const starUniforms = {
    uTime: { value: 0 },
    uFrac: { value: 0.35 },
    uViewportH: { value: innerHeight },
  };
  const stars = new THREE.Points(
    starGeo,
    new THREE.ShaderMaterial({
      vertexShader: STAR_VERTEX,
      fragmentShader: STAR_FRAGMENT,
      uniforms: starUniforms,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    })
  );
  stars.frustumCulled = false;
  scene.add(stars);

  const spindleUniforms = { ...shared, uTime: { value: 0 } };
  const spindle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.22, 220, 16, 1, true),
    new THREE.ShaderMaterial({
      vertexShader: WORLD_VERTEX,
      fragmentShader: SPINDLE_FRAGMENT,
      uniforms: spindleUniforms,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    })
  );
  spindle.frustumCulled = false;
  scene.add(spindle);

  const dialUniforms = {
    ...shared,
    uTime: { value: 0 },
    uHeadAngle: { value: 0 },
    uSweep: { value: 0 },
    uLost: { value: 0 },
  };
  const dialGeo = new THREE.RingGeometry(HELIX_RADIUS + 2.3, HELIX_RADIUS + 3.3, 280, 1);
  dialGeo.rotateX(-Math.PI / 2);
  const dial = new THREE.Mesh(
    dialGeo,
    new THREE.ShaderMaterial({
      vertexShader: WORLD_VERTEX,
      fragmentShader: DIAL_FRAGMENT,
      uniforms: dialUniforms,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
  );
  dial.frustumCulled = false;
  scene.add(dial);

  let lostTarget = 0;
  let lost = 0;
  return {
    setNetspace: (fraction) => (starUniforms.uFrac.value = fraction),
    setSignalLost: (l) => (lostTarget = l ? 1 : 0),
    update(t, dt, camera, focusY, headAngle, sweep, viewportH) {
      lost += (lostTarget - lost) * Math.min(1, dt * 2);
      nebula.position.copy(camera.position);
      stars.position.copy(camera.position);
      stars.rotation.y = reducedMotion ? 0 : t * 0.002;
      nebulaUniforms.uTime.value = reducedMotion ? 0 : t;
      nebulaUniforms.uLost.value = lost;
      starUniforms.uTime.value = t;
      starUniforms.uViewportH.value = viewportH;
      spindle.position.y = focusY;
      spindleUniforms.uTime.value = t;
      dial.position.y = focusY - 2.2;
      dialUniforms.uTime.value = t;
      dialUniforms.uHeadAngle.value = headAngle;
      dialUniforms.uSweep.value = sweep;
      dialUniforms.uLost.value = lost;
    },
  };
}
