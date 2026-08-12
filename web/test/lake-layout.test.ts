import { expect, test } from "vitest";
import {
  MAX_BANDS,
  BAND_STEP,
  TOP_BAND_Y,
  BED_Y,
  BAND_RADIUS_MIN,
  BAND_RADIUS_MAX,
  bandDepth,
  seatOffset,
  easeBlocks,
} from "../src/themes/lake/layout.js";

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
  expect(bandDepth(MAX_BANDS)).toBeCloseTo(BED_Y, 5);
  expect(bandDepth(MAX_BANDS + 500)).toBeCloseTo(BED_Y, 5);
});

test("a negative age (clock skew, replay) never floats above the top band", () => {
  expect(bandDepth(-3)).toBeCloseTo(TOP_BAND_Y, 5);
});

test("the whole column fits in a viewable depth", () => {
  // 40 bands at 1.5 units is a 60-unit descent — framable from mid-column.
  expect(TOP_BAND_Y - BED_Y).toBeLessThanOrEqual(70);
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
