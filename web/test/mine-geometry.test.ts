import * as THREE from "three";
import { expect, test } from "vitest";
import { groundGeometry } from "../src/themes/mine/island.js";

test("ground geometry is a valid renderable cube", () => {
  const g = groundGeometry();
  expect(g).toBeInstanceOf(THREE.BufferGeometry);
  expect(g.getAttribute("position").count).toBeGreaterThan(0);
});

import { cubeGeometry } from "../src/themes/mine/cats.js";

test("cat cube geometry is a valid renderable cube", () => {
  const g = cubeGeometry();
  expect(g.getAttribute("position").count).toBeGreaterThan(0);
});
