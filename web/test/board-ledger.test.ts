import { expect, test } from "vitest";
import type { SproutEvent } from "@grove/shared";
import { BlockLedger } from "../src/themes/board/ledger.js";
import { toDisplayRows } from "../src/themes/board/rows.js";
import { mulberry32 } from "../src/themes/shared/util.js";

let n = 0;
function sprout(over: Partial<SproutEvent>): SproutEvent {
  return {
    type: "sprout",
    kind: "xch",
    height: 100,
    coinId: (n++).toString(16).padStart(64, "0"),
    amount: "1000",
    ...over,
  };
}

/** A pseudo-random arrival stream: heights non-decreasing, mixed kinds/assets. */
function stream(seed: number, count: number): SproutEvent[] {
  const rnd = mulberry32(seed);
  const out: SproutEvent[] = [];
  let height = 1000;
  for (let i = 0; i < count; i++) {
    if (rnd() < 0.08) height += 1 + Math.floor(rnd() * 3);
    const k = rnd();
    const kind = k < 0.45 ? "xch" : k < 0.75 ? "cat" : k < 0.92 ? "nft" : "did";
    const asset = ["aa", "bb", "cc"][Math.floor(rnd() * 3)];
    out.push(
      sprout({
        kind,
        height,
        amount: String(1 + Math.floor(rnd() * 1e6)),
        ...(kind === "cat" ? { assetId: asset, catTicker: asset.toUpperCase() } : {}),
        ...(kind === "nft" ? { launcherId: `L${i}` } : {}),
      })
    );
  }
  return out;
}

test("incremental per-block rows match toDisplayRows over the same spends", () => {
  for (const seed of [1, 2, 3, 42]) {
    const events = stream(seed, 600);
    const ledger = new BlockLedger();
    for (const e of events) ledger.add(e);
    expect(ledger.rows()).toEqual(toDisplayRows([...events].reverse()));
  }
});

test("the cap counts blocks, so one huge block doesn't wipe the scrollback", () => {
  const ledger = new BlockLedger(300);
  for (let h = 1; h <= 50; h++) ledger.add(sprout({ height: h }));
  // a 5000-spend XCH block folds into a single aggregate row
  for (let i = 0; i < 5000; i++) ledger.add(sprout({ height: 51 }));
  expect(ledger.blockCount).toBe(51);
  expect(ledger.rows().length).toBe(51);
  expect(ledger.rows()[ledger.rows().length - 1].height).toBe(1); // oldest still there
});

test("keeps only the newest maxBlocks blocks", () => {
  const ledger = new BlockLedger(3);
  for (let h = 1; h <= 5; h++) ledger.add(sprout({ height: h }));
  expect(ledger.rows().map((r) => r.height)).toEqual([5, 4, 3]);
  ledger.add(sprout({ height: 1 })); // older than everything kept: dropped
  expect(ledger.rows().map((r) => r.height)).toEqual([5, 4, 3]);
});

test("reorg drops every block at or above the fork height", () => {
  const ledger = new BlockLedger();
  for (let h = 1; h <= 5; h++) ledger.add(sprout({ height: h }));
  expect(ledger.reorg(4)).toBe(true);
  expect(ledger.rows().map((r) => r.height)).toEqual([3, 2, 1]);
  expect(ledger.reorg(10)).toBe(false);
});

test("a late spend for an older block lands in that block", () => {
  const ledger = new BlockLedger();
  ledger.add(sprout({ height: 1 }));
  ledger.add(sprout({ height: 3 }));
  ledger.add(sprout({ height: 1, kind: "nft", launcherId: "x" }));
  expect(ledger.rows().map((r) => r.height)).toEqual([3, 1, 1]);
  expect(ledger.sprouts().map((r) => r.launcherId)).toEqual(["x"]);
});
