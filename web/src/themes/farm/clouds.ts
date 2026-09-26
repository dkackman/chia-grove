import * as THREE from "three";

/**
 * Drifting cloud shadows, computed per fragment from world position so they
 * roll over everything the sun lights — the turf, the painted parcels, the
 * soil rows, the crops, the barn and the hills alike — instead of being flat
 * decal planes that have to fade out before the ground starts to roll.
 *
 * The shadow only attenuates *direct* light (the sun and its fill), never the
 * hemisphere skylight, so a shaded patch dims to a cool, still-readable tone
 * rather than going muddy.
 */

/** World units per noise cell — big, soft patches rather than dapple. */
export const CLOUD_SCALE = 34;
/** Wind, in noise cells per second: drifting east and a little toward the camera. */
export const CLOUD_WIND = [0.018, 0.006] as const;
/** How much of the direct light a full cloud blocks. */
export const CLOUD_SHADOW_STRENGTH = 0.6;

export const cloudUniforms = {
  uCloudTime: { value: 0 },
};

/** Shared GLSL: a cheap value-noise fbm and the cloud cover (0 clear, 1 overcast). */
export const CLOUD_GLSL = /* glsl */ `
uniform float uCloudTime;
float farmHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float farmNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(farmHash(i), farmHash(i + vec2(1.0, 0.0)), u.x),
    mix(farmHash(i + vec2(0.0, 1.0)), farmHash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}
float farmCloudCover(vec2 xz) {
  vec2 p = xz / ${CLOUD_SCALE.toFixed(1)} + vec2(${CLOUD_WIND[0]}, ${CLOUD_WIND[1]}) * uCloudTime;
  float n = 0.5 * farmNoise(p) + 0.3 * farmNoise(p * 2.03 + 17.1) + 0.2 * farmNoise(p * 4.1 - 9.3);
  return smoothstep(0.5, 0.7, n);
}
`;

/** Wrap time so the noise domain never drifts far enough to lose float precision. */
export function cloudTime(t: number): number {
  return t % 20000;
}

const patched = new WeakSet<THREE.Material>();

function patchMaterial(material: THREE.MeshStandardMaterial): void {
  if (patched.has(material)) return;
  patched.add(material);
  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.uniforms.uCloudTime = cloudUniforms.uCloudTime;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vCloudWorld;")
      .replace(
        "#include <project_vertex>",
        `#include <project_vertex>
        vec4 cloudWorld = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          cloudWorld = instanceMatrix * cloudWorld;
        #endif
        vCloudWorld = (modelMatrix * cloudWorld).xyz;`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\nvarying vec3 vCloudWorld;\n${CLOUD_GLSL}`)
      .replace(
        "#include <lights_fragment_end>",
        `#include <lights_fragment_end>
        float cloudShade = 1.0 - ${CLOUD_SHADOW_STRENGTH.toFixed(2)} * farmCloudCover(vCloudWorld.xz);
        reflectedLight.directDiffuse *= cloudShade;
        reflectedLight.directSpecular *= cloudShade;`
      );
  };
  material.customProgramCacheKey = () => previousKey + "|farm-cloud";
  material.needsUpdate = true;
}

/** Patch every lit standard material in the scene. Call once, after the scene is built. */
export function applyCloudShadows(scene: THREE.Object3D): void {
  scene.traverse((object) => {
    const material = (object as THREE.Mesh).material as
      THREE.Material | THREE.Material[] | undefined;
    if (!material) return;
    for (const m of Array.isArray(material) ? material : [material]) {
      if (m instanceof THREE.MeshStandardMaterial) patchMaterial(m);
    }
  });
}
