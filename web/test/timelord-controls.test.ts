import { expect, test } from "vitest";
import { TimeTravel } from "../src/themes/timelord/controls.js";

test("starts live and follows the head", () => {
  const tt = new TimeTravel();
  expect(tt.pinned).toBeNull();
  expect(tt.target(50, 0)).toBe(50);
});

test("scrolling back pins an absolute block that holds while new blocks arrive", () => {
  const tt = new TimeTravel();
  tt.scroll(10, 50, 0);
  expect(tt.target(50, 0)).toBe(40);
  expect(tt.target(55, 0)).toBe(40);
});

test("scrolling is clamped to the oldest surviving block", () => {
  const tt = new TimeTravel();
  tt.scroll(500, 50, 20);
  expect(tt.target(50, 20)).toBe(20);
});

test("scrolling forward past the head returns to live", () => {
  const tt = new TimeTravel();
  tt.scroll(5, 50, 0);
  tt.scroll(-10, 50, 0);
  expect(tt.pinned).toBeNull();
});

test("a pin recycled out from under the view slides to the oldest block", () => {
  const tt = new TimeTravel();
  tt.jump(10, 50);
  expect(tt.target(60, 25)).toBe(25);
});

test("jumping to the head goes live", () => {
  const tt = new TimeTravel();
  tt.jump(30, 50);
  expect(tt.pinned).toBe(30);
  tt.jump(50, 50);
  expect(tt.pinned).toBeNull();
});
