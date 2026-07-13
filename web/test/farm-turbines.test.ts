import { expect, test } from "vitest";
import { gustPulse, turbineLayout, WIND_FARM } from "../src/themes/farm/turbines.js";

test("the layout is identical on every call, so reloads and replays match", () => {
  expect(turbineLayout()).toEqual(turbineLayout());
});

test("every turbine stands on the turf disc, not over open sky", () => {
  for (const t of turbineLayout()) {
    expect(Math.hypot(t.x, t.z)).toBeLessThanOrEqual(WIND_FARM.maxRadius + 1e-6);
  }
});

test("every turbine is out in the distance, beyond the barn and the camera path", () => {
  for (const t of turbineLayout()) {
    expect(t.z).toBeLessThanOrEqual(WIND_FARM.zLimit);
  }
});

test("turbines come in groups — each one has a cluster-mate nearby", () => {
  const turbines = turbineLayout();
  expect(turbines.length).toBeGreaterThanOrEqual(8);
  for (const t of turbines) {
    const nearest = Math.min(
      ...turbines.filter((o) => o !== t).map((o) => Math.hypot(o.x - t.x, o.z - t.z))
    );
    expect(nearest).toBeLessThan(60);
  }
});

test("the groups are spread across the horizon rather than piled in one spot", () => {
  const xs = turbineLayout().map((t) => t.x);
  expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(60);
});

test("turbines vary in height and idle speed", () => {
  const turbines = turbineLayout();
  const heights = turbines.map((t) => t.height);
  expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(5);
  for (const t of turbines) {
    expect(t.height).toBeGreaterThanOrEqual(WIND_FARM.minHeight);
    expect(t.height).toBeLessThanOrEqual(WIND_FARM.maxHeight);
    expect(t.rate).toBeGreaterThan(0);
  }
});

test("the gust envelope rises from nothing, peaks, and dies away", () => {
  expect(gustPulse(-1)).toBe(0);
  expect(gustPulse(0)).toBe(0);
  expect(gustPulse(1)).toBeCloseTo(1); // peaks one time-constant after the wind arrives
  expect(gustPulse(4)).toBeLessThan(0.25);
  expect(gustPulse(Infinity)).toBe(0); // never NaN, however long ago the last block was
});
