import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { TURF_RADIUS } from "./layout.js";
import { FARM } from "./palette.js";
import { landscapeTexture } from "./landscape.js";
import { mottledTexture } from "../shared/textures.js";

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
 * Three sines at falling wavelengths — roughly 60, 34 and 20 units — summing to
 * exactly [−1, 1] (0.6 + 0.28 + 0.12). Long enough to read as land rather than
 * corrugation at a camera 11 units up, short enough to fit several humps into
 * the wings either side of the field.
 */
function noise(x: number, z: number): number {
  return (
    Math.sin(x * 0.105 + 1.7) * Math.cos(z * 0.092 - 0.4) * 0.6 +
    Math.sin((x + z) * 0.131 + 3.1) * 0.28 +
    Math.sin(x * 0.331 - 2.2) * Math.sin(z * 0.3 + 0.9) * 0.12
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
  const y = AMPLITUDE * noise(x, z) * damp(x, z);
  // Normalize -0 to +0 (Object.is-based toBe(0) rejects -0). Do not swallow
  // NaN — let it stay NaN so tests catch unexpected computations.
  return Object.is(y, -0) ? 0 : y;
}

/**
 * The turf disc, displaced by `groundHeight`. A `RingGeometry`, not a
 * `CircleGeometry`: a circle is a single triangle fan with no radial
 * subdivision, so there is nothing between its centre and its rim to displace.
 * The ring is rotated flat at build time, so its positions are already
 * world-space and the mesh it goes into needs no rotation of its own.
 */
export function turfGeometry(): THREE.BufferGeometry {
  const geo = new THREE.RingGeometry(0, TURF_RADIUS, 128, 72);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.getAttribute("position");
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, groundHeight(pos.getX(i), pos.getZ(i)));
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/** One rank of hazy hills. `squash` is the y-scale; flatter reads as further off. */
function addHills(
  scene: THREE.Scene,
  rank: ReadonlyArray<readonly [number, number, number]>,
  squash: number,
  color: number
): void {
  const hills: THREE.BufferGeometry[] = [];
  for (const [x, z, r] of rank) {
    const hill = new THREE.SphereGeometry(r, 20, 10);
    hill.scale(1.3, squash, 1);
    hill.translate(x, 0, z);
    hills.push(hill);
  }
  scene.add(
    new THREE.Mesh(mergeGeometries(hills), new THREE.MeshStandardMaterial({ color, roughness: 1 }))
  );
}

/** The ground: the rolling turf disc, the painted landscape draped on it, and the
 *  two ranks of hills behind. */
export function createTerrain(scene: THREE.Scene): void {
  const geo = turfGeometry();

  scene.add(
    new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({
        // repeat, or a single canvas stretched across 280 units has no grain at
        // all and the whole disc reads as one flat green mat
        map: mottledTexture(FARM.turf, 0x8fbf72, 0x5e8348, 1, 22),
        roughness: 1,
      })
    )
  );

  // The parcels, the lane and the barnyard, on a clone of the same displaced
  // surface so the overlay drapes with the ground rather than z-fighting a flat
  // plane against it. Lit (not Basic), so it dims and warms with the sun exactly
  // as the turf beneath it does. polygonOffset guards the two near-coincident
  // surfaces against depth flicker out at the far end of the disc.
  scene.add(
    new THREE.Mesh(
      geo.clone().translate(0, 0.02, 0),
      new THREE.MeshStandardMaterial({
        map: landscapeTexture(),
        transparent: true,
        depthWrite: false,
        roughness: 1,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      })
    )
  );

  // the far rank first, so the near hills draw over it
  addHills(scene, FAR_HILLS, 0.1, FARM.hillFar);
  addHills(scene, HILLS, 0.16, FARM.hill);
}
