import * as THREE from "three";
import { expect, test } from "vitest";
import { Pending, litCount, churnRate } from "../src/themes/lake/pending.js";
import { PENDING_Y_MIN, PENDING_Y_MAX } from "../src/themes/lake/layout.js";

test("lit silhouettes scale with mempool size and clamp at the cap", () => {
  expect(litCount(0, 600)).toBe(0);
  expect(litCount(5000, 600)).toBe(600);
  expect(litCount(2500, 600)).toBe(300);
  expect(litCount(99999, 600)).toBe(600);
  expect(litCount(-5, 600)).toBe(0);
  expect(litCount(NaN, 600)).toBe(0);
});

test("congestion turns into agitation, never into stillness", () => {
  const calm = churnRate(1000, String(1000 * 1e7));
  const congested = churnRate(1000, String(1000 * 5e8));
  expect(congested).toBeGreaterThan(calm);
  expect(calm).toBeGreaterThanOrEqual(0.5);
  expect(churnRate(0, "0")).toBeGreaterThanOrEqual(0.5);
  expect(Number.isFinite(churnRate(0, "500"))).toBe(true);
  expect(Number.isFinite(churnRate(NaN, "not-a-number"))).toBe(true);
  expect(churnRate(NaN, "not-a-number")).toBeGreaterThanOrEqual(0.5);
  expect(churnRate(1000, "")).toBeGreaterThanOrEqual(0.5);
});

test("silhouettes churn inside the layer, never in a band or above the surface", () => {
  const pending = new Pending(new THREE.Scene(), 40);
  pending.setMempool(5000, String(5000 * 1e7));
  const m = new THREE.Matrix4();
  const v = new THREE.Vector3();
  for (let step = 0; step < 40; step++) {
    pending.update(0.05, step * 0.05);
    for (let i = 0; i < pending.lit(); i++) {
      pending.mesh.getMatrixAt(i, m);
      v.setFromMatrixPosition(m);
      expect(v.y).toBeGreaterThanOrEqual(PENDING_Y_MIN - 0.6);
      expect(v.y).toBeLessThanOrEqual(PENDING_Y_MAX + 0.6);
    }
  }
});

test("a shrinking mempool unlights silhouettes", () => {
  const pending = new Pending(new THREE.Scene(), 600);
  pending.setMempool(5000, String(5000 * 1e7));
  expect(pending.lit()).toBe(600);
  pending.setMempool(500, String(500 * 1e7));
  expect(pending.lit()).toBe(60);
});

test("the layer is deterministic across rebuilds", () => {
  const read = () => {
    const p = new Pending(new THREE.Scene(), 20);
    p.setMempool(5000, String(5000 * 1e7));
    p.update(0.05, 1.0);
    const m = new THREE.Matrix4();
    p.mesh.getMatrixAt(3, m);
    return new THREE.Vector3().setFromMatrixPosition(m).toArray();
  };
  expect(read()).toEqual(read());
});
