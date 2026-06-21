import { expect, test } from "vitest";
import { mempoolGauge } from "../src/themes/board/header.js";

test("empty mempool is an empty bar of the requested width", () => {
  const g = mempoolGauge(0, 10);
  expect(g.length).toBe(10);
  expect(g).not.toContain("▮");
});

test("a full mempool fills the whole bar", () => {
  expect(mempoolGauge(99999, 10)).toBe("▮".repeat(10));
});

test("a half-full mempool fills about half", () => {
  const g = mempoolGauge(2500, 10, 5000);
  expect([...g].filter((c) => c === "▮").length).toBe(5);
});

test("mempoolGauge never throws and stays width-correct on bad inputs", () => {
  expect(mempoolGauge(-1, 10)).toBe("·".repeat(10));
  expect(mempoolGauge(0, 10, 0)).toBe("·".repeat(10)); // 0/0 = NaN
  expect(mempoolGauge(1e9, 10, 0)).toBe("▮".repeat(10)); // Infinity clamps to full
  expect(mempoolGauge(0, 10).length).toBe(10);
});
