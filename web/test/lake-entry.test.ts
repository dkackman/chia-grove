import { expect, test } from "vitest";
import { entryScale, entryDrop, ENTRY_SECONDS } from "../src/themes/lake/entry.js";

test("a creature grows from nothing to full size and stays there", () => {
  expect(entryScale(0)).toBeCloseTo(0, 5);
  expect(entryScale(ENTRY_SECONDS)).toBeCloseTo(1, 5);
  expect(entryScale(ENTRY_SECONDS * 10)).toBe(1);
  expect(entryScale(0.4)).toBeGreaterThan(entryScale(0.2));
});

test("a creature settles down into its band and stops", () => {
  expect(entryDrop(0)).toBeGreaterThan(0);
  expect(entryDrop(ENTRY_SECONDS)).toBeCloseTo(0, 5);
  expect(entryDrop(ENTRY_SECONDS * 10)).toBe(0);
  expect(entryDrop(0.2)).toBeGreaterThan(entryDrop(0.4));
});

test("a negative age (replay clock skew) is treated as not yet arrived", () => {
  expect(entryScale(-1)).toBe(0);
  expect(entryDrop(-1)).toBeGreaterThan(0);
});
