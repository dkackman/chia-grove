import { expect, test } from "vitest";
import { BOARD_COLS, rowText } from "../src/themes/board/rows.js";
import type { SproutEvent } from "@grove/shared";

function sprout(over: Partial<SproutEvent>): SproutEvent {
  return { type: "sprout", kind: "xch", height: 100, coinId: "00".repeat(32), amount: "0", ...over };
}

test("every row is exactly BOARD_COLS wide", () => {
  expect(rowText(sprout({})).length).toBe(BOARD_COLS);
  expect(rowText(sprout({ kind: "nft", mint: true })).length).toBe(BOARD_COLS);
  expect(rowText(sprout({ kind: "cat", catTicker: "SBX", amount: "250000" })).length).toBe(BOARD_COLS);
});

test("xch row shows kind, amount, block, CONFIRM", () => {
  const t = rowText(sprout({ kind: "xch", amount: "1500000000000", height: 5121 }));
  expect(t).toContain("XCH");
  expect(t).toContain("1.5");
  expect(t).toContain("5121");
  expect(t).toContain("CONFRM");
});

test("nft mint shows MINT and the new-mint marker", () => {
  const t = rowText(sprout({ kind: "nft", mint: true, height: 5121 }));
  expect(t).toContain("MINT");
  expect(t).toContain("★");
});

test("cat row shows the ticker (truncated) and token amount", () => {
  const t = rowText(sprout({ kind: "cat", catTicker: "SUPERLONGTICKER", amount: "250000" }));
  expect(t).toContain("SUPERLONGTIC"); // 12-char clamp
  expect(t).not.toContain("SUPERLONGTICKER");
});

test("did and amount-less kinds use a dash placeholder", () => {
  const t = rowText(sprout({ kind: "did" }));
  expect(t).toContain("PROFILE");
  expect(t).toContain("-"); // amount placeholder
});
