import * as THREE from "three";
import { LAKE } from "./palette.js";
import { clarityFromNetspace } from "./scales.js";

/** The waterline. The camera and every band live below this. */
export const SURFACE_Y = 0;

const SHAFT_COUNT = 7;

/**
 * The surface plane, rotated to face DOWN — this theme only ever views it from
 * underneath, so the winding is flipped relative to `mine/water.ts`.
 */
export function surfaceGeometry(): THREE.PlaneGeometry {
  const g = new THREE.PlaneGeometry(400, 400, 64, 64);
  g.rotateX(Math.PI / 2);
  return g;
}

export interface LakeWater {
  update(t: number): void;
  setNetspace(bytes: string): void;
  /** A new block — send a ripple ring out across the surface. */
  ripple(t: number): void;
}

/**
 * The surface seen from below, the sunlight coming through it, and the depth fog
 * that hides the far water. Netspace drives clarity, which sets fog density,
 * shaft opacity and light intensity together — one lever, the way grove scales
 * moonlight and farm scales the sun.
 *
 * The surface wave and the block ripple both live in the vertex shader (via
 * onBeforeCompile, the technique `mine/water.ts` uses) so they cost nothing on
 * the CPU regardless of how finely the plane is subdivided.
 */
export function createLakeWater(scene: THREE.Scene): LakeWater {
  // Fog density is tuned so the bed (~60 units down) stays dimly legible at
  // the default clarity of 0.5, rather than resolving to a black wall a few
  // bands down. Clearer water (higher clarity) still thins the fog further.
  const fog = new THREE.FogExp2(LAKE.deep, 0.0095);
  scene.fog = fog;

  // Seen from below, the surface is the brightest thing in frame — a lit
  // ceiling, not a shaded plane. A single overhead DirectionalLight can't
  // reach its underside, so the surface carries its own emissive glow;
  // setNetspace scales that glow with clarity alongside the fog and shafts.
  const material = new THREE.MeshStandardMaterial({
    color: LAKE.surface,
    emissive: new THREE.Color(LAKE.surface),
    emissiveIntensity: 1.3,
    transparent: true,
    opacity: 0.85,
    roughness: 0.15,
    metalness: 0.2,
    side: THREE.DoubleSide,
    fog: true,
  });

  let shader: { uniforms: Record<string, { value: number }> } | null = null;
  material.onBeforeCompile = (s) => {
    s.uniforms.uTime = { value: 0 };
    // -1e9 parks the ripple far in the past so none is showing at startup.
    s.uniforms.uRippleStart = { value: -1e9 };
    s.vertexShader =
      "uniform float uTime;\nuniform float uRippleStart;\n" +
      s.vertexShader.replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        transformed.y += sin(position.x * 0.18 + uTime * 0.9) * 0.22
                       + cos(position.z * 0.15 + uTime * 0.7) * 0.22;
        float age = uTime - uRippleStart;
        if (age > 0.0 && age < 4.0) {
          float d = length(position.xz);
          // a ring travelling outward at 26 units/s, fading as it goes
          float ring = exp(-pow(d - age * 26.0, 2.0) * 0.004);
          transformed.y += ring * 0.9 * (1.0 - age / 4.0);
        }`
      );
    shader = s as unknown as typeof shader;
  };

  const mesh = new THREE.Mesh(surfaceGeometry(), material);
  mesh.position.y = SURFACE_Y;
  scene.add(mesh);

  // Sunlight punching down through the surface.
  const sun = new THREE.DirectionalLight(0xfff0d0, 1.1);
  sun.position.set(18, 60, 10);
  scene.add(sun);
  // Brighter fill than a night theme needs — this is midday light scattering
  // through open water, and it's what makes the bed and weeds legible at all.
  scene.add(new THREE.HemisphereLight(0x9fd8f0, 0x14202a, 1.1));

  // God rays: thin, near-invisible additive cones hanging from the surface,
  // parked well outside the camera's orbit radius (CAM_RADIUS in lake.ts is
  // 34) so the camera glides past them at a distance instead of clipping
  // through their walls — up close a hollow double-sided cone reads as a
  // solid, hard-edged spike rather than a soft shaft. fog:false keeps them
  // from being eaten by their own depth fog.
  const shaftGeo = new THREE.ConeGeometry(1.8, 70, 6, 1, true);
  shaftGeo.translate(0, -35, 0);
  const shafts: THREE.Mesh[] = [];
  for (let i = 0; i < SHAFT_COUNT; i++) {
    const angle = (i / SHAFT_COUNT) * Math.PI * 2;
    const radius = 42 + (i % 3) * 12;
    const shaft = new THREE.Mesh(
      shaftGeo,
      new THREE.MeshBasicMaterial({
        color: LAKE.shaft,
        transparent: true,
        opacity: 0.03,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        fog: false,
      })
    );
    shaft.position.set(Math.cos(angle) * radius, SURFACE_Y, Math.sin(angle) * radius);
    shaft.rotation.z = (i % 2 ? 1 : -1) * 0.06;
    scene.add(shaft);
    shafts.push(shaft);
  }

  let clarity = 0.5;

  return {
    update(t) {
      if (shader) shader.uniforms.uTime.value = t;
      for (let i = 0; i < shafts.length; i++) {
        const mat = shafts[i].material as THREE.MeshBasicMaterial;
        // slow independent breathing so the rays never pulse in lockstep
        mat.opacity = (0.015 + clarity * 0.025) * (0.7 + 0.3 * Math.sin(t * 0.25 + i));
      }
    },
    setNetspace(bytes) {
      clarity = clarityFromNetspace(bytes);
      material.emissiveIntensity = 0.9 + clarity * 0.8;
      // clear water → thin fog you can see across; murky → close horizon.
      // Tuned so the bed (~60 units below the surface) stays dimly visible
      // even at the murkiest end, rather than resolving to a black wall.
      fog.density = 0.014 - clarity * 0.009;
      sun.intensity = 0.6 + clarity * 0.9;
    },
    ripple(t) {
      if (shader) shader.uniforms.uRippleStart.value = t;
    },
  };
}
