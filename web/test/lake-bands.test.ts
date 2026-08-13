import * as THREE from "three";
import { expect, test } from "vitest";
import type { BlockEvent } from "@grove/shared";
import { Bands, ringBrightness, feeWarmth, labelOpacity } from "../src/themes/lake/bands.js";
import { MAX_BANDS, RIM_RADIUS, bandDepth } from "../src/themes/lake/layout.js";

const block = (height: number, spendCount = 10, fees = "0"): BlockEvent => ({
  type: "block",
  height,
  headerHash: height.toString(16).padStart(64, "0"),
  timestamp: 1_700_000_000 + height,
  spendCount,
  fees,
});

test("busier blocks get brighter rings, bounded at both ends", () => {
  expect(ringBrightness(0)).toBeGreaterThan(0);
  expect(ringBrightness(500)).toBeLessThanOrEqual(1);
  expect(ringBrightness(50)).toBeGreaterThan(ringBrightness(5));
  expect(ringBrightness(NaN)).toBeGreaterThan(0);
  expect(Number.isFinite(ringBrightness(-3))).toBe(true);
});

test("fee-heavy blocks shade warm, bounded, and junk fees read as zero", () => {
  expect(feeWarmth("0")).toBe(0);
  expect(feeWarmth("")).toBe(0);
  expect(feeWarmth("not-a-number")).toBe(0);
  expect(feeWarmth("100000000000")).toBeLessThanOrEqual(1);
  expect(feeWarmth("10000000000")).toBeGreaterThan(feeWarmth("1000000"));
});

test("fees in the range blocks actually carry get a visible warmth spread", () => {
  // the demo feed's observed span, 7.3e7–9e8 mojos — a 12× fee spread must
  // not collapse into a hair's width of warmth the way the shipped curve did
  const low = feeWarmth("73000000");
  const high = feeWarmth("900000000");
  expect(high - low).toBeGreaterThan(0.3);
  expect(low).toBeGreaterThan(0);
  expect(high).toBeLessThanOrEqual(1);
});

test("one ring per block, wrapping at the column depth", () => {
  const bands = new Bands(new THREE.Scene());
  for (let h = 0; h < MAX_BANDS + 5; h++) bands.push(block(h), h);
  expect(bands.count()).toBe(MAX_BANDS);
  // the oldest entries were overwritten, not the newest
  const heights = Array.from({ length: MAX_BANDS }, (_, i) => bands.entryAt(i)?.height);
  expect(Math.max(...(heights as number[]))).toBe(MAX_BANDS + 4);
});

test("rings sit at their band's depth and sink as blocks arrive", () => {
  const scene = new THREE.Scene();
  const bands = new Bands(scene);
  bands.push(block(100), 1);
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(40, -30, 0);

  const yAt = (blocksSmooth: number) => {
    bands.update(blocksSmooth, camera);
    const m = new THREE.Matrix4();
    bands.mesh.getMatrixAt(0, m);
    return new THREE.Vector3().setFromMatrixPosition(m).y;
  };

  expect(yAt(1)).toBeCloseTo(bandDepth(0), 4);
  expect(yAt(4)).toBeCloseTo(bandDepth(3), 4);
  expect(yAt(4)).toBeLessThan(yAt(1));
});

test("rings ring the creature annulus rather than sitting inside it", () => {
  const bands = new Bands(new THREE.Scene());
  const box = new THREE.Box3().setFromBufferAttribute(
    bands.mesh.geometry.getAttribute("position") as THREE.BufferAttribute
  );
  expect(box.max.x).toBeCloseTo(RIM_RADIUS, 0);
  expect(box.max.y).toBeLessThan(1); // lies flat, not standing up
});

test("a reorg drops the orphaned bands and shrinks the draw count", () => {
  const scene = new THREE.Scene();
  const bands = new Bands(scene);
  for (let h = 100; h < 105; h++) bands.push(block(h), h - 99);
  bands.clearAbove(103);
  expect(bands.count()).toBe(3);
  expect(bands.mesh.count).toBeLessThanOrEqual(3);
});

test("a cap of 1 forces a wrap on the second block", () => {
  const bands = new Bands(new THREE.Scene(), 1);
  bands.push(block(1), 1);
  bands.push(block(2), 2);
  expect(bands.count()).toBe(1);
  expect(bands.entryAt(0)?.height).toBe(2);
});

test("only the newest bands are labelled", () => {
  expect(labelOpacity(0)).toBe(1);
  expect(labelOpacity(6)).toBe(0);
  expect(labelOpacity(2)).toBeGreaterThan(0);
  expect(labelOpacity(2)).toBeLessThanOrEqual(1);
  expect(labelOpacity(-1)).toBe(1); // smoothed counter can dip below zero
});

test("labels ride the near edge of the ring as the camera orbits", () => {
  const bands = new Bands(new THREE.Scene());
  bands.push(block(4200), 1);
  const camera = new THREE.PerspectiveCamera();

  camera.position.set(40, -20, 0);
  bands.update(1, camera);
  const east = bands.labelPosition(0).clone();

  camera.position.set(0, -20, 40);
  bands.update(1, camera);
  const north = bands.labelPosition(0).clone();

  expect(east.x).toBeGreaterThan(east.z);
  expect(north.z).toBeGreaterThan(north.x);
  // always just outside the ring, never inside the creature annulus
  expect(Math.hypot(east.x, east.z)).toBeGreaterThan(RIM_RADIUS);
});

test("a culled band takes its label with it", () => {
  const bands = new Bands(new THREE.Scene());
  bands.push(block(100), 1);
  expect(bands.labelVisible(0)).toBe(true);
  bands.clearAbove(100);
  expect(bands.labelVisible(0)).toBe(false);
});
