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
