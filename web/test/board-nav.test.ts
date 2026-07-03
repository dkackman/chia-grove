import { expect, test } from "vitest";
import { parseHeightInput } from "../src/themes/board/block-nav.js";

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
