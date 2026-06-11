import { expect, test } from "vitest";
import { bloomGeometries, grassGeometries, mushroomGeometries } from "../src/themes/grove/flora.js";

// mergeGeometries returns null when inputs mix indexed and non-indexed
// geometries; a null geometry crashes the renderer on the first frame.
test.each([
  ["grass", grassGeometries],
  ["mushroom", mushroomGeometries],
  ["bloom", bloomGeometries],
])("every %s geometry variant is valid and renderable", (_name, factory) => {
  const geometries = factory();
  expect(geometries.length).toBeGreaterThan(1);
  for (const geometry of geometries) {
    expect(geometry).not.toBeNull();
    expect(geometry.getAttribute("position").count).toBeGreaterThan(0);
  }
});
