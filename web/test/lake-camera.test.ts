import { expect, test } from "vitest";
import { frameTarget, LAKE_FOV, MAX_FRAME_DISTANCE } from "../src/themes/lake/camera.js";
import { MAX_BANDS, RIM_RADIUS, PENDING_Y_MAX, bandDepth } from "../src/themes/lake/layout.js";

const ASPECT = 16 / 9;

test("an empty lake frames the churn layer and the newest bands, not empty water", () => {
  const empty = frameTarget(0, LAKE_FOV, ASPECT);
  const full = frameTarget(MAX_BANDS, LAKE_FOV, ASPECT);
  expect(empty.centerY).toBeGreaterThan(full.centerY);
  expect(empty.distance).toBeLessThanOrEqual(full.distance);
});

test("the camera pulls back as the column fills, monotonically", () => {
  let previous = 0;
  for (let n = 0; n <= MAX_BANDS; n++) {
    const { distance } = frameTarget(n, LAKE_FOV, ASPECT);
    expect(distance).toBeGreaterThanOrEqual(previous);
    previous = distance;
  }
});

test("the framing never pulls the camera inside the rim rings", () => {
  for (let n = 0; n <= MAX_BANDS; n++) {
    expect(frameTarget(n, LAKE_FOV, ASPECT).distance).toBeGreaterThan(RIM_RADIUS);
  }
});

test("the near ring arc never fills the frame — fit distance is measured past the radius", () => {
  // frameTarget frames a cylinder, not a plane: the fit answers for the near
  // face, so the axis distance must leave at least the fit's worth of room
  // in front of the nearest ring arc. The shipped bug collapsed this gap to
  // 8 units and the scene read as standing inside a barrel of hoops.
  for (let n = 0; n <= MAX_BANDS; n++) {
    const { distance } = frameTarget(n, LAKE_FOV, ASPECT);
    expect(distance - RIM_RADIUS).toBeGreaterThan(RIM_RADIUS);
  }
});

test("framing is bounded, and the cap does not bind on a landscape viewport", () => {
  for (let n = 0; n <= MAX_BANDS; n++) {
    expect(frameTarget(n, LAKE_FOV, ASPECT).distance).toBeLessThanOrEqual(MAX_FRAME_DISTANCE);
  }
  // at 16:9 the full column fits inside the ceiling — the cap exists for
  // narrow portrait aspects, not for the common case
  expect(frameTarget(MAX_BANDS, LAKE_FOV, ASPECT).distance).toBeLessThan(MAX_FRAME_DISTANCE);
});

test("the look target stays inside the column", () => {
  for (let n = 0; n <= MAX_BANDS; n++) {
    const { centerY } = frameTarget(n, LAKE_FOV, ASPECT);
    expect(centerY).toBeLessThanOrEqual(PENDING_Y_MAX);
    expect(centerY).toBeGreaterThanOrEqual(bandDepth(MAX_BANDS));
  }
});

test("framing is a pure function of fill depth — it cannot oscillate over time", () => {
  // regression guard on the deleted camera bob: nothing here takes a clock, so
  // the camera cannot move on the axis the theme uses to mean time
  expect(frameTarget(7, LAKE_FOV, ASPECT)).toEqual(frameTarget(7, LAKE_FOV, ASPECT));
});

test("a tall narrow viewport still fits the column", () => {
  const portrait = frameTarget(MAX_BANDS, LAKE_FOV, 0.5);
  const landscape = frameTarget(MAX_BANDS, LAKE_FOV, 2.0);
  expect(portrait.distance).toBeGreaterThanOrEqual(landscape.distance);
});

test("a nonsense band count degrades to the empty framing", () => {
  expect(frameTarget(-5, LAKE_FOV, ASPECT)).toEqual(frameTarget(0, LAKE_FOV, ASPECT));
  expect(Number.isFinite(frameTarget(NaN, LAKE_FOV, ASPECT).distance)).toBe(true);
});
