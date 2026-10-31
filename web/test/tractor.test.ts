import * as THREE from "three";
import { expect, test } from "vitest";
import {
  EDGE_X,
  headlandRoute,
  PASS_SECONDS,
  Tractor,
  TURN_OUT,
} from "../src/themes/farm/tractor.js";
import { FIELD, rowZ } from "../src/themes/farm/layout.js";

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

test("the next row starts after a headland U-turn instead of teleporting", () => {
  const tractor = new Tractor(new THREE.Scene());
  tractor.startRow(0, 0);
  tractor.update(PASS_SECONDS + 5); // parked at the +x end of row 0
  expect(tractor.isMoving(PASS_SECONDS + 5)).toBe(false);
  const t = PASS_SECONDS + 10;
  const passStart = tractor.startRow(1, t);
  expect(passStart).toBeGreaterThan(t);
  expect(passStart - t).toBeLessThan(3); // a short turn, not a long detour
  expect(tractor.isMoving(t + 0.1)).toBe(true);
  // it sets off from where it was parked, and swings out past the row end
  const begin = tractor.position(t)!;
  expect(begin.x).toBeCloseTo(EDGE_X, 3);
  expect(begin.z).toBeCloseTo(rowZ(0), 3);
  const mid = tractor.position((t + passStart) / 2)!;
  expect(mid.x).toBeGreaterThan(EDGE_X);
  // nothing on row 1 is plowed until the turn is done
  expect(tractor.hasPassed(1, EDGE_X - 1, passStart - 0.01)).toBe(false);
  expect(tractor.hasPassed(1, EDGE_X - 1, passStart + 1)).toBe(true);
  // and it comes out of the turn heading into the new row
  expect(tractor.position(passStart + 0.5)!.direction).toBe(-1);
});

test("a pass still running when the next block lands is finished, not jumped", () => {
  const tractor = new Tractor(new THREE.Scene());
  tractor.startRow(0, 0);
  const t = PASS_SECONDS / 2; // halfway along row 0
  const passStart = tractor.startRow(1, t);
  const begin = tractor.position(t)!;
  expect(begin.x).toBeCloseTo(0, 3); // still mid-row: no jump
  expect(begin.z).toBeCloseTo(rowZ(0), 3);
  // drives to the end of row 0 faster than plowing would
  expect(passStart - t).toBeLessThan(PASS_SECONDS / 2);
});

test("a replayed block parks the tractor at the far end with the row already plowed", () => {
  const tractor = new Tractor(new THREE.Scene());
  tractor.startRow(0, 0);
  const t = 30;
  const passStart = tractor.startRow(1, t, 3600);
  expect(passStart).toBeLessThanOrEqual(t - 3600);
  expect(tractor.isMoving(t)).toBe(false);
  expect(tractor.hasPassed(1, -20, t)).toBe(true);
  expect(tractor.position(t)!.x).toBeCloseTo(-EDGE_X, 3);
});

test("headland routes U-turn on the near side, or run an end headland when the row starts far away", () => {
  // row 0 (→) parked at +EDGE_X; row 1 (←) starts at +EDGE_X: same side
  const near = headlandRoute(EDGE_X, rowZ(0), 1, 1);
  expect(near[0]).toEqual([EDGE_X, rowZ(0)]);
  expect(near.at(-1)).toEqual([EDGE_X, rowZ(1)]);
  for (const [x] of near) expect(x).toBeGreaterThanOrEqual(EDGE_X);
  // a rewind by one: row 5 (←) again from its +x end, but its pass starts at −x
  const route = headlandRoute(-EDGE_X, rowZ(5), -1, 5);
  expect(route.at(-1)).toEqual([EDGE_X, rowZ(5)]);
  // the crossing runs along an end headland, outside every row
  const crossing = route.filter(([x]) => Math.abs(x) < EDGE_X);
  expect(crossing.length).toBe(0); // only the rounded corners are inside ±EDGE_X
  const zs = route.map(([, z]) => z);
  expect(Math.max(...zs) > rowZ(0) || Math.min(...zs) < rowZ(FIELD.rows - 1)).toBe(true);
  for (const [x] of route) expect(Math.abs(x)).toBeLessThanOrEqual(EDGE_X + TURN_OUT);
});

test("the parked tractor stops its wheels", () => {
  const tractor = new Tractor(new THREE.Scene());
  tractor.startRow(0, 0);
  tractor.update(PASS_SECONDS + 1);
  const wheel = tractor.group.children.find(
    (c) => c instanceof THREE.Mesh && c.geometry instanceof THREE.CylinderGeometry
  ) as THREE.Mesh;
  const angle = wheel.rotation.z;
  tractor.update(PASS_SECONDS + 3);
  expect(wheel.rotation.z).toBe(angle);
  // statics are merged per material: four wheels + five merged meshes
  expect(tractor.group.children.length).toBe(9);
});
