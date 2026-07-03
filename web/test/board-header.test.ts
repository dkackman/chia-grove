import { expect, test } from "vitest";
import { detailBlockLabel, mempoolGauge, statusRowText } from "../src/themes/board/header.js";

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

test("detailBlockLabel shows spend count and fees when loaded", () => {
  expect(detailBlockLabel(1234567, "loaded", 5, "1000")).toBe(
    "BLOCK 1234567   5 SPENDS   1000 MOJO FEES"
  );
});

test("detailBlockLabel shows a status message for non-loaded states", () => {
  expect(detailBlockLabel(100, "empty", 0, "0")).toBe("BLOCK 100   NO SPENDS THIS BLOCK");
  expect(detailBlockLabel(100, "loading", 0, "0")).toBe("BLOCK 100   LOADING…");
  expect(detailBlockLabel(100, "error", 0, "0")).toBe("BLOCK 100   COULD NOT LOAD");
});

test("statusRowText shows LIVE, HISTORY, or DETAIL depending on mode", () => {
  expect(statusRowText("live", "01:02:03")).toBe("01:02:03   LIVE");
  expect(statusRowText("history", "01:02:03")).toBe("01:02:03   ★ HISTORY · SCROLL UP FOR LIVE");
  expect(statusRowText("detail", "01:02:03")).toBe("01:02:03   ★ BLOCK DETAIL");
});
