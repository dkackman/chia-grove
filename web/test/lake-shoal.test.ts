import * as THREE from "three";
import { expect, test } from "vitest";
import type { SproutEvent } from "@grove/shared";
import { Shoal } from "../src/themes/lake/shoal.js";
import { bandDepth, TOP_BAND_Y } from "../src/themes/lake/layout.js";

const id = (n: number) => n.toString(16).padStart(8, "0") + "00".repeat(28);
const xch = (coinId: string, height = 1): SproutEvent => ({
  type: "sprout",
  kind: "xch",
  height,
  coinId,
  amount: "1000000000000",
});

const yOf = (shoal: Shoal, index: number): number => {
  const m = new THREE.Matrix4();
  shoal.mesh.getMatrixAt(index, m);
  return new THREE.Vector3().setFromMatrixPosition(m).y;
};

test("a planted fish is retrievable by instance index", () => {
  const shoal = new Shoal(new THREE.Scene(), 0xffffff);
  shoal.plant(xch(id(1)), 0, 1, null);
  expect(shoal.metaAt(0)?.coinId).toBe(id(1));
  expect(shoal.metaAt(1)).toBeNull();
});

test("the pool wraps at its cap, overwriting the oldest fish", () => {
  const shoal = new Shoal(new THREE.Scene(), 0xffffff, 2);
  shoal.plant(xch(id(1)), 0, 1, null);
  shoal.plant(xch(id(2)), 0, 1, null);
  shoal.plant(xch(id(3)), 0, 1, null); // wraps onto slot 0
  expect(shoal.metaAt(0)?.coinId).toBe(id(3));
  expect(shoal.metaAt(1)?.coinId).toBe(id(2));
});

test("only planted slots are drawn", () => {
  const shoal = new Shoal(new THREE.Scene(), 0xffffff, 100);
  expect(shoal.mesh.count).toBe(0);
  shoal.plant(xch(id(1)), 0, 1, null);
  expect(shoal.mesh.count).toBe(1);
});

test("clearAbove removes fish at or above the fork height and keeps the rest", () => {
  const shoal = new Shoal(new THREE.Scene(), 0xffffff);
  shoal.plant(xch(id(1), 10), 0, 1, null);
  shoal.plant(xch(id(2), 12), 0, 1, null);
  shoal.clearAbove(12);
  expect(shoal.metaAt(0)?.coinId).toBe(id(1));
  expect(shoal.metaAt(1)).toBeNull();
});

test("clearAbove shrinks the draw count so dead tail slots stop rendering", () => {
  const shoal = new Shoal(new THREE.Scene(), 0xffffff);
  shoal.plant(xch(id(1), 10), 0, 1, null);
  shoal.plant(xch(id(2), 20), 0, 1, null);
  expect(shoal.mesh.count).toBe(2);
  shoal.clearAbove(20);
  expect(shoal.mesh.count).toBe(1);
});

test("a fresh fish swims in the top band", () => {
  const shoal = new Shoal(new THREE.Scene(), 0xffffff);
  shoal.plant(xch(id(7)), 0, 1, null);
  // past ENTRY_SECONDS so the entry envelope has finished resolving
  shoal.update(1, 0);
  // bob is up to ±0.35 around the band depth
  expect(yOf(shoal, 0)).toBeGreaterThan(TOP_BAND_Y - 0.4);
  expect(yOf(shoal, 0)).toBeLessThan(TOP_BAND_Y + 0.4);
});

test("a fish sinks as blocks accumulate above it", () => {
  const shoal = new Shoal(new THREE.Scene(), 0xffffff);
  shoal.plant(xch(id(7)), 0, 1, null);
  shoal.update(0, 0);
  const fresh = yOf(shoal, 0);
  shoal.update(0, 10);
  const aged = yOf(shoal, 0);
  expect(aged).toBeLessThan(fresh);
  expect(aged - fresh).toBeCloseTo(bandDepth(10) - bandDepth(0), 5);
});

