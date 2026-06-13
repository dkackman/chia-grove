import { expect, test } from "vitest";
import { netspaceLight } from "../src/themes/gallery/ambience.js";

const eib = (n: number) => String(BigInt(Math.round(n * 1024)) << 50n);

test("brighter with more netspace, monotonic", () => {
  expect(netspaceLight(eib(20))).toBeGreaterThan(netspaceLight(eib(10)));
  expect(netspaceLight(eib(40))).toBeGreaterThan(netspaceLight(eib(20)));
});

test("clamped to a sane range", () => {
  expect(netspaceLight(eib(0))).toBeGreaterThanOrEqual(0.6);
  expect(netspaceLight(eib(10000))).toBeLessThanOrEqual(1.15);
});

test("invalid input does not throw and stays in range", () => {
  const v = netspaceLight("not-a-number");
  expect(v).toBeGreaterThanOrEqual(0.6);
  expect(v).toBeLessThanOrEqual(1.15);
});
