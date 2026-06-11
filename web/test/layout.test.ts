import { expect, test } from "vitest";
import { blockPosition, sproutOffset } from "../src/scene/layout.js";

test("block positions spiral outward monotonically", () => {
  const r = (i: number) => Math.hypot(blockPosition(i).x, blockPosition(i).z);
  expect(r(1)).toBeGreaterThan(r(0));
  expect(r(50)).toBeGreaterThan(r(10));
  expect(r(0)).toBeGreaterThanOrEqual(6); // center clearing
});

test("consecutive blocks land at well-separated angles", () => {
  const a = blockPosition(10);
  const b = blockPosition(11);
  expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(2);
});

test("sprout offset is deterministic per coin id and within cluster", () => {
  const coinId = "deadbeef" + "00".repeat(28);
  const first = sproutOffset(coinId);
  const second = sproutOffset(coinId);
  expect(first).toEqual(second);
  expect(Math.hypot(first.x, first.z)).toBeLessThanOrEqual(1.8);
  const other = sproutOffset("cafebabe" + "00".repeat(28));
  expect(other).not.toEqual(first);
});
