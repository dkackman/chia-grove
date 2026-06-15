import { expect, test } from "vitest";
import { WOOL_DYES, FIXED_COLORS } from "../src/themes/mine/palette.js";
import { resolveCatBlock } from "../src/themes/mine/material.js";

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
  for (const key of [
    "glass",
    "ice",
    "blue_ice",
    "honey",
    "glowstone",
    "sea_lantern",
    "shroomlight",
    "froglight",
    "redstone_lamp",
    "magma",
  ]) {
    expect(FIXED_COLORS[key]).toBeDefined();
  }
});

function id(seed: string) {
  return seed.repeat(64).slice(0, 64);
}

test("resolveCatBlock is deterministic per asset id", () => {
  const a = resolveCatBlock(id("ab"));
  const b = resolveCatBlock(id("ab"));
  expect(a).toEqual(b);
});

test("opaque is the most common family, emissive the rarest", () => {
  const counts = { opaque: 0, transparent: 0, emissive: 0 };
  for (let i = 0; i < 2000; i++) {
    const hex = i.toString(16).padStart(8, "0") + "00".repeat(28);
    counts[resolveCatBlock(hex).family]++;
  }
  expect(counts.opaque).toBeGreaterThan(counts.transparent);
  expect(counts.transparent).toBeGreaterThan(counts.emissive);
  expect(counts.emissive).toBeGreaterThan(0);
});

test("dyed materials index the 16-dye set; fixed materials are not dyed", () => {
  for (let i = 0; i < 500; i++) {
    const hex = ((i * 2654435761) >>> 0).toString(16).padStart(8, "0") + "00".repeat(28);
    const b = resolveCatBlock(hex);
    if (b.dyed) {
      expect(b.dyeIndex).toBeGreaterThanOrEqual(0);
      expect(b.dyeIndex).toBeLessThan(16);
    } else expect(b.dyeIndex).toBeUndefined();
  }
});
