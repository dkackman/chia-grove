import { expect, test } from "vitest";
import { CANVAS_SIZE, toPx } from "../src/themes/farm/landscape.js";
import { TURF_RADIUS } from "../src/themes/farm/layout.js";

// The overlay rides the turf's RingGeometry UVs, which span the disc's bounding
// square: u = (x / 140 + 1) / 2 and v = (−z / 140 + 1) / 2. CanvasTexture flips
// v, and that flip cancels the sign, so the canvas is a plain north-up map —
// x = −140 at the left edge, z = −140 (the hills) at the top — and one toPx()
// serves both axes. Getting this backwards paints the barnyard on the wrong side
// of the field, so it is pinned here rather than discovered on screen.
test("toPx maps the disc's bounding square onto the canvas", () => {
  expect(toPx(-TURF_RADIUS)).toBe(0);
  expect(toPx(TURF_RADIUS)).toBe(CANVAS_SIZE);
  expect(toPx(0)).toBe(CANVAS_SIZE / 2);
});

test("toPx is linear and increasing", () => {
  const scale = CANVAS_SIZE / (TURF_RADIUS * 2);
  expect(toPx(10) - toPx(0)).toBeCloseTo(10 * scale, 6);
  expect(toPx(-30) - toPx(-40)).toBeCloseTo(10 * scale, 6);
});
