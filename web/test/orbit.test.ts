import { expect, test } from "vitest";
import { OrbitState } from "../src/themes/shared/orbit.js";

test("offset starts at zero", () => {
  const s = new OrbitState();
  expect(s.offset).toBe(0);
});

test("accumulate increases offset by the given radians", () => {
  const s = new OrbitState();
  s.accumulate(0.5);
  expect(s.offset).toBeCloseTo(0.5);
  s.accumulate(0.3);
  expect(s.offset).toBeCloseTo(0.8);
});

test("update before release does not decay the offset", () => {
  const s = new OrbitState();
  s.accumulate(1.0);
  s.update(2.0, 2.0); // 2 seconds at returnSpeed 2 — no release yet
  expect(s.offset).toBeCloseTo(1.0);
});

test("after release, update decays offset exponentially", () => {
  const s = new OrbitState();
  s.accumulate(1.0);
  s.release();
  s.update(1.0, 2.0); // 1 second at returnSpeed 2.0
  // expected: 1.0 * e^(-2) ≈ 0.1353
  expect(s.offset).toBeCloseTo(Math.E ** -2, 3);
});

test("offset settles to exactly zero after sufficient updates", () => {
  const s = new OrbitState();
  s.accumulate(1.0);
  s.release();
  // 300 frames at ~16ms ≈ 5 seconds; 1.0 * e^(-10) ≈ 4.5e-5 < threshold
  for (let i = 0; i < 300; i++) s.update(1 / 60, 2.0);
  expect(s.offset).toBe(0);
});

test("accumulating during easing cancels the easing and adds to offset", () => {
  const s = new OrbitState();
  s.accumulate(1.0);
  s.release();
  s.accumulate(0.5); // user drags again mid-ease
  s.update(1.0, 2.0); // should NOT decay — easing was cancelled by accumulate
  expect(s.offset).toBeCloseTo(1.5);
});

test("release on zero offset does not start easing", () => {
  const s = new OrbitState();
  s.release(); // offset is 0, nothing to ease
  s.update(1.0, 2.0); // should be a no-op
  expect(s.offset).toBe(0);
});
