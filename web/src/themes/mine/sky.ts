import * as THREE from "three";
import { safeBigInt } from "../shared/util.js";
import { MINE } from "./palette.js";
import { sunTexture, moonAtlasTexture, MOON_PHASES } from "./textures.js";

export const CYCLE_SECONDS = 150;

export function cyclePhase(t: number, cycle = CYCLE_SECONDS): number {
  return (((t % cycle) + cycle) % cycle) / cycle;
}

/** -1 (midnight) .. +1 (noon). Phase 0 = sunrise. */
export function sunHeight(phase: number): number {
  return Math.sin(phase * Math.PI * 2);
}

/** 0 at night .. 1 at noon, with a soft dawn/dusk ramp. */
export function daylight(phase: number): number {
  return Math.max(0, Math.min(1, (sunHeight(phase) + 0.15) / 0.9));
}

/** Netspace (bytes) → sun peak/brightness multiplier (matches grove's curve). */
export function netspaceSun(bytes: string): number {
  const eib = Number(safeBigInt(bytes) >> 50n) / 1024;
  return Math.min(1.3, Math.max(0.8, 0.85 + (eib - 10) * 0.012));
}

/** Which moon phase (0 = full .. 4 = new .. 7) is showing — one step per day. */
export function moonPhase(t: number, cycle = CYCLE_SECONDS): number {
  const day = Math.floor(t / cycle);
  return ((day % MOON_PHASES) + MOON_PHASES) % MOON_PHASES;
}

/** 0..1 sunrise/sunset strength: peaks as the sun crosses the horizon. */
export function horizonGlow(phase: number): number {
  const h = sunHeight(phase);
  return Math.exp(-((h / 0.22) ** 2));
}

// The camera looks slightly down at the island, so only a narrow band of sky
// (a few degrees either side of the horizon) is ever on screen. The painted sun
// and moon ride a low, tilted arc through that band — rising and setting with
// the cycle — while the directional light keeps its steep arc for shading.
const ARC_LIFT = 0.13; // noon elevation ≈ atan(0.13 / 0.6) ≈ 12°
const ARC_DEPTH = 0.6;
const SKY_DIST = 400; // inside the camera far plane (600) and the dome (450)

export interface MineSky {
  update(dt: number, t: number, camera: THREE.Camera): void;
  setNetspace(bytes: string): void;
  setSignalLost(lost: boolean): void;
  /** current daylight 0..1, read by the renderer for ambient tone. */
  daylight: number;
  /** current cloud tint (day white → night slate, warmed at dawn/dusk). */
  readonly cloudColor: THREE.Color;
}

const DOME_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

