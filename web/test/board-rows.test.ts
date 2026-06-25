import { expect, test } from "vitest";
import { BOARD_COLS, isBlockStart, rowText, rowTextFor, shouldShowHeight, toDisplayRows } from "../src/themes/board/rows.js";
import type { AggregatedRow } from "../src/themes/board/rows.js";
import type { SproutEvent } from "@grove/shared";

function sprout(over: Partial<SproutEvent>): SproutEvent {
  return { type: "sprout", kind: "xch", height: 100, coinId: "00".repeat(32), amount: "0", ...over };
}

test("every row is exactly BOARD_COLS wide", () => {
  expect(rowText(sprout({})).length).toBe(BOARD_COLS);
  expect(rowText(sprout({ kind: "nft", mint: true })).length).toBe(BOARD_COLS);
  expect(rowText(sprout({ kind: "cat", catTicker: "SBX", amount: "250000" })).length).toBe(BOARD_COLS);
});

test("xch row shows kind, amount, block, CONFIRMED status", () => {
  const t = rowText(sprout({ kind: "xch", amount: "1500000000000", height: 5121 }));
  expect(t).toContain("XCH");
  expect(t).toContain("1.5");
  expect(t).toContain("5121");
  expect(t).toContain("CONFIRMED");
});

test("nft mint shows MINT and the new-mint marker", () => {
  const t = rowText(sprout({ kind: "nft", mint: true, height: 5121 }));
  expect(t).toContain("MINT");
  expect(t).toContain("★");
});

test("cat row shows the ticker (truncated) and token amount", () => {
  const t = rowText(sprout({ kind: "cat", catTicker: "SUPERLONGTICKER", amount: "250000" }));
  expect(t).toContain("SUPERLONGTIC"); // 12-char asset clamp
  expect(t).not.toContain("SUPERLONGTICK");
});

test("did and amount-less kinds use a dash placeholder", () => {
  const t = rowText(sprout({ kind: "did" }));
  expect(t).toContain("PROFILE");
  expect(t).toContain("-"); // amount placeholder
});

// --- toDisplayRows ---

test("empty events produces empty display rows", () => {
  expect(toDisplayRows([])).toEqual([]);
});

test("single xch spend becomes one aggregated row", () => {
  const rows = toDisplayRows([sprout({ kind: "xch", amount: "1000000000000", height: 200 })]);
  expect(rows).toHaveLength(1);
  expect(rows[0].type).toBe("aggregated");
  if (rows[0].type === "aggregated") {
    expect(rows[0].kind).toBe("xch");
    expect(rows[0].totalMojos).toBe(1000000000000n);
    expect(rows[0].count).toBe(1);
    expect(rows[0].height).toBe(200);
  }
});

test("two xch spends in same block merge into one aggregated row with summed mojos", () => {
  const events = [
    sprout({ kind: "xch", amount: "500000000000", height: 300 }),
    sprout({ kind: "xch", amount: "300000000000", height: 300 }),
  ];
  const rows = toDisplayRows(events);
  expect(rows).toHaveLength(1);
  expect(rows[0].type).toBe("aggregated");
  if (rows[0].type === "aggregated") {
    expect(rows[0].totalMojos).toBe(800000000000n);
    expect(rows[0].count).toBe(2);
  }
});

test("two different cat assets in same block produce two aggregated rows", () => {
  const events = [
    sprout({ kind: "cat", assetId: "aaa", catTicker: "SBX", amount: "1000", height: 400 }),
    sprout({ kind: "cat", assetId: "bbb", catTicker: "DBX", amount: "2000", height: 400 }),
  ];
  const rows = toDisplayRows(events);
  expect(rows).toHaveLength(2);
  expect(rows.every((r) => r.type === "aggregated")).toBe(true);
  const tickers = (rows as AggregatedRow[]).map((r) => r.catTicker);
  expect(tickers).toContain("SBX");
  expect(tickers).toContain("DBX");
});

test("same cat asset across two blocks produces two separate aggregated rows", () => {
  const events = [
    sprout({ kind: "cat", assetId: "aaa", catTicker: "SBX", amount: "1000", height: 501 }),
    sprout({ kind: "cat", assetId: "aaa", catTicker: "SBX", amount: "2000", height: 500 }),
  ];
  const rows = toDisplayRows(events);
  expect(rows).toHaveLength(2);
  expect(rows[0].type).toBe("aggregated");
  expect(rows[1].type).toBe("aggregated");
  if (rows[0].type === "aggregated" && rows[1].type === "aggregated") {
    expect(rows[0].height).toBe(501);
    expect(rows[1].height).toBe(500);
  }
});

