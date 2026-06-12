import { expect, test } from "vitest";
import {
  gourdGeometries,
  scarecrowGeometries,
  sunflowerGeometries,
  wheatGeometries,
} from "../src/themes/farm/crops.js";

// mergeGeometries returns null when inputs mix indexed and non-indexed
// geometries; a null geometry crashes the renderer on the first frame.
test.each([
  ["wheat", wheatGeometries],
  ["gourd", gourdGeometries],
  ["sunflower", sunflowerGeometries],
  ["scarecrow", scarecrowGeometries],
])("every %s geometry variant is valid and renderable", (_name, factory) => {
  const geometries = factory();
  expect(geometries.length).toBe(3);
  for (const geometry of geometries) {
    expect(geometry).not.toBeNull();
    expect(geometry.getAttribute("position").count).toBeGreaterThan(0);
  }
});
