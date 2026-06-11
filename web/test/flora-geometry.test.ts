import { expect, test } from "vitest";
import {
  bloomGeometry,
  grassGeometry,
  mushroomGeometry,
} from "../src/scene/flora.js";

// mergeGeometries returns null when inputs mix indexed and non-indexed
// geometries; a null geometry crashes the renderer on the first frame.
test.each([
  ["grass", grassGeometry],
  ["mushroom", mushroomGeometry],
  ["bloom", bloomGeometry],
])("%s geometry is valid and renderable", (_name, factory) => {
  const geometry = factory();
  expect(geometry).not.toBeNull();
  expect(geometry.getAttribute("position").count).toBeGreaterThan(0);
});
