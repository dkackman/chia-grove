import { expect, test } from "vitest";
import { BOARD, kindAccent } from "../src/themes/board/palette.js";
import type { SproutEvent } from "@grove/shared";

function sprout(over: Partial<SproutEvent>): SproutEvent {
  return { type: "sprout", kind: "xch", height: 1, coinId: "00".repeat(32), amount: "0", ...over };
}

test("BOARD palette has the colors the scene needs", () => {
  for (const key of ["backdrop", "housing", "flapFace", "flapText", "live"] as const) {
    expect(typeof BOARD[key]).toBe("number");
  }
});

test("kindAccent gives each kind a distinct base color", () => {
  const xch = kindAccent(sprout({ kind: "xch" }));
  const nft = kindAccent(sprout({ kind: "nft" }));
  const did = kindAccent(sprout({ kind: "did" }));
  expect(xch.getHex()).not.toBe(nft.getHex());
  expect(nft.getHex()).not.toBe(did.getHex());
});

test("CAT accent is deterministic from assetId and varies by asset", () => {
  const a = kindAccent(sprout({ kind: "cat", assetId: "ab".repeat(32) }));
  const b = kindAccent(sprout({ kind: "cat", assetId: "ab".repeat(32) }));
  const c = kindAccent(sprout({ kind: "cat", assetId: "cd".repeat(32) }));
  expect(a.getHex()).toBe(b.getHex());
  expect(a.getHex()).not.toBe(c.getHex());
});
