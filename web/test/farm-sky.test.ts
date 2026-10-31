import { expect, test } from "vitest";
import { netspaceEib, SUN_DIR, SUN_MAX, SUN_MIN, trendStrength } from "../src/themes/farm/sky.js";
import { cloudTime } from "../src/themes/farm/clouds.js";

// The sky dome paints the sun's disc along SUN_DIR and the key light shines
// from it, so the disc must be where the camera can actually see it: above
// the hills (which never rise above the horizon line from the camera) but
// below the top of the frame, which the camera's pitch puts only ~13° up.
test("the sun sits low in the sky, inside the camera's view", () => {
  const elevation = degrees(Math.asin(SUN_DIR.y));
  expect(elevation).toBeGreaterThan(4);
  expect(elevation).toBeLessThan(11);
  // ahead of the camera (which looks toward −z), not behind it
  expect(SUN_DIR.z).toBeLessThan(-0.9);
  expect(SUN_DIR.length()).toBeCloseTo(1, 6);
});

function degrees(rad: number): number {
  return (rad * 180) / Math.PI;
}

test("netspace parses to EiB, junk to zero", () => {
  const eib = (n: number) => String(BigInt(n) * 2n ** 60n);
  expect(netspaceEib(eib(30))).toBeCloseTo(30, 6);
  expect(netspaceEib("not a number")).toBe(0);
  expect(netspaceEib("0")).toBe(0);
});

test("sun strength follows the session's netspace trend across the visible range", () => {
  expect(trendStrength(20, 20)).toBe(1);
  // a 1% move is plainly visible, either way
  expect(trendStrength(20.2, 20)).toBeGreaterThan(1.15);
  expect(trendStrength(19.8, 20)).toBeLessThan(0.85);
  // big moves clamp to the range
  expect(trendStrength(40, 20)).toBe(SUN_MAX);
  expect(trendStrength(1, 20)).toBe(SUN_MIN);
  // no baseline yet, or no data: neutral
  expect(trendStrength(20, 0)).toBe(1);
  expect(trendStrength(0, 20)).toBe(1);
  let previous = 0;
  for (let n = 19; n <= 21; n += 0.1) {
    const s = trendStrength(n, 20);
    expect(s).toBeGreaterThanOrEqual(previous);
    previous = s;
  }
});

test("cloud time wraps so the noise domain stays small", () => {
  expect(cloudTime(10)).toBe(10);
  expect(cloudTime(1e9)).toBeLessThan(20000);
  expect(cloudTime(1e9)).toBeGreaterThanOrEqual(0);
});
