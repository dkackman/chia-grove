import { expect, test } from "vitest";
import {
  CANVAS_SIZE,
  FIELD_CLEAR,
  distanceToLane,
  nearLane,
  toPx,
} from "../src/themes/farm/landscape.js";
import { FIELD, TURF_RADIUS, rowZ } from "../src/themes/farm/layout.js";

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

// The crop rows are the subject of the scene and nothing may be painted under them.
// landscapeTexture() guarantees this by erasing the field's footprint from the canvas
// as its last step; this pins the erased box against the soil strips it must cover,
// with margin for the cut's own blurred edge — not an arbitrary constant. The cut is
// blurred with a 5px CSS filter; a canvas <blur> filter's Gaussian stdDeviation is
// half its pixel argument (2.5px here), and 3 standard deviations is where a blurred
// hard edge is, for practical purposes, fully faded (~99.7%) — see landscapeTexture's
// own comment on the same arithmetic for the erase-vs-survive tradeoff at the lane.
test("the cleared field box covers the soil strips' true extent plus the blurred cut's feather reach", () => {
  const stripHalfX = FIELD.rowLength / 2 + 0.7; // strips are rowLength + 1.4 wide
  const stripHalfZ = Math.abs(rowZ(0)) + (FIELD.rowSpacing * 0.78) / 2;
  const pxPerWorldUnit = CANVAS_SIZE / (TURF_RADIUS * 2);
  const cutBlurPx = 5;
  const sigmaWorld = cutBlurPx / 2 / pxPerWorldUnit;
  const featherReach = 3 * sigmaWorld;
  expect(FIELD_CLEAR.halfX).toBeGreaterThan(stripHalfX + featherReach);
  expect(FIELD_CLEAR.halfZ).toBeGreaterThan(stripHalfZ + featherReach);
});

// FIX 3: at the barn doors (the lane's first control point, x = -9, which sits
// within the barn's own x-footprint) the lane's dust band must clear the barn's
// front wall behind it and the field's soil strip in front of it. The old control
// point ([-9, -21.3]) put the band's near edge inside the far soil strip; this pins
// the new one ([-9, -22.4]) between the two solid things on either side of it.
test("the lane's band at the barn doors sits between the barn wall and the soil strip", () => {
  const barnFrontWall = -23.675;
  const stripOuterEdge = -(Math.abs(rowZ(0)) + (FIELD.rowSpacing * 0.78) / 2); // ~ -20.31
  const [, z] = [-9, -22.4] as const; // LANE's first control point
  const laneHalfWidth = 1.2; // the dust band is drawn 2.4 world units wide
  const nearEdge = z + laneHalfWidth; // toward the field
  const farEdge = z - laneHalfWidth; // toward the barn wall
  expect(nearEdge).toBeLessThan(stripOuterEdge); // clears the soil strip
  expect(farEdge).toBeGreaterThan(barnFrontWall); // clears (barely) the barn wall
  // "just touching" the wall, not floating clear of it by a wide margin
  expect(farEdge - barnFrontWall).toBeLessThan(0.2);
});

// FIX 5: a boulder in the lane undoes the gate gaps the hedgerows leave for it.
test("nearLane/distanceToLane agree, and the previously-buried boulder is now excluded", () => {
  expect(nearLane(46.1, -23.8, 1.6)).toBe(true); // the bug report's boulder position
  expect(distanceToLane(46.1, -23.8)).toBeLessThan(1.6);
  expect(nearLane(0, 100, 1.6)).toBe(false); // far from the lane entirely
});
