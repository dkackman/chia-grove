import { expect, test } from "vitest";
import {
  entryScale,
  entryDrop,
  depthFade,
  ENTRY_SECONDS,
  FADE_START_BANDS,
  FADE_END_BANDS,
} from "../src/themes/lake/entry.js";
import { MAX_BANDS } from "../src/themes/lake/layout.js";

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

test("a creature stays full size until it nears the bottom of the column", () => {
  expect(depthFade(0)).toBe(1);
  expect(depthFade(FADE_START_BANDS)).toBe(1);
  expect(depthFade(-2)).toBe(1); // smoothed counter can dip below zero
});

test("a creature shrinks away before the clamp, so the clamp is never a floor", () => {
  expect(depthFade(FADE_END_BANDS)).toBe(0);
  expect(depthFade(MAX_BANDS)).toBe(0);
  expect(depthFade(MAX_BANDS + 500)).toBe(0);
  // gone strictly before sinking stops, or the pile would still form
  expect(FADE_END_BANDS).toBeLessThan(MAX_BANDS);
});

test("the fade is monotonic and spread over several bands", () => {
  expect(FADE_END_BANDS - FADE_START_BANDS).toBeGreaterThanOrEqual(3);
  for (let age = FADE_START_BANDS; age < FADE_END_BANDS; age += 0.25) {
    expect(depthFade(age + 0.25)).toBeLessThanOrEqual(depthFade(age));
  }
  const mid = (FADE_START_BANDS + FADE_END_BANDS) / 2;
  expect(depthFade(mid)).toBeGreaterThan(0);
  expect(depthFade(mid)).toBeLessThan(1);
});
