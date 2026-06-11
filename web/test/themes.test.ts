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
