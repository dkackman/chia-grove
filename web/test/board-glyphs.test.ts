import { expect, test } from "vitest";
import { GLYPHS, ATLAS_COLS, charToGlyph, glyphCell, nextGlyph } from "../src/themes/board/glyphs.js";

test("glyph table starts with space and fits the atlas", () => {
  expect(GLYPHS[0]).toBe(" ");
  expect(GLYPHS.length).toBeLessThanOrEqual(ATLAS_COLS * ATLAS_COLS);
  expect(GLYPHS).toContain("A");
  expect(GLYPHS).toContain("9");
  expect(GLYPHS).toContain("★");
});

test("charToGlyph maps letters, digits, folds case, blanks unknown", () => {
  expect(charToGlyph(" ")).toBe(0);
  expect(GLYPHS[charToGlyph("A")]).toBe("A");
  expect(charToGlyph("a")).toBe(charToGlyph("A"));
  expect(GLYPHS[charToGlyph("7")]).toBe("7");
  expect(charToGlyph("~")).toBe(0); // not in table → blank
  expect(charToGlyph("")).toBe(0);
});

test("glyphCell lays indices out row-major over the atlas", () => {
  expect(glyphCell(0)).toEqual({ col: 0, row: 0 });
  expect(glyphCell(ATLAS_COLS)).toEqual({ col: 0, row: 1 });
  expect(glyphCell(ATLAS_COLS + 3)).toEqual({ col: 3, row: 1 });
});

test("nextGlyph steps one toward target and wraps", () => {
  expect(nextGlyph(0, 0)).toBe(0); // already there
  expect(nextGlyph(0, 5)).toBe(1); // step forward
  expect(nextGlyph(GLYPHS.length - 1, 0)).toBe(0); // wraps to start
});
