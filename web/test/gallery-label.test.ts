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
  launcherId: "cd".repeat(32),
  nftId: "nft1abcdef",
};

test("placard summarizes the mint and its amount/block", () => {
  const m = placardModel(base);
  expect(m.title).toBe("NFT mint");
  expect(m.meta).toBe("1.5 XCH · block 8853512");
  expect(m.coin).toMatch(/^coin ab/);
});

test("title reflects whether the latest event was a mint", () => {
  expect(placardModel({ ...base, mint: true }).title).toBe("NFT mint");
  expect(placardModel({ ...base, mint: undefined }).title).toBe("NFT");
});

test("activity tally appears only once the NFT has had more than one event", () => {
  expect(placardModel(base).activity).toBeNull();
  expect(placardModel(base, 1).activity).toBeNull();
  expect(placardModel(base, 5).activity).toBe("5 events");
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

test("media reflects the resolver: blur for sensitive, placeholder for blocked, art otherwise", () => {
  expect(placardModel({ ...base, mediaKind: "image", mediaFilter: "sensitive" }).media).toEqual({
    render: "blur",
    src: `/img?nft=${base.launcherId}`,
    kind: "image",
  });
  expect(placardModel({ ...base, mediaKind: "image", mediaFilter: "blocked" }).media).toEqual({
    render: "placeholder",
  });
  expect(placardModel({ ...base, mediaKind: "image" }).media).toEqual({
    render: "art",
    src: `/img?nft=${base.launcherId}`,
    kind: "image",
  });
});
