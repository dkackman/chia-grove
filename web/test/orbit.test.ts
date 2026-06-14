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

test("update does not change the offset", () => {
  const s = new OrbitState();
  s.accumulate(1.0);
  s.update(2.0, 2.0);
  expect(s.offset).toBeCloseTo(1.0);
});

test("after release, offset persists at the released position", () => {
  const s = new OrbitState();
  s.accumulate(1.0);
  s.release();
  s.update(1.0, 2.0);
  expect(s.offset).toBeCloseTo(1.0); // no snap-back
});

test("offset persists unchanged after release and many updates", () => {
  const s = new OrbitState();
  s.accumulate(1.0);
  s.release();
  for (let i = 0; i < 300; i++) s.update(1 / 60, 2.0);
  expect(s.offset).toBeCloseTo(1.0); // no decay
});

test("subsequent drags accumulate onto the persistent offset", () => {
  const s = new OrbitState();
  s.accumulate(1.0);
  s.release();
  s.accumulate(0.5); // second drag stacks on top
  s.update(1.0, 2.0);
  expect(s.offset).toBeCloseTo(1.5);
});

test("release on zero offset is a no-op", () => {
  const s = new OrbitState();
  s.release();
  s.update(1.0, 2.0);
  expect(s.offset).toBe(0);
});
