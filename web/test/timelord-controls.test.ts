import { expect, test } from "vitest";
import { TimeTravel, timeKeyFor } from "../src/themes/timelord/controls.js";

test("the target is clamped to the head when a reorg rewinds it below the pin", () => {
  const tt = new TimeTravel();
  tt.jump(48, 50);
  expect(tt.target(45, 0)).toBe(45);
  expect(tt.target(52, 0)).toBe(48);
});

const key = (k: string, extra: Partial<Parameters<typeof timeKeyFor>[0]> = {}) => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  target: null,
  ...extra,
});

test("keys map to time travel", () => {
  expect(timeKeyFor(key("ArrowDown"), false)).toEqual({ type: "scroll", blocks: 1 });
  expect(timeKeyFor(key("PageUp"), false)).toEqual({ type: "scroll", blocks: -10 });
  expect(timeKeyFor(key("End"), false)).toEqual({ type: "live" });
  expect(timeKeyFor(key("Escape"), false)).toEqual({ type: "live" });
  expect(timeKeyFor(key("x"), false)).toBeNull();
});

test("modifiers and form fields leave the keys alone", () => {
  expect(timeKeyFor(key("ArrowUp", { metaKey: true }), false)).toBeNull();
  expect(timeKeyFor(key("PageDown", { ctrlKey: true }), false)).toBeNull();
  expect(timeKeyFor(key("ArrowDown", { altKey: true }), false)).toBeNull();
  const select = { tagName: "SELECT" } as unknown as EventTarget;
  expect(timeKeyFor(key("ArrowDown", { target: select }), false)).toBeNull();
});

test("Escape closes an open detail card before it returns live", () => {
  expect(timeKeyFor(key("Escape"), true)).toBeNull();
  expect(timeKeyFor(key("End"), true)).toEqual({ type: "live" });
});

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