test("nft and did events are always individual rows", () => {
  const events = [
    sprout({ kind: "nft", mint: true, height: 600 }),
    sprout({ kind: "did", height: 600 }),
  ];
  const rows = toDisplayRows(events);
  expect(rows).toHaveLength(2);
  expect(rows[0].type).toBe("sprout");
  expect(rows[1].type).toBe("sprout");
});

test("mixed block emits rows in order: xch agg, cat agg, nft, did", () => {
  const events = [
    sprout({ kind: "did", height: 700 }),
    sprout({ kind: "nft", mint: true, height: 700 }),
    sprout({ kind: "cat", assetId: "ccc", catTicker: "DBX", amount: "500", height: 700 }),
    sprout({ kind: "xch", amount: "1000000000000", height: 700 }),
  ];
  const rows = toDisplayRows(events);
  expect(rows).toHaveLength(4);
  expect(rows[0].type).toBe("aggregated");
  if (rows[0].type === "aggregated") expect(rows[0].kind).toBe("xch");
  expect(rows[1].type).toBe("aggregated");
  if (rows[1].type === "aggregated") expect(rows[1].kind).toBe("cat");
  expect(rows[2].type).toBe("sprout");
  if (rows[2].type === "sprout") expect(rows[2].kind).toBe("nft");
  expect(rows[3].type).toBe("sprout");
  if (rows[3].type === "sprout") expect(rows[3].kind).toBe("did");
});

// --- rowTextFor ---

test("rowTextFor aggregated xch row is exactly BOARD_COLS wide", () => {
  const rows = toDisplayRows([
    sprout({ kind: "xch", amount: "1500000000000", height: 5121 }),
    sprout({ kind: "xch", amount: "500000000000", height: 5121 }),
  ]);
  expect(rowTextFor(rows[0]).length).toBe(BOARD_COLS);
});

test("rowTextFor aggregated xch shows kind, summed amount, block, and count marker", () => {
  // 1.5 XCH + 0.5 XCH = 2 XCH total, count = 2
  const rows = toDisplayRows([
    sprout({ kind: "xch", amount: "1500000000000", height: 5121 }),
    sprout({ kind: "xch", amount: "500000000000", height: 5121 }),
  ]);
  const t = rowTextFor(rows[0]);
  expect(t).toContain("XCH");
  expect(t).toContain("2 SPENDS"); // count
  expect(t).toContain("5121");
  expect(t).toContain("2"); // "2" XCH total
});

test("rowTextFor aggregated cat row is BOARD_COLS wide and shows ticker and count", () => {
  // 2 spends of SBX
  const rows = toDisplayRows([
    sprout({ kind: "cat", assetId: "aaa", catTicker: "SBX", amount: "1000", height: 800 }),
    sprout({ kind: "cat", assetId: "aaa", catTicker: "SBX", amount: "2000", height: 800 }),
  ]);
  const t = rowTextFor(rows[0]);
  expect(t.length).toBe(BOARD_COLS);
  expect(t).toContain("CAT");
  expect(t).toContain("SBX");
  expect(t).toContain("2 SPENDS"); // 2 spends
  expect(t).toContain("800");
});

test("a single spend reads '1 SPEND' (singular)", () => {
  const rows = toDisplayRows([sprout({ kind: "cat", assetId: "aaa", catTicker: "SBX", amount: "1000", height: 800 })]);
  const t = rowTextFor(rows[0]);
  expect(t.length).toBe(BOARD_COLS);
  expect(t).toContain("1 SPEND");
  expect(t).not.toContain("1 SPENDS");
});

test("rowTextFor individual sprout row delegates to rowText", () => {
  const e = sprout({ kind: "nft", mint: true, height: 900 });
  const rows = toDisplayRows([e]);
  expect(rowTextFor(rows[0])).toBe(rowText(e));
});

// --- showHeight option ---

test("rowText with showHeight:false blanks the height span but stays 48 wide", () => {
  const e = sprout({ kind: "xch", amount: "1500000000000", height: 5121 });
  const shown = rowText(e, { showHeight: true });
  const hidden = rowText(e, { showHeight: false });
  expect(hidden.length).toBe(BOARD_COLS);
  expect(hidden).not.toContain("5121"); // height digits gone
  expect(hidden).toContain("XCH"); // other fields intact
  expect(hidden).toContain("CONFIRMED");
  // only the 8-char height span differs between shown and hidden
  expect(shown.length).toBe(hidden.length);
});

test("rowText defaults to showing the height", () => {
  const e = sprout({ kind: "xch", amount: "1500000000000", height: 5121 });
  expect(rowText(e)).toBe(rowText(e, { showHeight: true }));
  expect(rowText(e)).toContain("5121");
});

