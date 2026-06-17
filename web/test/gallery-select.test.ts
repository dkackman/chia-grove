import { expect, test } from "vitest";
import type { SproutEvent } from "@grove/shared";
import { shouldHang } from "../src/themes/gallery/select.js";

const sprout = (over: Partial<SproutEvent>): SproutEvent => ({
  type: "sprout",
  kind: "nft",
  height: 1,
  coinId: "ab".repeat(32),
  amount: "1",
  launcherId: "cd".repeat(32),
  mediaKind: "image",
  ...over,
});

test("hangs any NFT that carries art (mediaKind set), minted or not", () => {
  expect(shouldHang(sprout({ mint: true }))).toBe(true);
  expect(shouldHang(sprout({ mint: false }))).toBe(true);
  expect(shouldHang(sprout({ mint: undefined }))).toBe(true);
});

test("skips NFTs without a usable image (no mediaKind)", () => {
  expect(shouldHang(sprout({ mediaKind: undefined }))).toBe(false);
});

test("skips non-NFT kinds", () => {
  expect(shouldHang(sprout({ kind: "xch" }))).toBe(false);
  expect(shouldHang(sprout({ kind: "cat" }))).toBe(false);
});