test("pickables are exposed only once something is planted", () => {
  const shoal = new Shoal(new THREE.Scene(), 0xffffff);
  expect(shoal.pickables()).toHaveLength(0);
  shoal.plant(xch(id(1)), 0, 1, null);
  expect(shoal.pickables()).toEqual([shoal.mesh]);
  expect(shoal.metaFor(shoal.mesh, 0)?.coinId).toBe(id(1));
  expect(shoal.metaFor(new THREE.Mesh(), 0)).toBeNull();
});

test("a fractional block counter puts the fish between bands", () => {
  const shoal = new Shoal(new THREE.Scene(), 0xffffff);
  shoal.plant(xch(id(7)), 0, 1, null);
  // past ENTRY_SECONDS so the entry envelope has finished resolving
  shoal.update(1, 0.5);
  const y = yOf(shoal, 0);
  expect(y).toBeLessThan(bandDepth(0) + 0.4);
  expect(y).toBeGreaterThan(bandDepth(1) - 0.4);
});

test("fish paths wander rather than tracing a fixed circle", () => {
  const shoal = new Shoal(new THREE.Scene(), 0xffffff);
  shoal.plant(xch(id(7)), 0, 1, null);
  const radii = new Set<number>();
  const m = new THREE.Matrix4();
  const v = new THREE.Vector3();
  for (let t = 0; t < 60; t += 1) {
    shoal.update(t, 0);
    shoal.mesh.getMatrixAt(0, m);
    v.setFromMatrixPosition(m);
    radii.add(Math.round(Math.hypot(v.x, v.z) * 100));
  }
  expect(radii.size).toBeGreaterThan(3);
});

test("school members of one spend swim near each other", () => {
  const shoal = new Shoal(new THREE.Scene(), 0xffffff);
  shoal.plant(xch(id(4)), 0, 1, null, 0);
  shoal.plant(xch(id(4)), 0, 1, null, 1);
  shoal.update(0, 0);
  const m = new THREE.Matrix4();
  shoal.mesh.getMatrixAt(0, m);
  const a = new THREE.Vector3().setFromMatrixPosition(m);
  shoal.mesh.getMatrixAt(1, m);
  const b = new THREE.Vector3().setFromMatrixPosition(m);
  expect(a.distanceTo(b)).toBeLessThan(4);
  expect(a.distanceTo(b)).toBeGreaterThan(0);
});

test("a planted fish scales up into its band rather than popping in", () => {
  const scene = new THREE.Scene();
  const shoal = new Shoal(scene, 0xffffff, 4);
  shoal.plant(xch("aa".repeat(32), 100), 1, 1.0, null, 0, 10);

  const m = new THREE.Matrix4();
  const scale = new THREE.Vector3();
  const position = new THREE.Vector3();

  // sample just past entryAge 0, not at it: a matrix scaled to exactly (0,0,0)
  // is singular, and THREE.Matrix4.decompose() can't read a singular matrix's
  // scale back out (it falls back to reporting (1,1,1)) — 0.05s in is still
  // far below the 0.1 threshold below, but keeps the matrix invertible.
  shoal.update(10.05, 1);
  shoal.mesh.getMatrixAt(0, m);
  m.decompose(position, new THREE.Quaternion(), scale);
  const startScale = scale.x;
  const startY = position.y;

  shoal.update(11, 1); // a full second later — the entry has finished
  shoal.mesh.getMatrixAt(0, m);
  m.decompose(position, new THREE.Quaternion(), scale);

  expect(startScale).toBeLessThan(0.1);
  expect(scale.x).toBeCloseTo(1.0, 2);
  expect(position.y).toBeLessThan(startY); // settled down into the band
});

test("the entry envelope is idempotent across repeated updates", () => {
  const shoal = new Shoal(new THREE.Scene(), 0xffffff, 4);
  shoal.plant(xch("bb".repeat(32), 100), 1, 1.0, null, 0, 0);
  const read = () => {
    shoal.update(5, 1);
    const m = new THREE.Matrix4();
    shoal.mesh.getMatrixAt(0, m);
    return new THREE.Vector3().setFromMatrixPosition(m).toArray();
  };
  expect(read()).toEqual(read());
});
