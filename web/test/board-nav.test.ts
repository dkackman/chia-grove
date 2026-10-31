import { expect, test } from "vitest";
import { parseHeightInput, stepHeight } from "../src/themes/board/block-nav.js";

test("stepHeight never steps past the chain tip or below 0", () => {
  expect(stepHeight(100, 1, 200)).toBe(101);
  expect(stepHeight(200, 1, 200)).toBe(200); // at the tip: stays put
  expect(stepHeight(500, 1, 200)).toBe(200); // found a future height: next pulls back to tip
  expect(stepHeight(0, -1, 200)).toBe(0);
  expect(stepHeight(100, 1, null)).toBe(101); // tip not known yet
});

test("parses a plain integer height", () => {
  expect(parseHeightInput("1234567")).toBe(1234567);
});

test("trims surrounding whitespace", () => {
  expect(parseHeightInput("  1234567  ")).toBe(1234567);
});

test("rejects non-numeric input", () => {
  expect(parseHeightInput("abc")).toBeNull();
  expect(parseHeightInput("")).toBeNull();
  expect(parseHeightInput("12.5")).toBeNull();
  expect(parseHeightInput("-5")).toBeNull();
});

test("0 is a valid height", () => {
  expect(parseHeightInput("0")).toBe(0);
});
