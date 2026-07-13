import { expect, test } from "vitest";
import { farTreeLineGeometry, hedgeGeometry } from "../src/themes/farm/scenery.js";
import { groundHeight } from "../src/themes/farm/terrain.js";
import { TURF_RADIUS } from "../src/themes/farm/layout.js";

// mergeGeometries returns null when its inputs mix indexed and non-indexed
// geometry; a null geometry crashes the renderer on the first frame.
test.each([
  ["hedge shrub", hedgeGeometry],
  ["far tree line", farTreeLineGeometry],
])("the %s geometry is valid and renderable", (_name, factory) => {
  const geometry = factory();
  expect(geometry).not.toBeNull();
  expect(geometry.getAttribute("position").count).toBeGreaterThan(0);
});

// The far tree line is scenery on the horizon: off the turf disc it floats over
// open sky, and on the disc it must sit on the ground rather than through it.
test("the far tree line stands on the turf, on the ground", () => {
  const pos = farTreeLineGeometry().getAttribute("position");
  let lowest = Infinity;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    expect(Math.hypot(x, z)).toBeLessThan(TURF_RADIUS);
    lowest = Math.min(lowest, pos.getY(i) - groundHeight(x, z));
  }
  // the lowest vertex of the whole line rests on, not below, the ground under it
  expect(lowest).toBeGreaterThanOrEqual(-0.01);
});
