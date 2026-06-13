import { expect, test } from "vitest";
import { classifySwipe } from "../src/themes/gallery/swipe.js";

test("short horizontal movement is not a swipe", () => {
  expect(classifySwipe(20, 2, 0.1)).toBe(0);
});

test("vertical-dominant movement is not a swipe", () => {
  expect(classifySwipe(40, 60, 0.1)).toBe(0);
});

test("too-slow horizontal movement is not a swipe", () => {
  expect(classifySwipe(80, 5, 0.6)).toBe(0);
});

test("fast swipe right jumps toward older pieces (-1)", () => {
  expect(classifySwipe(80, 5, 0.2)).toBe(-1);
});

test("fast swipe left jumps toward newer pieces (+1)", () => {
  expect(classifySwipe(-80, 5, 0.2)).toBe(1);
});

test("exactly at the distance threshold counts as a swipe", () => {
  expect(classifySwipe(35, 5, 0.2)).toBe(-1); // |dx| < 35 is false at 35
});

test("just under the distance threshold is not a swipe", () => {
  expect(classifySwipe(34, 5, 0.2)).toBe(0);
});

test("exactly at the time threshold still counts as a swipe", () => {
  expect(classifySwipe(80, 5, 0.4)).toBe(-1); // dt > 0.4 is false at 0.4
});

test("a perfect diagonal (|dx| == |dy|) is not a swipe", () => {
  expect(classifySwipe(40, 40, 0.1)).toBe(0); // requires |dx| > |dy|
});
