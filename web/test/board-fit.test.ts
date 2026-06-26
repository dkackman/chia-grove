import { expect, test } from "vitest";
import { fitDistance } from "../src/themes/board/fit.js";

test("square content in a square viewport fits at the height distance", () => {
  // vFov 90° → tan(45°)=1, so half-extent = distance; a 10×10 box needs distance 5
  expect(fitDistance(10, 10, 90, 1, 1)).toBeCloseTo(5, 5);
});

test("a very wide box in a square viewport is width-limited", () => {
  // width 20 needs distance 10 (half=tan45=1); height 2 only needs 1 → width wins
  expect(fitDistance(20, 2, 90, 1, 1)).toBeCloseTo(10, 5);
});

test("a narrow (portrait) viewport pushes the camera back to fit the width", () => {
  // aspect 0.5 halves the horizontal field, so a 10-wide box needs twice the distance
  expect(fitDistance(10, 10, 90, 0.5, 1)).toBeCloseTo(10, 5);
});

test("margin scales the distance", () => {
  expect(fitDistance(10, 10, 90, 1, 1.1)).toBeCloseTo(5.5, 5);
});

test("returns the larger of the width and height fit", () => {
  // wide viewport (aspect 3): height fit dominates
  const d = fitDistance(30, 14.6, 40, 3, 1);
  const half = Math.tan((40 * Math.PI) / 180 / 2);
  expect(d).toBeCloseTo(14.6 / 2 / half, 5);
});
