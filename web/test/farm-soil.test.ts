import * as THREE from "three";
import { expect, test } from "vitest";
import { plowReachedAt, soilWetness, WET_SECONDS } from "../src/themes/farm/soil.js";
import { EDGE_X, PASS_SECONDS, Tractor } from "../src/themes/farm/tractor.js";
import { FIELD } from "../src/themes/farm/layout.js";

// The soil shader reveals a row where plowReachedAt() says the plow has been;
// the crops sprout where Tractor.hasPassed() says it has. If the two drift apart
// crops appear on bare turf, or soil opens up ahead of the tractor.
test("the soil is turned exactly where the tractor has passed", () => {
  const tractor = new Tractor(new THREE.Scene(), true);
  for (const row of [4, 5]) {
    const start = 100;
    tractor.startRow(row, start);
    const direction = row % 2 === 0 ? 1 : -1;
    for (let x = -FIELD.rowLength / 2; x <= FIELD.rowLength / 2; x += 1.7) {
      const reached = plowReachedAt(start, direction, x);
      expect(reached).toBeGreaterThanOrEqual(start);
      expect(reached).toBeLessThanOrEqual(start + PASS_SECONDS);
      expect(tractor.hasPassed(row, x, reached + 1e-3)).toBe(true);
      if (reached - 1e-3 > start) expect(tractor.hasPassed(row, x, reached - 1e-3)).toBe(false);
    }
  }
});

test("a pass sweeps from one headland to the other", () => {
  expect(plowReachedAt(0, 1, -EDGE_X)).toBe(0);
  expect(plowReachedAt(0, 1, EDGE_X)).toBe(PASS_SECONDS);
  expect(plowReachedAt(0, -1, EDGE_X)).toBe(0);
  expect(plowReachedAt(0, -1, -EDGE_X)).toBe(PASS_SECONDS);
});

test("fresh soil starts wet and dries out over the next few blocks", () => {
  expect(soilWetness(0)).toBe(1);
  expect(soilWetness(-5)).toBe(0);
  expect(soilWetness(WET_SECONDS)).toBeCloseTo(1 / Math.E, 6);
  // a block is ~52 s: the previous row is still visibly damp, four back is dry
  expect(soilWetness(52)).toBeGreaterThan(0.4);
  expect(soilWetness(4 * 52)).toBeLessThan(0.06);
});
