import { expect, test } from "vitest";
import { SUN_DIR, sunStrength } from "../src/themes/farm/sky.js";
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

test("sun strength tracks netspace within the daylight range", () => {
  expect(sunStrength("0")).toBe(0.7);
  expect(sunStrength("not a number")).toBe(0.7);
  const eib = (n: number) => String(BigInt(n) * 2n ** 60n);
  expect(sunStrength(eib(30))).toBeCloseTo(1.1, 6);
  expect(sunStrength(eib(1000))).toBe(1.35);
  let previous = 0;
  for (let n = 0; n <= 60; n += 5) {
    const s = sunStrength(eib(n));
    expect(s).toBeGreaterThanOrEqual(previous);
    previous = s;
  }
});

test("cloud time wraps so the noise domain stays small", () => {
  expect(cloudTime(10)).toBe(10);
  expect(cloudTime(1e9)).toBeLessThan(20000);
  expect(cloudTime(1e9)).toBeGreaterThanOrEqual(0);
});
