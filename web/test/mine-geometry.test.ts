import * as THREE from "three";
import { expect, test } from "vitest";
import { groundGeometry } from "../src/themes/mine/island.js";

test("ground geometry is a valid renderable cube", () => {
  const g = groundGeometry();
  expect(g).toBeInstanceOf(THREE.BufferGeometry);
  expect(g.getAttribute("position").count).toBeGreaterThan(0);
});