// Horizon→zenith gradient, a sunrise/sunset glow on the sun's side of the sky,
// and square pixel stars hashed on an azimuth/elevation grid (no geometry).
const DOME_FRAG = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGlow;
uniform vec3 uSunDir;
uniform float uGlowAmt;
uniform float uStars;
uniform float uStarRot;
varying vec3 vDir;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  vec3 d = normalize(vDir);
  float y = d.y;
  vec3 col = mix(uHorizon, uZenith, smoothstep(-0.01, 0.2, y));
  vec2 sd = normalize(uSunDir.xz + vec2(1e-4));
  float side = max(0.0, dot(normalize(d.xz + vec2(1e-4)), sd));
  float g = pow(side, 3.0) * (1.0 - smoothstep(-0.04, 0.22, y)) * uGlowAmt;
  col = mix(col, uGlow, g);
  if (uStars > 0.001 && y > 0.0) {
    vec2 grid = vec2(atan(d.z, d.x) + uStarRot, asin(y)) / 0.0065;
    vec2 cell = floor(grid);
    float h = hash(cell);
    if (h > 0.982) {
      float b = hash(cell + 17.3);
      vec2 q = abs(fract(grid) - 0.5);
      float half_ = b > 0.75 ? 0.32 : 0.2;
      if (max(q.x, q.y) < half_) {
        col += vec3(0.85, 0.9, 1.0) * uStars * (0.45 + 0.55 * b) * smoothstep(0.0, 0.05, y);
      }
    }
  }
  gl_FragColor = vec4(col, 1.0);
}`;

/**
 * Day-night scene: a gradient sky dome (with pixel stars at night and a warm
 * glow at dawn/dusk), a square pixel sun and a phased square moon riding a low
 * arc through the visible band of sky, sun + moon directional lights, and fog
 * whose color tracks the horizon. Pure math above is unit-tested.
 */
export function createMineSky(scene: THREE.Scene, reducedMotion = false): MineSky {
  const skyDay = new THREE.Color(MINE.skyDay);
  const skyNight = new THREE.Color(MINE.skyNight);
  const fogDay = new THREE.Color(MINE.fogDay);
  const fogNight = new THREE.Color(MINE.fogNight);
  const glowColor = new THREE.Color(MINE.dawn);
  const cloudDay = new THREE.Color(0xffffff);
  const cloudNight = new THREE.Color(MINE.cloudNight);
  const bg = new THREE.Color();
  scene.background = bg;
  scene.fog = new THREE.FogExp2(MINE.fogDay, 0.0038);
  const fog = scene.fog;

  // gradient dome, centered on the camera every frame
  const uniforms = {
    uZenith: { value: new THREE.Color() },
    uHorizon: { value: fog.color },
    uGlow: { value: glowColor },
    uSunDir: { value: new THREE.Vector3(1, 0, 0) },
    uGlowAmt: { value: 0 },
    uStars: { value: 0 },
    uStarRot: { value: 0 },
  };
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(450, 32, 16),
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader: DOME_VERT,
      fragmentShader: DOME_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    })
  );
  dome.renderOrder = -10;
  dome.frustumCulled = false;
  scene.add(dome);

  // sun + moon
  const sun = new THREE.DirectionalLight(0xfff4c2, 1);
  scene.add(sun);
  // cool moonlight so the island stays legible (and bluish) at night
  const moonLight = new THREE.DirectionalLight(0x9fb6ff, 0);
  scene.add(moonLight);
  const sunMat = new THREE.SpriteMaterial({
    map: sunTexture(),
    fog: false,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const moonMap = moonAtlasTexture();
  moonMap.repeat.set(0.25, 0.5);
  const moonMat = new THREE.SpriteMaterial({
    map: moonMap,
    fog: false,
    transparent: true,
    depthWrite: false,
  });
  const sunSprite = new THREE.Sprite(sunMat);
  sunSprite.scale.setScalar(46);
  const moonSprite = new THREE.Sprite(moonMat);
  moonSprite.scale.setScalar(40);
  scene.add(sunSprite, moonSprite);
  const dir = new THREE.Vector3();
  const zenith = uniforms.uZenith.value;

  let netspace = 1;
  let signalLost = false;
  let shownPhase = -1;
  const cloudColor = new THREE.Color();
  const out: MineSky = {
    daylight: 1,
    cloudColor,
    update(_dt, t, camera) {
      const phase = reducedMotion ? 0.2 : cyclePhase(t);
      const h = sunHeight(phase);
      const c = Math.cos(phase * Math.PI * 2);
      const day = daylight(phase) * (signalLost ? 0.5 : 1);
      const glow = horizonGlow(phase) * (signalLost ? 0.4 : 1);
      out.daylight = day;
      zenith.copy(skyNight).lerp(skyDay, day);
      fog.color.copy(fogNight).lerp(fogDay, day);
      bg.copy(fog.color);
      cloudColor
        .copy(cloudNight)
        .lerp(cloudDay, day)
        .lerp(glowColor, glow * 0.35);
      const cam = camera.position;
      dome.position.copy(cam);
      // sun light rides a steep arc (good block shading); moon light opposite
      const R = 140;
      sun.position.set(c * R, h * R, -40);
      sun.intensity = Math.max(0, day) * netspace;
      const night = Math.max(0, -h);
      moonLight.position.set(-c * R, -h * R, -40);
      moonLight.intensity = night * 0.6;
      // painted sun/moon ride the low arc through the visible sky band
      dir.set(c, h * ARC_LIFT, -ARC_DEPTH).normalize();
      uniforms.uSunDir.value.copy(dir);
      sunSprite.position.copy(cam).addScaledVector(dir, SKY_DIST);
      sunMat.opacity = THREE.MathUtils.smoothstep(h, -0.06, 0.08) * (signalLost ? 0.5 : 1);
      dir.set(-c, -h * ARC_LIFT, ARC_DEPTH).normalize();
      moonSprite.position.copy(cam).addScaledVector(dir, SKY_DIST);
      moonMat.opacity = THREE.MathUtils.smoothstep(-h, -0.06, 0.08);
      const mp = reducedMotion ? 0 : moonPhase(t);
      if (mp !== shownPhase) {
        shownPhase = mp;
        moonMap.offset.set((mp % 4) * 0.25, mp < 4 ? 0.5 : 0);
      }
      uniforms.uGlowAmt.value = glow * 0.85;
      uniforms.uStars.value = THREE.MathUtils.smoothstep(night, 0.05, 0.4);
      uniforms.uStarRot.value = reducedMotion ? 0 : t * 0.003;
    },
    setNetspace(bytes) {
      netspace = netspaceSun(bytes);
    },
    setSignalLost(lost) {
      signalLost = lost;
    },
  };
  return out;
}
