import { expect, test } from "vitest";
import {
  GLYPHS,
  ATLAS_COLS,
  charToGlyph,
  glyphCell,
  isRenderable,
  nextGlyph,
} from "../src/themes/board/glyphs.js";

test("glyph table starts with space and fits the atlas", () => {
  expect(GLYPHS[0]).toBe(" ");
  expect(GLYPHS.length).toBeLessThanOrEqual(ATLAS_COLS * ATLAS_COLS);
  expect(GLYPHS).toContain("A");
  expect(GLYPHS).toContain("9");
  expect(GLYPHS).toContain("★");
  expect(GLYPHS).toContain("×");
});

test("charToGlyph maps the multiplication sign to a non-blank cell", () => {
  expect(charToGlyph("×")).not.toBe(0);
  expect(GLYPHS[charToGlyph("×")]).toBe("×");
});

test("charToGlyph maps letters, digits, folds case, blanks unknown", () => {
  expect(charToGlyph(" ")).toBe(0);
  expect(GLYPHS[charToGlyph("A")]).toBe("A");
  expect(charToGlyph("a")).toBe(charToGlyph("A"));
  expect(GLYPHS[charToGlyph("7")]).toBe("7");
  expect(charToGlyph("💎")).toBe(0); // outside the set → blank
  expect(charToGlyph("é")).toBe(0); // accented letters aren't in the set
  expect(charToGlyph("")).toBe(0);
});

test("printable ASCII symbols have their own flaps (CAT names use them)", () => {
  for (const ch of "!\"#$%&'()*+,/;<=>?@[\\]^_`{|}~") {
    expect(isRenderable(ch)).toBe(true);
    expect(GLYPHS[charToGlyph(ch)]).toBe(ch);
  }
});

test("isRenderable accepts set members (case-folded, incl. space) and rejects others", () => {
  expect(isRenderable("A")).toBe(true);
  expect(isRenderable("a")).toBe(true); // case folded
  expect(isRenderable("7")).toBe(true);
  expect(isRenderable(" ")).toBe(true); // space is a real (blank) cell
  expect(isRenderable("-")).toBe(true);
  expect(isRenderable("$")).toBe(true); // ASCII symbols are in the set now
  expect(isRenderable("💎")).toBe(false); // emoji has no flap
  expect(isRenderable("é")).toBe(false); // accents fall back too
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
