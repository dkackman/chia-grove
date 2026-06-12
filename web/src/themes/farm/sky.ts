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
        opacity: 0.4,
        depthWrite: false,
      })
    );
    cloud.position.set(-120 + i * 45, 38 + (i % 3) * 7, -110 - (i % 2) * 25);
    cloud.scale.set(34, 12, 1);
    scene.add(cloud);
    return cloud;
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
