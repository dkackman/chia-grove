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
