import { expect, test } from "vitest";
import { shouldShowArt } from "../src/themes/board/nowshowing.js";
import type { SproutEvent } from "@grove/shared";

function sprout(over: Partial<SproutEvent>): SproutEvent {
  return { type: "sprout", kind: "nft", height: 1, coinId: "00".repeat(32), amount: "0", ...over };
}

test("shows image NFTs that have proxiable art", () => {
  expect(shouldShowArt(sprout({ launcherId: "ab".repeat(32), mediaKind: "image" }))).toBe(true);
});

test("skips non-NFT, art-less, and non-image kinds", () => {
  expect(shouldShowArt(sprout({ kind: "xch" }))).toBe(false);
  expect(shouldShowArt(sprout({ launcherId: undefined, mediaKind: undefined }))).toBe(false);
  expect(shouldShowArt(sprout({ launcherId: "ab".repeat(32), mediaKind: "video" }))).toBe(false);
});
