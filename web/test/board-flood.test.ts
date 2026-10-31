import { expect, test } from "vitest";
import { FloodDetector } from "../src/themes/board/flood.js";

/** Feed a block of `total` sprouts through a 120/frame drain; true if any frame flooded. */
function drains(d: FloodDetector, total: number, budget = 120): boolean {
  let flooded = false;
  for (let left = total; left > 0; left -= budget) {
    if (d.observe(Math.min(budget, left))) flooded = true;
  }
  return flooded;
}

test("a big live block (a few heavy frames) never counts as flooding", () => {
  const d = new FloodDetector();
  expect(drains(d, 170)).toBe(false); // the old 48/frame threshold snapped this
  expect(drains(d, 400)).toBe(false);
  for (let i = 0; i < 60; i++) d.observe(0); // quiet frames between blocks
  expect(drains(d, 1000)).toBe(false);
});

test("the sustained snapshot replay floods after ~10 heavy frames", () => {
  const d = new FloodDetector();
  const results: boolean[] = [];
  for (let i = 0; i < 80; i++) results.push(d.observe(110));
  expect(results.slice(0, 9).every((r) => !r)).toBe(true);
  expect(results.slice(10).every((r) => r)).toBe(true);
});

test("an occasional light frame mid-replay doesn't break the flood", () => {
  const d = new FloodDetector();
  for (let i = 0; i < 20; i++) d.observe(110);
  expect(d.observe(0)).toBe(true);
  expect(d.observe(110)).toBe(true);
});

test("flooding clears once the replay ends", () => {
  const d = new FloodDetector();
  for (let i = 0; i < 30; i++) d.observe(110);
  let last = true;
  for (let i = 0; i < 12; i++) last = d.observe(0);
  expect(last).toBe(false);
});
