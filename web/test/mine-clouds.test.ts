import { expect, test } from "vitest";
import { cloudMask, cloudRuns, CLOUD_GRID } from "../src/themes/mine/clouds.js";
import { moonPhase, horizonGlow } from "../src/themes/mine/sky.js";
import { shoreValue, SHORE_REACH } from "../src/themes/mine/water.js";

test("cloud mask is deterministic with partial cover", () => {
  const a = cloudMask();
  expect(cloudMask()).toEqual(a);
  const cover = a.reduce((n, v) => n + v, 0) / a.length;
  expect(cover).toBeGreaterThan(0.12);
  expect(cover).toBeLessThan(0.5);
});

test("cloud runs rebuild the mask exactly", () => {
  const mask = cloudMask();
  const rebuilt = new Uint8Array(mask.length);
  for (const r of cloudRuns(mask)) {
    for (let x = r.x; x < r.x + r.len; x++) rebuilt[r.z * CLOUD_GRID + x] = 1;
  }
  expect(rebuilt).toEqual(mask);
});

test("moon phase steps once per day and wraps through 8 phases", () => {
  expect(moonPhase(0, 100)).toBe(0);
  expect(moonPhase(150, 100)).toBe(1);
  expect(moonPhase(850, 100)).toBe(0);
});

test("horizon glow peaks at sunrise/sunset, not noon or midnight", () => {
  expect(horizonGlow(0)).toBeCloseTo(1);
  expect(horizonGlow(0.5)).toBeCloseTo(1);
  expect(horizonGlow(0.25)).toBeLessThan(0.01);
  expect(horizonGlow(0.75)).toBeLessThan(0.01);
});

test("shore value is solid under land and fades out by the reach", () => {
  expect(shoreValue(0)).toBe(255);
  expect(shoreValue(SHORE_REACH * 0.5)).toBeGreaterThan(shoreValue(SHORE_REACH * 0.9));
  expect(shoreValue(SHORE_REACH)).toBe(0);
});
