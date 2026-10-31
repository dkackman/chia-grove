import { expect, test } from "vitest";
import {
  agoText,
  blockLabel,
  detailBlockLabel,
  feesText,
  mempoolGauge,
  statusRowText,
} from "../src/themes/board/header.js";
import { BOARD_COLS } from "../src/themes/board/rows.js";

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

test("detailBlockLabel shows spend count and fees (in XCH) when loaded", () => {
  expect(detailBlockLabel(1234567, "loaded", 5, "52000000")).toBe(
    "BLOCK 1234567   5 SPENDS   0.000052 XCH FEES"
  );
});

test("fees print in XCH, trimmed to 6 decimals, and fit the 48-col row", () => {
  expect(feesText("0")).toBe("0 XCH FEES");
  expect(feesText("1500000000000")).toBe("1.5 XCH FEES");
  expect(feesText("123")).toBe("0 XCH FEES"); // dust below 1e-6 XCH truncates
  // a busy 8-digit-height block with a big fee still fits the board
  expect(blockLabel(12345678, 1234, "12345678901234").length).toBeLessThanOrEqual(BOARD_COLS);
  expect(blockLabel(8123456, 812, "250000000").length).toBeLessThanOrEqual(BOARD_COLS);
});

test("agoText formats m:ss and h:mm:ss, clamping bad input", () => {
  expect(agoText(0)).toBe("0:00");
  expect(agoText(34.9)).toBe("0:34");
  expect(agoText(125)).toBe("2:05");
  expect(agoText(3725)).toBe("1:02:05");
  expect(agoText(-5)).toBe("0:00"); // client clock behind the block timestamp
  expect(agoText(NaN)).toBe("0:00");
});

test("live status row shows time since the last block when known", () => {
  expect(statusRowText("live", "01:02:03", 34)).toBe("01:02:03   LIVE   LAST BLOCK 0:34 AGO");
  expect(statusRowText("live", "01:02:03", null)).toBe("01:02:03   LIVE");
  // history/detail keep their own (longer) markers
  expect(statusRowText("history", "01:02:03", 34)).not.toContain("LAST BLOCK");
  expect(statusRowText("live", "01:02:03", 3725).length).toBeLessThanOrEqual(BOARD_COLS);
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
