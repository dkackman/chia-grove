import * as THREE from "three";
import { expect, test } from "vitest";
import { Vfx } from "../src/themes/lake/vfx.js";
import { SURFACE_Y } from "../src/themes/lake/water.js";

test("bubbles run at a fixed nonzero density with no setMempool() call", () => {
  // bubbles are scenery now, not data — the mempool moved to the churn layer
  // in pending.ts. A fresh Vfx seeds a steady density in its constructor, so
  // highestBubbleY() is already meaningful (not -Infinity) before any update.
  const vfx = new Vfx(new THREE.Scene());
  expect(vfx.highestBubbleY()).toBeGreaterThan(-Infinity);
  expect(vfx.highestBubbleY()).toBeLessThanOrEqual(SURFACE_Y);
});

test("bubbles rise and wrap back to the bed instead of escaping", () => {
  const vfx = new Vfx(new THREE.Scene());
  // run well past the time it takes a bubble to cross the whole column
  for (let i = 0; i < 3000; i++) vfx.update(0.016, i * 0.016);
  expect(vfx.highestBubbleY()).toBeLessThanOrEqual(SURFACE_Y);
});

test("a mint fires a beacon that fades out on its own", () => {
  const vfx = new Vfx(new THREE.Scene());
  expect(vfx.activeBeacons()).toBe(0);
  vfx.beacon(12, 0);
  expect(vfx.activeBeacons()).toBe(1);
  for (let i = 0; i < 200; i++) vfx.update(0.016, i * 0.016);
  expect(vfx.activeBeacons()).toBe(0);
});

test("a reorg strike runs and finishes without a renderer", () => {
  const vfx = new Vfx(new THREE.Scene());
  vfx.strike(0);
  expect(() => {
    for (let i = 0; i < 200; i++) vfx.update(0.016, i * 0.016);
  }).not.toThrow();
});

test("the strike sweeps an S-curve from the centerline", () => {
  const vfx = new Vfx(new THREE.Scene());
  vfx.strike(0);
  const zs: number[] = [];
  for (let i = 0; i < 140; i++) {
    vfx.update(0.016, i * 0.016);
    zs.push(vfx.predatorZ());
  }
  // an S-curve enters on the centerline and swings to both sides;
  // the old path entered at z ≈ +5 (cos starts at 1)
  expect(Math.abs(zs[0])).toBeLessThan(1.5);
  expect(Math.min(...zs)).toBeLessThan(-2);
  expect(Math.max(...zs)).toBeGreaterThan(2);
});
