import { expect, test } from "vitest";
import { resolveTheme, THEMES } from "../src/themes/index.js";

test("unknown or missing theme falls back to grove", () => {
  expect(resolveTheme("", null).id).toBe("grove");
  expect(resolveTheme("?theme=bogus", null).id).toBe("grove");
  expect(resolveTheme("", "bogus").id).toBe("grove");
});

test("url param wins over stored value", () => {
  expect(resolveTheme("?theme=grove", "other").id).toBe("grove");
});

test("every theme has an id, label, and non-empty legend", () => {
  expect(THEMES.length).toBeGreaterThanOrEqual(1);
  for (const theme of THEMES) {
    expect(theme.id).toBeTruthy();
    expect(theme.label).toBeTruthy();
    expect(theme.legend.length).toBeGreaterThan(0);
  }
});

test("farm theme is registered and resolvable", () => {
  expect(THEMES.map((t) => t.id)).toContain("farm");
  expect(resolveTheme("?theme=farm", null).id).toBe("farm");
  expect(resolveTheme("", "farm").id).toBe("farm");
});

test("gallery theme is registered and resolvable", () => {
  expect(THEMES.map((t) => t.id)).toContain("gallery");
  expect(resolveTheme("?theme=gallery", null).id).toBe("gallery");
  expect(resolveTheme("", "gallery").id).toBe("gallery");
});

test("mine theme is registered and resolvable", () => {
  expect(THEMES.map((t) => t.id)).toContain("mine");
  expect(resolveTheme("?theme=mine", null).id).toBe("mine");
  expect(resolveTheme("", "mine").id).toBe("mine");
});
