import { expect, test } from "vitest";
import type { SproutEvent } from "@grove/shared";
import { shouldHang } from "../src/themes/gallery/select.js";

const sprout = (over: Partial<SproutEvent>): SproutEvent => ({
  type: "sprout",
  kind: "nft",
  height: 1,
  coinId: "ab".repeat(32),
  amount: "1000000000000",
  mint: true,
  imageUrl: "https://example.test/a.png",
  ...over,
});

test("hangs minted NFTs that carry an image", () => {
  expect(shouldHang(sprout({}))).toBe(true);
});

test("skips non-mint NFTs", () => {
  expect(shouldHang(sprout({ mint: false }))).toBe(false);
  expect(shouldHang(sprout({ mint: undefined }))).toBe(false);
});

test("skips NFTs without a usable image", () => {
  expect(shouldHang(sprout({ imageUrl: undefined }))).toBe(false);
  expect(shouldHang(sprout({ imageUrl: "" }))).toBe(false);
});

test("skips non-NFT kinds", () => {
  expect(shouldHang(sprout({ kind: "xch" }))).toBe(false);
  expect(shouldHang(sprout({ kind: "cat" }))).toBe(false);
});
