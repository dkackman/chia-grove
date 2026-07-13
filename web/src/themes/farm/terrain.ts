import * as THREE from "three";
import { TURF_RADIUS } from "./layout.js";

/**
 * Ground inside this box stays **exactly** at y = 0. Every system that sits on
 * the turf — the crops, the tractor (headlands at x = ±24), the chickens, the
 * fence (z ≈ 22.8), the furrow plane, the soil strips, every blobShadow — is
 * placed at a hard-coded y and never samples a ground height. Sized to hold the
 * barn's far wall (z ≈ −28.3) with margin.
 */
export const FLAT = { halfX: 26, centerZ: -3, halfZ: 29 } as const;

/** Peak rise (and fall) of the rolling ground outside the flat zone. */
export const AMPLITUDE = 1.2;

/**
 * Squashed-sphere hills on the horizon: [x, z, r]. Exported so tests can check
 * scenery clearance (e.g. a turbine's lowest blade tip against the hill it
 * stands on) without duplicating these numbers.
 */
export const HILLS: ReadonlyArray<readonly [number, number, number]> = [
  [-55, -85, 48],
  [8, -95, 56],
  [62, -78, 42],
];

/**
 * A second, lower and hazier rank behind HILLS, for depth on the horizon. Kept
 * separate so the turbine clearance contract — which reasons about HILLS alone —
 * is untouched. Both ranks flatten the ground beneath them.
 */
export const FAR_HILLS: ReadonlyArray<readonly [number, number, number]> = [
  [-105, -108, 55],
  [-15, -138, 72],
  [88, -118, 50],
];

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = THREE.MathUtils.clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Three sines at falling wavelengths — roughly 60, 34 and 19 units — summing to
 * exactly [−1, 1] (0.6 + 0.28 + 0.12). Long enough to read as land rather than
 * corrugation at a camera 11 units up, short enough to fit several humps into
 * the wings either side of the field.
 */
function noise(x: number, z: number): number {
  return (
    Math.sin(x * 0.105 + 1.7) * Math.cos(z * 0.092 - 0.4) * 0.6 +
    Math.sin((x + z) * 0.11 + 3.1) * 0.28 +
    Math.sin(x * 0.19 - 2.2) * Math.sin(z * 0.17 + 0.9) * 0.12
  );
}

/** How much of the noise survives at (x, z) — zero wherever the ground must be flat. */
function damp(x: number, z: number): number {
  // The farm itself. Chebyshev, not Euclidean, so the flat region is the
  // rectangle the farm occupies rather than a circle circumscribing it.
  const inner = smoothstep(
    1,
    1.6,
    Math.max(Math.abs(x) / FLAT.halfX, Math.abs(z - FLAT.centerZ) / FLAT.halfZ)
  );

  // The hills are squashed spheres sunk to their equator, so their lower half is
  // buried. Ground that rises at a fringe pokes through the dome; ground that
  // dips there exposes the dome's culled underside and reads as a hole. Flatten
  // out well clear of every footprint.
  let hillMask = 1;
  for (const [hx, hz, r] of [...HILLS, ...FAR_HILLS]) {
    const e = Math.hypot((x - hx) / (1.3 * r), (z - hz) / r);
    hillMask = Math.min(hillMask, smoothstep(1.05, 1.2, e));
  }

  // The disc's rim is the horizon silhouette against the sky; a wavy rim reads
  // as a torn edge.
  const rimFade = 1 - smoothstep(TURF_RADIUS - 45, TURF_RADIUS - 20, Math.hypot(x, z));

  return inner * hillMask * rimFade;
}

/**
 * Height of the turf at (x, z). The vertices are displaced by this exact
 * function, so a prop that seats itself with it stands on the surface the
 * renderer draws rather than on an approximation of it.
 */
export function groundHeight(x: number, z: number): number {
  // `|| 0` normalizes -0 to +0: when noise(x, z) is negative and damp(x, z)
  // clamps to exactly zero, the product is -0, which is a legitimate "flat"
  // height but fails strict zero checks (and Object.is-based test assertions).
  return AMPLITUDE * noise(x, z) * damp(x, z) || 0;
}
