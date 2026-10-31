import { expect, test } from "vitest";
import { isFormFieldTarget, shortcutFor } from "../src/ui/shortcuts.js";

const key = (k: string, extra: Partial<Parameters<typeof shortcutFor>[0]> = {}) => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  target: { tagName: "CANVAS" } as unknown as EventTarget,
  ...extra,
});

test("number keys pick the nth scene", () => {
  expect(shortcutFor(key("1"), 6)).toEqual({ type: "theme", index: 0 });
  expect(shortcutFor(key("6"), 6)).toEqual({ type: "theme", index: 5 });
  expect(shortcutFor(key("7"), 6)).toBeNull();
  expect(shortcutFor(key("0"), 6)).toBeNull();
});

test("L toggles the legend in either case", () => {
  expect(shortcutFor(key("l"), 6)).toEqual({ type: "legend" });
  expect(shortcutFor(key("L"), 6)).toEqual({ type: "legend" });
});

test("modifiers disable shortcuts", () => {
  expect(shortcutFor(key("1", { ctrlKey: true }), 6)).toBeNull();
  expect(shortcutFor(key("1", { metaKey: true }), 6)).toBeNull();
  expect(shortcutFor(key("l", { altKey: true }), 6)).toBeNull();
});

test("typing in a form field is never a shortcut", () => {
  for (const tagName of ["INPUT", "SELECT", "TEXTAREA", "input"]) {
    const target = { tagName } as unknown as EventTarget;
    expect(shortcutFor(key("1", { target }), 6)).toBeNull();
    expect(shortcutFor(key("l", { target }), 6)).toBeNull();
  }
  const editable = { tagName: "DIV", isContentEditable: true } as unknown as EventTarget;
  expect(isFormFieldTarget(editable)).toBe(true);
  expect(isFormFieldTarget(null)).toBe(false);
  expect(shortcutFor(key("ArrowLeft"), 6)).toBeNull();
});