test("rowText lays out height first, then kind, then asset", () => {
  const t = rowText(sprout({ kind: "cat", catTicker: "SBX", amount: "1000", height: 5121 }));
  expect(t.indexOf("5121")).toBeGreaterThanOrEqual(0);
  expect(t.indexOf("5121")).toBeLessThan(t.indexOf("CAT"));
  expect(t.indexOf("CAT")).toBeLessThan(t.indexOf("SBX"));
});

test("rowText left-aligns the height so column 0 is never a blank margin", () => {
  // current Chia heights are 7 digits in an 8-wide field; left-aligning keeps
  // the first digit flush at column 0 (aligned with the flush-left header)
  const t = rowText(sprout({ kind: "xch", amount: "1000", height: 5121 }));
  expect(t.startsWith("5121")).toBe(true);
  expect(t[0]).not.toBe(" ");
});

test("rowTextFor with showHeight:false blanks the height on an aggregated row", () => {
  const rows = toDisplayRows([
    sprout({ kind: "cat", assetId: "aaa", catTicker: "SBX", amount: "1000", height: 8421 }),
    sprout({ kind: "cat", assetId: "aaa", catTicker: "SBX", amount: "2000", height: 8421 }),
  ]);
  const hidden = rowTextFor(rows[0], { showHeight: false });
  expect(hidden.length).toBe(BOARD_COLS);
  expect(hidden).not.toContain("8421");
  expect(hidden).toContain("SBX");
  expect(hidden).toContain("2 SPENDS");
});

// --- isBlockStart ---

test("isBlockStart is true when prev is undefined", () => {
  const rows = toDisplayRows([sprout({ kind: "xch", amount: "1000", height: 100 })]);
  expect(isBlockStart(undefined, rows[0])).toBe(true);
});

test("isBlockStart is false for a continuation row (same height as prev)", () => {
  const rows = toDisplayRows([
    sprout({ kind: "cat", assetId: "aaa", catTicker: "SBX", amount: "1000", height: 100 }),
    sprout({ kind: "cat", assetId: "bbb", catTicker: "DBX", amount: "2000", height: 100 }),
  ]);
  expect(isBlockStart(rows[0], rows[1])).toBe(false);
});

test("isBlockStart is true at a block boundary (height changes)", () => {
  const rows = toDisplayRows([
    sprout({ kind: "xch", amount: "1000", height: 101 }),
    sprout({ kind: "xch", amount: "2000", height: 100 }),
  ]);
  expect(isBlockStart(rows[0], rows[1])).toBe(true);
});

test("isBlockStart ignores the topmost-row override (unlike shouldShowHeight)", () => {
  // two distinct CATs in one block → two rows at the same height
  const rows = toDisplayRows([
    sprout({ kind: "cat", assetId: "aaa", catTicker: "SBX", amount: "1000", height: 100 }),
    sprout({ kind: "cat", assetId: "bbb", catTicker: "DBX", amount: "2000", height: 100 }),
  ]);
  // same height: not a block start even though shouldShowHeight(...true) would show it
  expect(isBlockStart(rows[0], rows[1])).toBe(false);
  expect(shouldShowHeight(rows[0], rows[1], true)).toBe(true);
});

// --- shouldShowHeight ---

test("shouldShowHeight is true for the topmost visible row regardless of neighbor", () => {
  const rows = toDisplayRows([
    sprout({ kind: "xch", amount: "1000", height: 100 }),
    sprout({ kind: "xch", amount: "2000", height: 100 }),
  ]);
  // rows[1] has the same height as rows[0], but as the top visible row it still shows
  expect(shouldShowHeight(rows[0], rows[1], true)).toBe(true);
});

test("shouldShowHeight is true when prev is undefined", () => {
  const rows = toDisplayRows([sprout({ kind: "xch", amount: "1000", height: 100 })]);
  expect(shouldShowHeight(undefined, rows[0], false)).toBe(true);
});

test("shouldShowHeight is false for a continuation row (same height as prev)", () => {
  const rows = toDisplayRows([
    sprout({ kind: "cat", assetId: "aaa", catTicker: "SBX", amount: "1000", height: 100 }),
    sprout({ kind: "cat", assetId: "bbb", catTicker: "DBX", amount: "2000", height: 100 }),
  ]);
  // two distinct CATs in the same block → two rows, same height
  expect(shouldShowHeight(rows[0], rows[1], false)).toBe(false);
});

test("shouldShowHeight is true at a block boundary (height changes)", () => {
  const rows = toDisplayRows([
    sprout({ kind: "xch", amount: "1000", height: 101 }),
    sprout({ kind: "xch", amount: "2000", height: 100 }),
  ]);
  expect(shouldShowHeight(rows[0], rows[1], false)).toBe(true);
});
