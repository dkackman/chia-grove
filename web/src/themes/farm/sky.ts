import * as THREE from "three";
import { FARM } from "./palette.js";
import { glowTexture } from "../shared/textures.js";

function safeBigInt(value: string): bigint {
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

/** Peak opacity of a cloud shadow, out over the field. */
const SHADOW_OPACITY = 0.34;

/**
 * How dark a cloud shadow is at x. The shadow planes are flat and drift out to
 * x = ±60, but past |x| ≈ 26 the ground begins to roll (see terrain.ts) and a
 * hummock would occlude part of a flat shadow — a shadow vanishing behind a rise
 * reads as a bug. So they fade out before they get there, which also replaces the
 * hard wrap-around pop with a fade.
 */
export function shadowOpacity(x: number): number {
  const fade = THREE.MathUtils.clamp((38 - Math.abs(x)) / 14, 0, 1);
  return SHADOW_OPACITY * fade * fade;
}

export interface FarmSky {
  update(dt: number, t: number): void;
  setNetspace(bytes: string): void;
  setSignalLost(lost: boolean): void;
}

export function createFarmSky(scene: THREE.Scene): FarmSky {
  const glowMap = glowTexture();

  const sun = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowMap,
      color: FARM.sun,
      transparent: true,
      depthWrite: false,
    })
  );
  sun.position.set(40, 55, -80);
  sun.scale.setScalar(30);
  scene.add(sun);

  const sunLight = new THREE.DirectionalLight(0xfff2d0, 1.1);
  sunLight.position.copy(sun.position);
  scene.add(sunLight);

  const clouds = Array.from({ length: 6 }, (_, i) => {
    const cloud = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowMap,
        color: 0xffffff,
        transparent: true,
        opacity: 0.62,
        depthWrite: false,
        // distant atmosphere: keep the haze from washing them into the sky
        // (matches the grove sky elements, which also opt out of fog)
        fog: false,
      })
    );
    cloud.position.set(-120 + i * 45, 31 + (i % 3) * 6, -110 - (i % 2) * 25);
    cloud.scale.set(44, 11, 1);
    scene.add(cloud);
    return cloud;
  });

  // soft cloud shadows creeping across the field. Not a literal projection of
  // the cloud sprites (those sit far back on the horizon) — just dark patches
  // that drift with the same wind, adding gentle dynamism where the crops are.
  const shadows = Array.from({ length: 4 }, (_, i) => {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: glowMap,
        color: 0x33502a, // a darker turf green, so the patch reads as shade
        transparent: true,
        opacity: SHADOW_OPACITY,
        depthWrite: false,
      })
    );
    mesh.rotation.x = -Math.PI / 2;
    const w = 20 + i * 4;
    mesh.scale.set(w, w * 0.7, 1);
    mesh.position.set(-50 + i * 34, 0.04, -8 + (i % 2) * 12);
    scene.add(mesh);
    return mesh;
  });

  let sunTarget = 1.0;
  let signalLost = false;

  return {
    update(dt, _t) {
      const target = signalLost ? sunTarget * 0.35 : sunTarget;
      sunLight.intensity += (target - sunLight.intensity) * Math.min(dt, 1);
      sun.material.opacity += (target * 0.9 - sun.material.opacity) * Math.min(dt, 1);
      for (const cloud of clouds) {
        cloud.position.x += dt * 1.2;
        if (cloud.position.x > 140) cloud.position.x = -140;
      }
      for (const shadow of shadows) {
        shadow.position.x += dt * 0.9;
        if (shadow.position.x > 60) shadow.position.x = -60;
        shadow.material.opacity = shadowOpacity(shadow.position.x);
      }
    },
    setNetspace(bytes) {
      // same EiB mapping shape as the grove moon, tuned for daylight
      const eib = Number(safeBigInt(bytes) >> 50n) / 1024;
      sunTarget = Math.min(1.35, Math.max(0.7, 0.7 + (eib - 10) * 0.02));
    },
    setSignalLost(lost) {
      signalLost = lost;
    },
  };
}
