import { expect, test } from "vitest";
import {
  AMPLITUDE,
  FAR_HILL_SQUASH,
  FAR_HILLS,
  FLAT,
  groundHeight,
  HILL_SQUASH,
  HILLS,
  hillHeight,
  turfGeometry,
} from "../src/themes/farm/terrain.js";
import { FIELD, rowZ, TURF_RADIUS } from "../src/themes/farm/layout.js";

// hillHeight is the surface of the opaque dome addHills renders — squashed
// spheres, sunk to their equator. Re-derived independently here (mirroring
// farm-turbines.test.ts's own local copy of the same formula for HILLS alone),
// so this test doesn't just echo terrain.ts's implementation back at itself.
function referenceHillHeight(x: number, z: number): number {
  let maxY = 0;
  for (const [rank, squash] of [
    [HILLS, HILL_SQUASH],
    [FAR_HILLS, FAR_HILL_SQUASH],
  ] as const) {
    for (const [hx, hz, r] of rank) {
      const nx = (x - hx) / (1.3 * r);
      const nz = (z - hz) / r;
      const inside = 1 - nx * nx - nz * nz;
      if (inside > 0) maxY = Math.max(maxY, squash * r * Math.sqrt(inside));
    }
  }
  return maxY;
}

test("hillHeight matches the surface addHills renders, and is 0 off every dome", () => {
  expect(HILL_SQUASH).toBe(0.16);
  expect(FAR_HILL_SQUASH).toBe(0.1);
  for (const [hx, hz] of [...HILLS, ...FAR_HILLS]) {
    // dead centre of the dome: the tallest point on its surface
    expect(hillHeight(hx, hz)).toBeCloseTo(referenceHillHeight(hx, hz), 9);
    expect(hillHeight(hx, hz)).toBeGreaterThan(0);
  }
  // far from every hill: flat open ground, not covered by any dome
  expect(hillHeight(0, 0)).toBe(0);
  expect(hillHeight(140, 140)).toBe(0);
});

// hillHeight() takes the max across both ranks, so a point just past one
// hill's rim can still sit inside a different hill's footprint — HILLS and
// FAR_HILLS overlap in places. This sweeps a grid across the whole disc and
// checks hillHeight() against the independently-derived reference at every
// point, which exercises the rim (and every other case) without assuming any
// particular point is footprint-free.
test("hillHeight matches the reference formula across the whole disc", () => {
  for (let x = -TURF_RADIUS; x <= TURF_RADIUS; x += 5) {
    for (let z = -TURF_RADIUS; z <= TURF_RADIUS; z += 5) {
      expect(hillHeight(x, z)).toBeCloseTo(referenceHillHeight(x, z), 9);
    }
  }
});

// Every system that sits on the turf — the crops, the tractor, the chickens, the
// fence, the furrow plane, the soil strips, every blobShadow — is placed at a
// hard-coded y and never samples a ground height. If the ground rolls under any
// of them they float or sink. These are the points that must stay dead flat.
test("the ground is exactly flat everywhere the farm stands on it", () => {
  // the whole field, row by row, out to the tractor's headland turns (EDGE_X = 24)
  for (let row = 0; row < FIELD.rows; row++) {
    for (let x = -24; x <= 24; x += 2) {
      expect(groundHeight(x, rowZ(row))).toBe(0);
    }
  }
  const seats: ReadonlyArray<readonly [number, number]> = [
    [-23, rowZ(0) + 2.8], // fence, west end
    [23, rowZ(0) + 2.8], // fence, east end
    [-13.5, -28.3], // barn, far corner
    [-6.5, -23.7], // barn, near corner
    [-4.6, -26], // silo
    [-17.5, -26.5], // chicken yard, far corner
    [-10.5, -19.5], // chicken yard, near corner
  ];
  for (const [x, z] of seats) {
    expect(groundHeight(x, z)).toBe(0);
  }
});

// The hills are squashed spheres sunk to their equator, so their lower hemisphere
// is buried under the turf. Ground that rises at a hill's fringe pokes through
// the dome; ground that dips there exposes the dome's back-facing underside,
// which is culled and reads as a hole.
test("the ground is exactly flat under every hill", () => {
  for (const [hx, hz, r] of [...HILLS, ...FAR_HILLS]) {
    for (const [dx, dz] of [
      [0, 0],
      [0.9, 0],
      [-0.9, 0],
      [0, 0.9],
      [0, -0.9],
    ]) {
      expect(groundHeight(hx + dx * 1.3 * r, hz + dz * r)).toBe(0);
    }
  }
});

// A wavy disc rim reads as a torn paper edge against the sky.
test("the ground is exactly flat at the disc rim", () => {
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
    expect(groundHeight(Math.cos(a) * (TURF_RADIUS - 5), Math.sin(a) * (TURF_RADIUS - 5))).toBe(0);
  }
});

// A damping bug that flattened the whole disc would satisfy every test above.
test("the ground actually rolls in the wings", () => {
  let peak = 0;
  for (let x = -90; x <= 90; x += 3) {
    for (let z = -60; z <= 60; z += 3) {
      peak = Math.max(peak, Math.abs(groundHeight(x, z)));
    }
  }
  expect(peak).toBeGreaterThan(0.4);
});

test("the ground never exceeds the stated amplitude", () => {
  for (let x = -TURF_RADIUS; x <= TURF_RADIUS; x += 2) {
    for (let z = -TURF_RADIUS; z <= TURF_RADIUS; z += 2) {
      const y = groundHeight(x, z);
      expect(Number.isFinite(y)).toBe(true);
      expect(Math.abs(y)).toBeLessThanOrEqual(AMPLITUDE);
    }
  }
});

test("the flat zone contains the farm with margin", () => {
  expect(FLAT.halfX).toBeGreaterThan(24); // the tractor's headland turns
  expect(FLAT.centerZ + FLAT.halfZ).toBeGreaterThan(rowZ(0) + 2.8); // the fence
  expect(FLAT.centerZ - FLAT.halfZ).toBeLessThan(-28.3); // the barn's far wall
});

// The disc is a RingGeometry rotated flat at build time, so its position
// attribute is already world-space: y is height, and the mesh needs no rotation.
test("the turf geometry is a flat-lying, displaced disc", () => {
  const geo = turfGeometry();
  const pos = geo.getAttribute("position");
  // subdivided, not the 48-triangle fan a CircleGeometry would give
  expect(pos.count).toBeGreaterThan(1000);

  let peak = 0;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    expect(Number.isFinite(y)).toBe(true);
    // every vertex sits on the height field the props seat themselves with
    expect(y).toBeCloseTo(groundHeight(x, z), 6);
    expect(Math.hypot(x, z)).toBeLessThanOrEqual(TURF_RADIUS + 0.001);
    peak = Math.max(peak, Math.abs(y));
  }
  expect(peak).toBeGreaterThan(0.4); // it is actually displaced
  expect(peak).toBeLessThanOrEqual(AMPLITUDE);

  // normals must be recomputed after displacement, or the rolling ground is lit
  // as though it were still flat and the roll is invisible
  const nrm = geo.getAttribute("normal");
  let tilted = false;
  for (let i = 0; i < nrm.count; i++) {
    if (Math.abs(nrm.getY(i)) < 0.999) tilted = true;
  }
  expect(tilted).toBe(true);
});
