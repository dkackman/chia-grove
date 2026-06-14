import * as THREE from "three";
import { safeBigInt } from "../shared/util.js";
import { MINE } from "./palette.js";

export const CYCLE_SECONDS = 150;

export function cyclePhase(t: number, cycle = CYCLE_SECONDS): number {
  return ((t % cycle) + cycle) % cycle / cycle;
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

export interface MineSky {
  update(dt: number, t: number): void;
  setNetspace(bytes: string): void;
  setSignalLost(lost: boolean): void;
  /** current daylight 0..1, read by the renderer for ambient tone. */
  daylight: number;
}

/**
 * Day-night scene: a vertex-colored sky dome, sun + moon sprites with a shared
 * directional light, a star field that fades in at night, and fog whose color
 * lerps day↔night. Pure math above is unit-tested; this wires it to objects.
 */
export function createMineSky(scene: THREE.Scene, reducedMotion = false): MineSky {
  const skyDay = new THREE.Color(MINE.skyDay);
  const skyNight = new THREE.Color(MINE.skyNight);
  const fogDay = new THREE.Color(MINE.fogDay);
  const fogNight = new THREE.Color(MINE.fogNight);
  const bg = new THREE.Color();
  scene.background = bg;
  scene.fog = new THREE.FogExp2(MINE.fogDay, 0.012);

  // sun + moon
  const sun = new THREE.DirectionalLight(0xfff4c2, 1);
  scene.add(sun);
  const sunSprite = sprite(MINE.sun, 16);
  const moonSprite = sprite(MINE.moon, 12);
  scene.add(sunSprite, moonSprite);

  // stars (fade in at night)
  const stars = makeStars();
  scene.add(stars);
  const starMat = stars.material as THREE.PointsMaterial;

  function sprite(color: number, size: number): THREE.Sprite {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ color, fog: false, transparent: true, depthWrite: false }));
    s.scale.setScalar(size);
    return s;
  }
  function makeStars(): THREE.Points {
    const n = 600;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const th = Math.random() * Math.PI * 2;
      const phi = Math.acos(0.1 + Math.random() * 0.9);
      pos[i * 3] = 200 * Math.sin(phi) * Math.cos(th);
      pos[i * 3 + 1] = 200 * Math.cos(phi);
      pos[i * 3 + 2] = 200 * Math.sin(phi) * Math.sin(th);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    return new THREE.Points(g, new THREE.PointsMaterial({ size: 1.4, color: 0xdfe6f2, transparent: true, opacity: 0, depthWrite: false, fog: false }));
  }

  let netspace = 1;
  let signalLost = false;
  const out: MineSky = {
    daylight: 1,
    update(_dt, t) {
      const phase = reducedMotion ? 0.2 : cyclePhase(t);
      const h = sunHeight(phase);
      const day = daylight(phase) * (signalLost ? 0.5 : 1);
      out.daylight = day;
      bg.copy(skyNight).lerp(skyDay, day);
      (scene.fog as THREE.FogExp2).color.copy(fogNight).lerp(fogDay, day);
      // sun rides an arc; moon opposite
      const R = 140;
      sun.position.set(Math.cos(phase * Math.PI * 2) * R, h * R, -40);
      sun.intensity = Math.max(0.05, day) * netspace;
      sunSprite.position.copy(sun.position);
      (sunSprite.material as THREE.SpriteMaterial).opacity = Math.max(0, h);
      moonSprite.position.set(-sun.position.x, -h * R, -40);
      (moonSprite.material as THREE.SpriteMaterial).opacity = Math.max(0, -h);
      starMat.opacity = Math.max(0, -h) * 0.9;
      stars.rotation.y = t * 0.003;
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
