import * as THREE from "three";
import { FARM } from "./palette.js";
import { CLOUD_GLSL, cloudTime, cloudUniforms } from "./clouds.js";
import { safeBigInt } from "../shared/util.js";

/**
 * Where the sun is: a late-afternoon sun low over the far right of the field,
 * just high enough to clear the hills and low enough to sit inside the camera's
 * frame. The key light shines from exactly this direction and the sky dome
 * paints its disc here, so the glow you see is where the light comes from.
 */
export const SUN_DIR = new THREE.Vector3(0.1, 0.13, -0.99).normalize();

/** Sky dome radius — inside the camera's far plane (500), outside the turf disc. */
const DOME_RADIUS = 420;

/** Key (sun) and fill intensities at the default netspace (sunTarget = 1). */
const KEY_INTENSITY = 1.9;
const FILL_INTENSITY = 1.05;

/** Netspace in EiB (0 for anything unparsable). */
export function netspaceEib(netspaceBytes: string): number {
  return Number(safeBigInt(netspaceBytes) >> 50n) / 1024;
}

/** Sun strength range the netspace trend maps onto. */
export const SUN_MIN = 0.75;
export const SUN_MAX = 1.3;
/** Strength change per unit of relative netspace change (1% → ±0.2). */
const TREND_GAIN = 20;
/** Per-sample weight of the slowly-following baseline (ambient arrives every
 *  ~10 s, so the baseline lags by roughly a quarter of an hour). */
export const BASELINE_RATE = 0.01;

/**
 * Netspace → sun strength, relative to the session's own baseline: absolute
 * netspace barely moves in a session, so a fixed EiB scale left the sun
 * effectively constant. Growing netspace brightens the afternoon, shrinking
 * dims it, across [SUN_MIN, SUN_MAX]; at the baseline it is 1.
 */
export function trendStrength(eib: number, baselineEib: number): number {
  if (!(baselineEib > 0) || !(eib > 0)) return 1;
  const trend = eib / baselineEib - 1;
  return Math.min(SUN_MAX, Math.max(SUN_MIN, 1 + trend * TREND_GAIN));
}

export interface FarmSky {
  update(dt: number, t: number): void;
  setNetspace(bytes: string): void;
  setSignalLost(lost: boolean): void;
}

const DOME_VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  // follow the camera so the dome is always "at infinity"
  vec4 world = vec4(position + cameraPosition, 1.0);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const DOME_FRAGMENT = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uHaze;
