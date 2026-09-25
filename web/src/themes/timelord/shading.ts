import * as THREE from "three";

/**
 * Uniforms every timelord material shares (by reference — one object, so a
 * single write per frame reaches every shader).
 *
 * - uFocusY: world height the camera is looking at. History fades into the
 *   abyss below it, so scrolling back through time brings old blocks to light.
 * - uHeadPos / uHeadColor: the newest crystal acts as a point light that
 *   washes nearby orbiters.
 * - uPulse: brief brightening when a block is infused.
 */
export interface SceneUniforms {
  [name: string]: THREE.IUniform;
  uFocusY: THREE.IUniform<number>;
  uHeadPos: THREE.IUniform<THREE.Vector3>;
  uHeadColor: THREE.IUniform<THREE.Color>;
  uKeyDir: THREE.IUniform<THREE.Vector3>;
  uPulse: THREE.IUniform<number>;
  uFogColor: THREE.IUniform<THREE.Color>;
}

export function createSceneUniforms(): SceneUniforms {
  return {
    uFocusY: { value: 0 },
    uHeadPos: { value: new THREE.Vector3() },
    uHeadColor: { value: new THREE.Color(0x46ffa0) },
    uKeyDir: { value: new THREE.Vector3(0.45, 0.8, 0.35).normalize() },
    uPulse: { value: 0 },
    uFogColor: { value: new THREE.Color(0x05060f) },
  };
}

/** Depth-of-history fade: bright near the focus, sinking to the fog colour below it. */
export const FADE_GLSL = /* glsl */ `
uniform float uFocusY;
uniform vec3 uFogColor;
float historyFade(vec3 world) {
  float dy = world.y - uFocusY;
  float below = smoothstep(-64.0, -6.0, dy);
  float above = 1.0 - smoothstep(12.0, 34.0, dy);
  return below * above;
}
float fogAmount(vec3 world) {
  float camDist = length(cameraPosition - world);
  return 1.0 - exp(-pow(camDist * 0.0085, 2.0));
}
vec3 fadeColor(vec3 col, vec3 world) {
  return mix(col, uFogColor, clamp(fogAmount(world) + (1.0 - historyFade(world)), 0.0, 1.0));
}
/** For additive materials: how much of the glow survives fog and the depth fade. */
float visibility(vec3 world) {
  return (1.0 - fogAmount(world)) * historyFade(world);
}
`;

/**
 * Hand-rolled lighting: a cool key light, a fake two-tone environment for
 * metallic reflections (so coins glint without a PMREM cube), fresnel rim, and
 * the head crystal as a green point light.
 */
export const LIGHT_GLSL = /* glsl */ `
uniform vec3 uKeyDir;
uniform vec3 uHeadPos;
uniform vec3 uHeadColor;
uniform float uPulse;
vec3 shade(vec3 base, vec3 N, vec3 world, float metal, float specAmt, float shininess, float rimAmt, float ambient) {
  vec3 V = normalize(cameraPosition - world);
  vec3 L = normalize(uKeyDir);
  float diff = max(dot(N, L), 0.0);
  vec3 H = normalize(L + V);
  float spec = pow(max(dot(N, H), 0.0), shininess);
  float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  vec3 R = reflect(-V, N);
  // fake environment: deep indigo below, cyan-violet nebula above, a hot band at the horizon
  vec3 env = mix(vec3(0.02, 0.02, 0.06), vec3(0.25, 0.35, 0.6), smoothstep(-0.5, 0.9, R.y));
  env += vec3(0.9, 0.8, 0.6) * pow(max(1.0 - abs(R.y - 0.15) * 3.0, 0.0), 4.0) * 0.6;

  // the newest crystal lights its neighbourhood
  vec3 toHead = uHeadPos - world;
  float hd = length(toHead);
  // (smoothstep: the crystal itself sits at the light and must not self-illuminate)
  float headFall = smoothstep(0.8, 3.0, hd) / (1.0 + hd * hd * 0.018);
  float headDiff = max(dot(N, toHead / max(hd, 1e-3)), 0.0) * 0.7 + 0.3;
  vec3 headLight = uHeadColor * headFall * headDiff * (0.7 + uPulse * 1.2);

  vec3 key = vec3(0.75, 0.8, 1.0);
  vec3 diffuse = base * (ambient + diff * key * 0.85 + headLight) * (1.0 - metal * 0.85);
  vec3 metallic = base * (env * 1.6 + headLight * 1.4 + diff * key * 0.35) * metal;
  vec3 specular = mix(vec3(1.0), base, metal * 0.6) * spec * specAmt;
  vec3 rim = mix(base, vec3(0.8, 0.95, 1.0), 0.4) * fres * rimAmt;
  return diffuse + metallic + specular + rim;
}
`;
