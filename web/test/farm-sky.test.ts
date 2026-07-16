import { expect, test } from "vitest";
import { shadowOpacity } from "../src/themes/farm/sky.js";

// The cloud-shadow planes are flat and drift out to x = ±60, into the wings,
// where the ground rolls: a hummock would occlude part of a flat shadow, and a
// shadow that vanishes behind a rise reads as a bug. The flat zone ends at
// |x| = 26 and the ground is fully rolling by |x| ≈ 42, so a shadow must be gone
// well before it gets there.
test("cloud shadows are gone before they reach rolling ground", () => {
  expect(shadowOpacity(38)).toBe(0);
  expect(shadowOpacity(-38)).toBe(0);
  expect(shadowOpacity(60)).toBe(0);
  expect(shadowOpacity(-60)).toBe(0);
});

test("cloud shadows are at full strength over the field", () => {
  expect(shadowOpacity(0)).toBeGreaterThan(0.3);
  expect(shadowOpacity(24)).toBeGreaterThan(0.3);
  expect(shadowOpacity(-24)).toBeGreaterThan(0.3);
});

test("cloud shadow opacity is symmetric, monotone outward, and never negative", () => {
  let previous = Infinity;
  for (let x = 0; x <= 70; x += 1) {
    const o = shadowOpacity(x);
    expect(o).toBeCloseTo(shadowOpacity(-x), 6);
    expect(o).toBeGreaterThanOrEqual(0);
    expect(o).toBeLessThanOrEqual(previous + 1e-9);
    previous = o;
  }
});
