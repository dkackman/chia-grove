import { expect, test } from "vitest";
import { LEXICON, matchesLexicon } from "../src/classify/lexicon.js";

test("LEXICON is a non-empty list of lowercase strings", () => {
  expect(Array.isArray(LEXICON)).toBe(true);
  expect(LEXICON.length).toBeGreaterThan(0);
  for (const term of LEXICON) {
    expect(typeof term).toBe("string");
    expect(term).toBe(term.toLowerCase());
    expect(term.trim()).not.toBe("");
  }
});

test("matches a whole-word term, case-insensitively", () => {
  expect(matchesLexicon("Hardcore XXX collection")).toBe(true);
  expect(matchesLexicon("NUDE study")).toBe(true);
});

test("does not match a term embedded as a substring (word boundary)", () => {
  // "sussex" contains "sex", "analysis" contains "anal" — must not match
  expect(matchesLexicon("Sussex sunrise", ["sex"])).toBe(false);
  expect(matchesLexicon("data analysis", ["anal"])).toBe(false);
});

test("benign text → no match", () => {
  expect(matchesLexicon("A peaceful mountain landscape")).toBe(false);
  expect(matchesLexicon("")).toBe(false);
});

test("custom term list is honored", () => {
  expect(matchesLexicon("contains widget", ["widget"])).toBe(true);
  expect(matchesLexicon("contains widget", ["gadget"])).toBe(false);
});