uniform vec3 uSunColor;
uniform vec3 uSunDir;
uniform float uSun;
varying vec3 vDir;
${CLOUD_GLSL}
float skyClouds(vec2 p) {
  float n = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    n += a * farmNoise(p);
    p = p * 2.07 + vec2(13.1, -7.7);
    a *= 0.5;
  }
  // the feed going quiet rolls an overcast in: more, greyer cloud
  return smoothstep(0.52 - 0.34 * uCloudCover, 0.74 - 0.2 * uCloudCover, n / 0.97);
}
void main() {
  vec3 dir = normalize(vDir);
  float up = max(dir.y, 0.0);
  float sunDot = max(dot(dir, uSunDir), 0.0);

  // zenith blue down to a pale horizon; the band just above the horizon is
  // warmed by the low sun, strongest on the sun's side of the sky
  vec3 sky = mix(uHorizon, uZenith, pow(smoothstep(0.0, 0.4, up), 0.6));
  float haze = (1.0 - smoothstep(0.0, 0.12, up)) * (0.25 + 0.75 * pow(sunDot, 4.0));
  sky = mix(sky, uHaze, haze * 0.8);

  // fair-weather clouds on a flattened dome, so they bunch up toward the
  // horizon; a second sample nudged toward the sun shades their far sides
  vec2 cp = dir.xz / (up + 0.1) * 0.9 + vec2(0.021, 0.007) * uCloudTime;
  float cover = skyClouds(cp);
  float shade = skyClouds(cp + uSunDir.xz * 0.08);
  float cloud = cover * smoothstep(0.0, 0.08, up);
  vec3 cloudLit = mix(vec3(0.74, 0.78, 0.86), vec3(1.0, 0.98, 0.95), clamp(1.0 - (shade - cover) * 2.5 - shade * 0.35, 0.0, 1.0));
  // toward the sun a cloud is backlit: its thick heart goes grey-blue while
  // its thin edges catch a silver lining
  float backlit = pow(sunDot, 8.0);
  cloudLit = mix(cloudLit, vec3(0.66, 0.7, 0.8), backlit * smoothstep(0.3, 1.0, cover) * 0.55);
  cloudLit += uSunColor * pow(sunDot, 24.0) * (1.0 - cover) * 0.45 * uSun;
  cloudLit = mix(cloudLit, vec3(0.6, 0.62, 0.66), uCloudCover * 0.6);
  sky = mix(sky, cloudLit, cloud);
  // and a flat, washed-out sky behind it
  sky = mix(sky, vec3(dot(sky, vec3(0.3, 0.59, 0.11))) * 0.92, uCloudCover * 0.45);

  // sun: a soft glow, a tighter halo and a bright disc
  float glow = pow(sunDot, 48.0) * 0.1 + pow(sunDot, 1200.0) * 0.4;
  float disc = smoothstep(0.9997, 0.99983, sunDot);
  sky += uSunColor * (glow * (1.0 - cloud * 0.7) + disc * 2.6 * (1.0 - cloud * 0.85)) * uSun;

  // below the horizon (past the turf's rim) settle into the fog colour
  sky = mix(sky, uHorizon, 1.0 - smoothstep(-0.04, 0.0, dir.y));
  gl_FragColor = vec4(sky, 1.0);
}
`;

export function createFarmSky(scene: THREE.Scene, reducedMotion = false): FarmSky {
  const domeUniforms = {
    uZenith: { value: new THREE.Color(FARM.skyZenith) },
    uHorizon: { value: new THREE.Color(FARM.haze) },
    uHaze: { value: new THREE.Color(FARM.skyWarmHaze) },
    uSunColor: { value: new THREE.Color(FARM.sun) },
    uSunDir: { value: SUN_DIR.clone() },
    uSun: { value: 1 },
    uCloudTime: cloudUniforms.uCloudTime,
    uCloudCover: cloudUniforms.uCloudCover,
  };
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(DOME_RADIUS, 48, 24),
    new THREE.ShaderMaterial({
      vertexShader: DOME_VERTEX,
      fragmentShader: DOME_FRAGMENT,
      uniforms: domeUniforms,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    })
  );
  dome.frustumCulled = false; // it follows the camera in the vertex shader
  dome.renderOrder = -1;
  scene.add(dome);

  // key light from the sun itself: warm and low, so it rakes across the soil
  // ridges and rims the crops
  const sunLight = new THREE.DirectionalLight(FARM.sunLight, KEY_INTENSITY);
  sunLight.position.copy(SUN_DIR).multiplyScalar(100);
  scene.add(sunLight);

  // soft fill from high behind the camera: the bright afternoon sky bouncing
  // back onto the faces the low sun can't reach, keeping the scene readable
  const fillLight = new THREE.DirectionalLight(FARM.skyFill, FILL_INTENSITY);
  fillLight.position.set(-30, 80, 60);
  scene.add(fillLight);

  let sunTarget = 1.0;
  let baseline = 0;
  let signalLost = false;
  let level = 1.0;
  const cloudSpeed = reducedMotion ? 0.25 : 1;
  let cloudClock = 0;

  return {
    update(dt, _t) {
      // signal lost: overcast (uCloudCover, below) and a dimmer sun behind it
      const target = signalLost ? sunTarget * 0.5 : sunTarget;
      level += (target - level) * Math.min(dt, 1);
      sunLight.intensity = KEY_INTENSITY * level;
      fillLight.intensity = FILL_INTENSITY * (0.55 + 0.45 * level);
      domeUniforms.uSun.value = level;
      // ease the overcast in (and out again) over a few seconds
      const cover = cloudUniforms.uCloudCover;
      cover.value += ((signalLost ? 1 : 0) - cover.value) * Math.min(dt * 0.5, 1);
      cloudClock += dt * cloudSpeed;
      cloudUniforms.uCloudTime.value = cloudTime(cloudClock);
    },
    setNetspace(bytes) {
      const eib = netspaceEib(bytes);
      if (!(eib > 0)) return;
      baseline = baseline > 0 ? baseline + (eib - baseline) * BASELINE_RATE : eib;
      sunTarget = trendStrength(eib, baseline);
    },
    setSignalLost(lost) {
      signalLost = lost;
    },
  };
}
