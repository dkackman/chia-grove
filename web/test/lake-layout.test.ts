import { expect, test } from "vitest";
import {
  MAX_BANDS,
  BAND_STEP,
  TOP_BAND_Y,
  COLUMN_BOTTOM_Y,
  BAND_RADIUS_MIN,
  BAND_RADIUS_MAX,
  RIM_RADIUS,
  PENDING_Y_MIN,
  PENDING_Y_MAX,
  bandDepth,
  seatOffset,
  easeBlocks,
} from "../src/themes/lake/layout.js";
import { SURFACE_Y, SHAFT_RADIUS_MIN } from "../src/themes/lake/water.js";
import { MAX_FRAME_DISTANCE } from "../src/themes/lake/camera.js";

test("the newest band sits at the top of the column", () => {
  expect(bandDepth(0)).toBeCloseTo(TOP_BAND_Y, 5);
});

test("each older band sits one step deeper", () => {
  expect(bandDepth(1)).toBeCloseTo(TOP_BAND_Y - BAND_STEP, 5);
  expect(bandDepth(5)).toBeCloseTo(TOP_BAND_Y - 5 * BAND_STEP, 5);
});

test("bands sink monotonically as they age", () => {
  for (let age = 1; age < MAX_BANDS; age++) {
    expect(bandDepth(age)).toBeLessThan(bandDepth(age - 1));
  }
});

test("sinking clamps at the bed so old bands pile up instead of falling forever", () => {
  expect(bandDepth(MAX_BANDS)).toBeCloseTo(COLUMN_BOTTOM_Y, 5);
  expect(bandDepth(MAX_BANDS + 500)).toBeCloseTo(COLUMN_BOTTOM_Y, 5);
});

test("a negative age (clock skew, replay) never floats above the top band", () => {
  expect(bandDepth(-3)).toBeCloseTo(TOP_BAND_Y, 5);
});

test("the whole column fits in a viewable depth", () => {
  // 18 bands at 2.6 units is a 46.8-unit descent — fewer, thicker, countable
  // bands rather than 40 the eye cannot separate.
  expect(TOP_BAND_Y - COLUMN_BOTTOM_Y).toBeCloseTo(MAX_BANDS * BAND_STEP, 5);
  expect(TOP_BAND_Y - COLUMN_BOTTOM_Y).toBeLessThanOrEqual(70);
});

test("bands are thick enough to read as separate strata", () => {
  expect(MAX_BANDS).toBe(18);
  expect(BAND_STEP).toBeGreaterThanOrEqual(2.5);
});

test("the churn layer sits clear of the surface and of band 0", () => {
  expect(PENDING_Y_MAX).toBeLessThan(SURFACE_Y);
  expect(PENDING_Y_MIN).toBeLessThan(PENDING_Y_MAX);
  // a full band step of clearance so a descending silhouette visibly crosses
  // into the newest band rather than starting inside it
  expect(PENDING_Y_MIN - bandDepth(0)).toBeGreaterThanOrEqual(BAND_STEP);
});

test("the rim rings sit outside the creatures and inside the god rays", () => {
  expect(RIM_RADIUS).toBeGreaterThan(BAND_RADIUS_MAX);
  expect(RIM_RADIUS).toBeLessThan(SHAFT_RADIUS_MIN);
});

test("the god rays sit beyond everywhere the camera can stand", () => {
  // the shafts must never end up between the lens and the column — a hollow
  // double-sided cone seen up close reads as a hard-edged spike, and a shaft
  // in front of the rings breaks the depth story entirely
  expect(SHAFT_RADIUS_MIN).toBeGreaterThan(MAX_FRAME_DISTANCE);
});

test("a coin always gets the same swim circuit", () => {
  const id = "a1b2c3d4" + "00".repeat(28);
  expect(seatOffset(id)).toEqual(seatOffset(id));
});

test("different coins get different circuits", () => {
  const a = seatOffset("a1b2c3d4" + "00".repeat(28));
  const b = seatOffset("99887766" + "00".repeat(28));
  expect(a.angle).not.toBeCloseTo(b.angle, 5);
});

test("circuits stay inside the band's radius range and move at a sane speed", () => {
  for (let i = 0; i < 200; i++) {
    const seat = seatOffset(i.toString(16).padStart(8, "0") + "00".repeat(28));
    expect(seat.radius).toBeGreaterThanOrEqual(BAND_RADIUS_MIN);
    expect(seat.radius).toBeLessThanOrEqual(BAND_RADIUS_MAX);
    expect(seat.angle).toBeGreaterThanOrEqual(0);
    expect(seat.angle).toBeLessThan(Math.PI * 2);
    expect(seat.speed).toBeGreaterThan(0);
    expect(seat.speed).toBeLessThan(0.2);
  }
});

test("a malformed coin id still yields a usable circuit", () => {
  const seat = seatOffset("");
  expect(Number.isFinite(seat.radius)).toBe(true);
  expect(Number.isFinite(seat.angle)).toBe(true);
  expect(Number.isFinite(seat.speed)).toBe(true);
});

test("fractional ages sit between bands, so sinking can glide", () => {
  expect(bandDepth(0.5)).toBeCloseTo(TOP_BAND_Y - 0.5 * BAND_STEP, 5);
  expect(bandDepth(0.5)).toBeLessThan(bandDepth(0));
  expect(bandDepth(0.5)).toBeGreaterThan(bandDepth(1));
});

test("seats carry deterministic wander parameters", () => {
  const seat = seatOffset("a1b2c3d4" + "00".repeat(28));
  expect(seat).toEqual(seatOffset("a1b2c3d4" + "00".repeat(28)));
  expect(seat.wanderPhase).toBeGreaterThanOrEqual(0);
  expect(seat.wanderPhase).toBeLessThan(Math.PI * 2);
  expect(seat.wanderRate).toBeGreaterThanOrEqual(0.1);
  expect(seat.wanderRate).toBeLessThanOrEqual(0.35);
});

test("adding wander draws did not reshuffle existing circuits", () => {
  // the wander fields are drawn AFTER the original four, so radius/angle/bob/
  // speed for a given coin id must not change from the shipped lake
  const seat = seatOffset("a1b2c3d4" + "00".repeat(28));
  expect(seat.radius).toBeGreaterThanOrEqual(BAND_RADIUS_MIN);
  expect(seat.speed).toBeGreaterThan(0.05 - 1e-9);
  expect(seat.speed).toBeLessThan(0.14);
});

test("easeBlocks glides toward the target and settles exactly on it", () => {
  let v = 0;
  v = easeBlocks(v, 1, 0.016);
  expect(v).toBeGreaterThan(0);
  expect(v).toBeLessThan(1);
  for (let i = 0; i < 600; i++) v = easeBlocks(v, 1, 0.016);
  expect(v).toBe(1);
  expect(easeBlocks(5, 5, 0.016)).toBe(5);
  expect(easeBlocks(3, 7, 0)).toBe(3);
});
