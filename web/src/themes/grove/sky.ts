import * as THREE from "three";
import { COLORS } from "./palette.js";
import { auroraTexture, glowTexture } from "../shared/textures.js";

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

export function createSky(scene: THREE.Scene, reducedMotion = false): Sky {
  const glowMap = glowTexture();
  const METEOR_AXIS = new THREE.Vector3(1, 0, 0);

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
  // per-star twinkle: animate vertex-color brightness (additive) with an
  // individual phase + speed so the dome shimmers without a global flicker
  const starColors = new Float32Array(starCount * 3);
  const starPhase = new Float32Array(starCount);
  const starTwinkleSpeed = new Float32Array(starCount);
  const baseStar = new THREE.Color(0xd6e8e2);
  for (let i = 0; i < starCount; i++) {
    starColors[i * 3] = baseStar.r;
    starColors[i * 3 + 1] = baseStar.g;
    starColors[i * 3 + 2] = baseStar.b;
    starPhase[i] = Math.random() * Math.PI * 2;
    starTwinkleSpeed[i] = 0.6 + Math.random() * 1.6;
  }
  const starGeometry = new THREE.BufferGeometry();
  starGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  starGeometry.setAttribute("color", new THREE.BufferAttribute(starColors, 3));
  const stars = new THREE.Points(
    starGeometry,
    new THREE.PointsMaterial({
      size: 1.5,
      map: glowMap,
      vertexColors: true,
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

  // occasional shooting star: a tapering streak (head bright, tail fading via
  // additive vertex colors) plus a soft glow head. Rare and off-beat — a
  // reward for watching, never tied to an event.
  const METEOR_LEN = 11;
  const METEOR_SEGMENTS = 12;
  const METEOR_DURATION = 1.1;
  const meteorPos = new Float32Array((METEOR_SEGMENTS + 1) * 3);
  const meteorCol = new Float32Array((METEOR_SEGMENTS + 1) * 3);
  for (let i = 0; i <= METEOR_SEGMENTS; i++) {
    const f = i / METEOR_SEGMENTS; // 0 at head, 1 at tail
    meteorPos[i * 3] = -f * METEOR_LEN; // trail extends along local -X
    const b = (1 - f) ** 1.5; // additive brightness fades toward the tail
    meteorCol[i * 3] = b;
    meteorCol[i * 3 + 1] = b;
    meteorCol[i * 3 + 2] = b;
  }
  const meteorGeometry = new THREE.BufferGeometry();
  meteorGeometry.setAttribute("position", new THREE.BufferAttribute(meteorPos, 3));
  meteorGeometry.setAttribute("color", new THREE.BufferAttribute(meteorCol, 3));
  const meteor = new THREE.Line(
    meteorGeometry,
    new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
  meteor.visible = false;
  scene.add(meteor);

  const meteorHead = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowMap,
      color: 0xeaf2ff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
  meteorHead.scale.setScalar(3);
  meteorHead.visible = false;
  scene.add(meteorHead);

  const meteorFrom = new THREE.Vector3();
  const meteorDir = new THREE.Vector3();
  const meteorAt = new THREE.Vector3();
  let meteorActive = false;
  let meteorStart = 0;
  let nextMeteor = 8 + Math.random() * 20; // first within the opening ~30s

  function launchMeteor(t: number): void {
    const R = 150;
    const theta = Math.random() * Math.PI * 2;
    meteorFrom.set(Math.cos(theta) * R, R * (0.55 + Math.random() * 0.4), Math.sin(theta) * R - 40);
    // travel mostly downward with a lateral drift
    meteorDir
      .set((Math.random() - 0.5) * 1.4, -(0.5 + Math.random() * 0.4), (Math.random() - 0.5) * 1.4)
      .normalize();
    meteor.quaternion.setFromUnitVectors(METEOR_AXIS, meteorDir);
    meteorActive = true;
    meteorStart = t;
    meteor.visible = true;
    meteorHead.visible = true;
  }

  function updateMeteor(t: number): void {
    if (meteorActive) {
      const p = (t - meteorStart) / METEOR_DURATION;
      if (p >= 1) {
        meteorActive = false;
        meteor.visible = false;
        meteorHead.visible = false;
        nextMeteor = t + 18 + Math.random() * 22; // 18–40s between sightings
        return;
      }
      meteorAt.copy(meteorFrom).addScaledVector(meteorDir, p * 90);
      meteor.position.copy(meteorAt);
      meteorHead.position.copy(meteorAt);
      const env = Math.sin(p * Math.PI); // fade in, then out
      (meteor.material as THREE.LineBasicMaterial).opacity = env * 0.9;
      meteorHead.material.opacity = env * 0.8;
    } else if (!reducedMotion && !signalLost && t >= nextMeteor) {
      launchMeteor(t);
    }
  }

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
      if (!reducedMotion) {
        for (let i = 0; i < starCount; i++) {
          const tw = 0.7 + 0.3 * Math.sin(t * starTwinkleSpeed[i] + starPhase[i]);
          starColors[i * 3] = baseStar.r * tw;
          starColors[i * 3 + 1] = baseStar.g * tw;
          starColors[i * 3 + 2] = baseStar.b * tw;
        }
        starGeometry.attributes.color.needsUpdate = true;
      }
      updateMeteor(t);
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
