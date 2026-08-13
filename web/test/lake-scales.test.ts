import { expect, test } from "vitest";
import { fishSize, schoolSize, clarityFromNetspace } from "../src/themes/lake/scales.js";

const XCH = (n: number) => String(n * 1e12); // 1 XCH = 1e12 mojos

test("fish grow with the amount spent", () => {
  expect(fishSize(XCH(1000))).toBeGreaterThan(fishSize(XCH(1)));
  expect(fishSize(XCH(1))).toBeGreaterThan(fishSize("1"));
});

test("fish size is bounded at both ends so nothing fills the screen or vanishes", () => {
  for (const amount of ["1", XCH(0.001), XCH(1), XCH(1e6), XCH(1e12)]) {
    expect(fishSize(amount)).toBeGreaterThanOrEqual(0.45);
    expect(fishSize(amount)).toBeLessThanOrEqual(2.6);
  }
});

test("a whale spend is visibly bigger than a typical one", () => {
  expect(fishSize(XCH(1e6))).toBeGreaterThan(fishSize(XCH(1)) * 2);
});

test("fish size survives malformed amounts", () => {
  for (const amount of ["", "0", "-5", "not-a-number"]) {
    expect(Number.isFinite(fishSize(amount))).toBe(true);
    expect(fishSize(amount)).toBe(0.45);
  }
});

test("school size is a positive integer that grows with the amount", () => {
  const small = schoolSize("1000"); // 1 token
  const large = schoolSize("1000000000"); // 1e6 tokens
  expect(Number.isInteger(small)).toBe(true);
  expect(small).toBeGreaterThanOrEqual(1);
  expect(large).toBeGreaterThan(small);
  expect(large).toBeLessThanOrEqual(5);
});

test("school size survives malformed amounts", () => {
  for (const amount of ["", "0", "-5", "not-a-number"]) {
    expect(schoolSize(amount)).toBe(1);
  }
});

test("clarity rises with netspace and stays in 0..1", () => {
  const eib = (n: number) => String(Math.round(n * 1.152921504606847e18));
  expect(clarityFromNetspace(eib(30))).toBeGreaterThan(clarityFromNetspace(eib(5)));
  for (const n of [0.001, 1, 25, 1000]) {
    expect(clarityFromNetspace(eib(n))).toBeGreaterThanOrEqual(0);
    expect(clarityFromNetspace(eib(n))).toBeLessThanOrEqual(1);
  }
});

test("clarity falls back to mid-range on malformed netspace", () => {
  for (const bytes of ["", "0", "not-a-number"]) {
    expect(clarityFromNetspace(bytes)).toBe(0.5);
  }
});
