import { expect, test } from "vitest";
import { AMPLITUDE, FAR_HILLS, FLAT, groundHeight, HILLS } from "../src/themes/farm/terrain.js";
import { FIELD, rowZ, TURF_RADIUS } from "../src/themes/farm/layout.js";

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
