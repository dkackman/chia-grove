import { expect, test } from "vitest";
import { formatBlockLine, type BlockAgg } from "../src/ui/console.js";

const agg = (overrides: Partial<BlockAgg> = {}): BlockAgg => ({
  height: 8853512,
  spendCount: 14,
  cat: 0,
  nft: 0,
  did: 0,
  fees: "0",
  ...overrides,
});

test("plain block shows height and spends only", () => {
  expect(formatBlockLine(agg())).toBe("#8853512 · 14 spends");
});

test("singular spend", () => {
  expect(formatBlockLine(agg({ spendCount: 1 }))).toBe("#8853512 · 1 spend");
});

test("asset counts appear only when nonzero", () => {
  expect(formatBlockLine(agg({ cat: 3, nft: 1 }))).toBe("#8853512 · 14 spends · 3 cat · 1 nft");
  expect(formatBlockLine(agg({ did: 2 }))).toBe("#8853512 · 14 spends · 2 did");
});

test("fees shown in XCH when nonzero", () => {
  expect(formatBlockLine(agg({ fees: "50000000000" }))).toBe(
    "#8853512 · 14 spends · 0.05 XCH fees"
  );
});
