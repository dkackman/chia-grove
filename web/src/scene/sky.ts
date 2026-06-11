import * as THREE from "three";
import { COLORS } from "./palette.js";
import { auroraTexture, glowTexture } from "../themes/shared/textures.js";

function safeBigInt(value: string): bigint {
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

export interface Sky {
  update(dt: number, t: number): void;
  pulse(): void;
  setNetspace(bytes: string): void;
  setSignalLost(lost: boolean): void;
}

export function createSky(scene: THREE.Scene): Sky {
  const glowMap = glowTexture();

  // starfield dome
  const starCount = 900;
  const positions = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(0.15 + Math.random() * 0.85); // bias upward
    const radius = 180;
    positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = radius * Math.cos(phi);
    positions[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
  }
  const starGeometry = new THREE.BufferGeometry();
  starGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const stars = new THREE.Points(
    starGeometry,
    new THREE.PointsMaterial({
      size: 1.1,
      map: glowMap,
      color: 0x9fb8aa,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
  scene.add(stars);

  // moon
  const moonMaterial = new THREE.SpriteMaterial({
    map: glowMap,
    color: COLORS.moon,
    transparent: true,
    depthWrite: false,
  });
  const moon = new THREE.Sprite(moonMaterial);
  moon.position.set(-60, 58, -95);
  moon.scale.setScalar(26);
  scene.add(moon);

  const moonLight = new THREE.DirectionalLight(0xbfd8ff, 0.55);
  moonLight.position.copy(moon.position);
  scene.add(moonLight);

  // aurora band on the horizon
  const aurora = new THREE.Mesh(
    new THREE.PlaneGeometry(420, 90),
    new THREE.MeshBasicMaterial({
      map: auroraTexture(),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  aurora.position.set(0, 42, -160);
  scene.add(aurora);

  let auroraEnergy = 0;
  let moonTarget = 0.9;
  let signalLost = false;

  return {
    update(dt, t) {
      auroraEnergy = Math.max(0, auroraEnergy - dt / 4);
      aurora.material.opacity = auroraEnergy * 0.35;
      aurora.position.x = Math.sin(t * 0.05) * 30;

      const target = signalLost ? moonTarget * 0.35 : moonTarget;
      moonMaterial.opacity += (target - moonMaterial.opacity) * Math.min(dt, 1);
      moonLight.intensity = 0.15 + moonMaterial.opacity * 0.5;

      stars.rotation.y = t * 0.004;
    },
    pulse() {
      auroraEnergy = 1;
    },
    setNetspace(bytes) {
      const eib = Number(safeBigInt(bytes) >> 50n) / 1024;
      moonTarget = Math.min(1.05, Math.max(0.55, 0.55 + (eib - 10) * 0.0125));
    },
    setSignalLost(lost) {
      signalLost = lost;
    },
  };
}
