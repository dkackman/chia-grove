import { expect, test } from "vitest";
import { WOOL_DYES, FIXED_COLORS } from "../src/themes/mine/palette.js";

test("there are exactly 16 wool dyes with valid HSL", () => {
  expect(WOOL_DYES.length).toBe(16);
  for (const c of WOOL_DYES) {
    expect(c.h).toBeGreaterThanOrEqual(0);
    expect(c.h).toBeLessThanOrEqual(1);
    expect(c.s).toBeGreaterThanOrEqual(0);
    expect(c.l).toBeGreaterThan(0);
  }
});

test("every fixed (non-dyed) material has a color", () => {
  for (const key of ["glass", "ice", "blue_ice", "honey", "glowstone", "sea_lantern", "shroomlight", "froglight", "redstone_lamp", "magma"]) {
    expect(FIXED_COLORS[key]).toBeDefined();
  }
});
