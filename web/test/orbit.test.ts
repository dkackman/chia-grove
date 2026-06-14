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

test("accumulate handles negative deltas", () => {
  const s = new OrbitState();
  s.accumulate(1.0);
  s.accumulate(-0.4);
  expect(s.offset).toBeCloseTo(0.6);
});

test("offset persists across many accumulations (no decay)", () => {
  const s = new OrbitState();
  for (let i = 0; i < 10; i++) s.accumulate(0.1);
  expect(s.offset).toBeCloseTo(1.0);
});
