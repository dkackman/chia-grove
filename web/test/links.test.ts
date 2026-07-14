import { expect, test } from "vitest";
import { spacescanLink, mintgardenLink } from "../src/ui/links.js";

test("spacescanLink points at the coin by default", () => {
  expect(spacescanLink({ coinId: "ab".repeat(32), height: 100 })).toEqual({
    label: "view on spacescan ↗",
    href: `https://www.spacescan.io/coin/0x${"ab".repeat(32)}`,
  });
});

test("spacescanLink points at the block when aggregateCount > 1", () => {
  expect(spacescanLink({ coinId: "ab".repeat(32), height: 100 }, 3)).toEqual({
    label: "view block on spacescan ↗",
    href: "https://www.spacescan.io/block/100",
  });
});

test("spacescanLink treats aggregateCount of 1 or undefined as a single spend", () => {
  const single = spacescanLink({ coinId: "cd".repeat(32), height: 5 });
  expect(spacescanLink({ coinId: "cd".repeat(32), height: 5 }, 1)).toEqual(single);
});

test("mintgardenLink is present only when nftId is set", () => {
  expect(mintgardenLink("nft1abc")).toEqual({
    label: "view on mintgarden ↗",
    href: "https://mintgarden.io/nfts/nft1abc",
  });
  expect(mintgardenLink(undefined)).toBeUndefined();
});
