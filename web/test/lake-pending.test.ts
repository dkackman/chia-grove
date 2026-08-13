import * as THREE from "three";
import { expect, test } from "vitest";
import { Pending, litCount, churnRate } from "../src/themes/lake/pending.js";
import { PENDING_Y_MIN, PENDING_Y_MAX, TOP_BAND_Y } from "../src/themes/lake/layout.js";

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

test("a block releases silhouettes, which sink past the newest band and vanish", () => {
  const pending = new Pending(new THREE.Scene(), 100);
  pending.setMempool(5000, String(5000 * 1e7));
  expect(pending.release(20, 0)).toBe(20);
  expect(pending.falling()).toBe(20);

  const m = new THREE.Matrix4();
  const v = new THREE.Vector3();
  const firstFalling = pending.fallSlotIndex(0);
  pending.update(0.05, 0.05);
  pending.mesh.getMatrixAt(firstFalling, m);
  const early = v.setFromMatrixPosition(m).y;

  for (let step = 2; step <= 12; step++) pending.update(0.1, step * 0.1);
  pending.mesh.getMatrixAt(firstFalling, m);
  const late = v.setFromMatrixPosition(m).y;

  expect(late).toBeLessThan(early);
  expect(late).toBeLessThanOrEqual(TOP_BAND_Y);

  // the descent finishes and the slots return to the pool
  for (let step = 13; step <= 60; step++) pending.update(0.1, step * 0.1);
  expect(pending.falling()).toBe(0);
});

test("a release visibly drains the churn layer by the released count", () => {
  const pending = new Pending(new THREE.Scene(), 100);
  pending.setMempool(5000, String(5000 * 1e7));
  expect(pending.lit()).toBe(100);
  expect(pending.release(30, 0)).toBe(30);
  // detaches, not duplicates: the layer thins while the silhouettes fall
  expect(pending.lit()).toBe(70);
  // the next ambient snapshot restores truth from the real mempool size
  pending.setMempool(5000, String(5000 * 1e7));
  expect(pending.lit()).toBe(100);
});

test("released fall slots carry distinct swim phases — churn, not a parade", () => {
  const pending = new Pending(new THREE.Scene(), 10);
  const phase = pending.mesh.geometry.getAttribute("aSwimPhase") as THREE.BufferAttribute;
  const seen = new Set<number>();
  for (let n = 0; n < 8; n++) seen.add(phase.getX(pending.fallSlotIndex(n)));
  expect(seen.size).toBeGreaterThan(1);
  for (const p of seen) expect(p).not.toBe(0);
});

test("a block bigger than the mempool releases what there is and no more", () => {
  const pending = new Pending(new THREE.Scene(), 100);
  pending.setMempool(250, String(250 * 1e7)); // 5 lit
  expect(pending.lit()).toBe(5);
  expect(pending.release(400, 0)).toBe(5);
  expect(pending.falling()).toBe(5);
});

test("releasing from an empty mempool is a no-op, not a crash", () => {
  const pending = new Pending(new THREE.Scene(), 100);
  pending.setMempool(0, "0");
  expect(pending.release(30, 0)).toBe(0);
  expect(pending.falling()).toBe(0);
});
