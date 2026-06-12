import * as THREE from "three";
import { expect, test } from "vitest";
import { PASS_SECONDS, Tractor } from "../src/themes/farm/tractor.js";

test("crops behind the tractor are passed, ahead are not", () => {
  const tractor = new Tractor(new THREE.Scene());
  tractor.startRow(0, 100); // even row: drives left → right
  const mid = 100 + PASS_SECONDS / 2;
  expect(tractor.hasPassed(0, -20, mid)).toBe(true);
  expect(tractor.hasPassed(0, 20, mid)).toBe(false);
  expect(tractor.hasPassed(0, 20, 100 + PASS_SECONDS + 0.1)).toBe(true);
});

test("odd rows drive right to left", () => {
  const tractor = new Tractor(new THREE.Scene());
  tractor.startRow(1, 0);
  expect(tractor.hasPassed(1, 20, PASS_SECONDS / 2)).toBe(true);
  expect(tractor.hasPassed(1, -20, PASS_SECONDS / 2)).toBe(false);
});

test("rows other than the current one are always passed (replay compression)", () => {
  const tractor = new Tractor(new THREE.Scene());
  tractor.startRow(3, 50);
  expect(tractor.hasPassed(2, 0, 50)).toBe(true);
  expect(tractor.hasPassed(99, 0, 50)).toBe(true);
});
