import { expect, test } from "vitest";
import { mempoolGauge, netspaceText } from "../src/ui/gauges.js";

test("the gauge fills in proportion to mempool size", () => {
  expect(mempoolGauge(0, 5)).toBe("·····");
  expect(mempoolGauge(5000, 5)).toBe("▮▮▮▮▮");
  expect(mempoolGauge(2500, 5)).toBe("▮▮▮··");
});

test("the gauge clamps past full and survives junk input", () => {
  expect(mempoolGauge(99999, 5)).toBe("▮▮▮▮▮");
  expect(mempoolGauge(-10, 5)).toBe("·····");
  expect(mempoolGauge(NaN, 5)).toBe("·····");
});

test("netspace prints in the largest unit that fits", () => {
  expect(netspaceText("0")).toBe("0.0 B");
  expect(netspaceText(String(1024 ** 6 * 25))).toBe("25.0 EIB");
  expect(netspaceText(String(1024 ** 4))).toBe("1.0 TIB");
});
