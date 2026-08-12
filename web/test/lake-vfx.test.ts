import * as THREE from "three";
import { expect, test } from "vitest";
import { Vfx } from "../src/themes/lake/vfx.js";
import { SURFACE_Y } from "../src/themes/lake/water.js";

test("mempool size controls how many bubbles are drawn", () => {
  const vfx = new Vfx(new THREE.Scene());

  vfx.setMempool(0);
  expect(vfx.bubbleCount()).toBe(0);

  vfx.setMempool(10);
  const quiet = vfx.bubbleCount();
  expect(quiet).toBeGreaterThan(0);

  vfx.setMempool(500);
  expect(vfx.bubbleCount()).toBeGreaterThan(quiet);
});

test("bubble count is capped so a mempool spike cannot exceed the buffer", () => {
  const vfx = new Vfx(new THREE.Scene());
  vfx.setMempool(1e9);
  expect(vfx.bubbleCount()).toBeLessThanOrEqual(400);
});

test("bubbles rise and wrap back to the bed instead of escaping", () => {
  const vfx = new Vfx(new THREE.Scene());
  vfx.setMempool(500);
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
