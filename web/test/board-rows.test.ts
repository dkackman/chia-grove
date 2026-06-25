import { expect, test } from "vitest";
import { BOARD_COLS, rowText, rowTextFor, toDisplayRows } from "../src/themes/board/rows.js";
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
  expect(t).toContain("SUPERLONGTI"); // 11-char asset clamp
  expect(t).not.toContain("SUPERLONGTICKER");
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
  expect(t).toContain("2×"); // count marker
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
  expect(t).toContain("2×"); // 2 spends
  expect(t).toContain("800");
});

test("rowTextFor individual sprout row delegates to rowText", () => {
  const e = sprout({ kind: "nft", mint: true, height: 900 });
  const rows = toDisplayRows([e]);
  expect(rowTextFor(rows[0])).toBe(rowText(e));
});
