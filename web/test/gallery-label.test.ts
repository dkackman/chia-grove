import { expect, test } from "vitest";
import type { SproutEvent } from "@grove/shared";
import { placardModel } from "../src/themes/gallery/label.js";

const base: SproutEvent = {
  type: "sprout",
  kind: "nft",
  height: 8853512,
  coinId: "ab".repeat(32),
  amount: "1500000000000",
  mint: true,
  imageUrl: "https://example.test/a.png",
  launcherId: "cd".repeat(32),
  nftId: "nft1abcdef",
};

test("placard summarizes the mint and its amount/block", () => {
  const m = placardModel(base);
  expect(m.title).toBe("NFT mint");
  expect(m.meta).toBe("1.5 XCH · block 8853512");
  expect(m.coin).toMatch(/^coin ab/);
});

test("links point at spacescan and mintgarden", () => {
  const m = placardModel(base);
  expect(m.links).toContainEqual({
    label: "view on spacescan ↗",
    href: `https://www.spacescan.io/coin/0x${base.coinId}`,
  });
  expect(m.links).toContainEqual({
    label: "view on mintgarden ↗",
    href: "https://mintgarden.io/nfts/nft1abcdef",
  });
});

test("launcher line omitted when absent, mintgarden link omitted without nftId", () => {
  const m = placardModel({ ...base, launcherId: undefined, nftId: undefined });
  expect(m.launcher).toBeNull();
  expect(m.links.some((l) => l.href.includes("mintgarden"))).toBe(false);
});
