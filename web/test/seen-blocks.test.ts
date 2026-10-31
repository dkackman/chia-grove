import { expect, test } from "vitest";
import type { GroveEvent } from "@grove/shared";
import { SeenBlocks } from "../src/net/seen-blocks.js";

const block = (height: number, hash = `h${height}`): GroveEvent => ({
  type: "block",
  height,
  headerHash: hash,
  timestamp: 0,
  spendCount: 1,
  fees: "0",
});
const sprout = (height: number, coinId = `c${height}`): GroveEvent => ({
  type: "sprout",
  kind: "xch",
  height,
  coinId,
  amount: "1",
});
const ambient: GroveEvent = {
  type: "ambient",
  peakHeight: 9,
  mempoolSize: 0,
  mempoolCost: "0",
  mempoolFees: "0",
  netspace: "0",
};
const flag: GroveEvent = { type: "content-flag", launcherId: "aa", mediaFilter: "sensitive" };
const reorg = (forkHeight: number): GroveEvent => ({ type: "reorg", forkHeight });

function seenWith(events: GroveEvent[]): SeenBlocks {
  const seen = new SeenBlocks();
  for (const e of events) seen.record(e);
  return seen;
}

test("the first snapshot passes through untouched", () => {
  const events = [block(1), sprout(1), ambient];
  expect(new SeenBlocks().filterSnapshot(events)).toBe(events);
});

test("drops already-dispatched blocks and their sprouts; keeps ambient and content-flag", () => {
  const seen = seenWith([block(1), sprout(1), block(2), sprout(2)]);
  const out = seen.filterSnapshot([
    block(1),
    sprout(1),
    ambient,
    block(2),
    sprout(2),
    flag,
    block(3),
    sprout(3),
  ]);
  expect(out).toEqual([ambient, flag, block(3), sprout(3)]);
});

test("sprouts whose block was evicted from the ring buffer are dropped if the height is known", () => {
  const seen = seenWith([block(1), sprout(1), block(2)]);
  expect(seen.filterSnapshot([sprout(1, "x"), block(2), block(3)])).toEqual([block(3)]);
});

test("a reorg the client already applied is not replayed", () => {
  // client saw: 1, 2, 3(orphan) → reorg at 3 → 3b, 4
  const seen = seenWith([block(1), block(2), block(3), reorg(3), block(3, "h3b"), block(4)]);
  const snapshot = [block(1), block(2), block(3), reorg(3), block(3, "h3b"), block(4), block(5)];
  expect(seen.filterSnapshot(snapshot)).toEqual([block(5)]);
});

test("a reorg that happened while disconnected passes, with its replacement blocks", () => {
  const seen = seenWith([block(1), block(2), sprout(2), block(3)]);
  const snapshot = [
    block(1),
    block(2),
    sprout(2),
    block(3),
    reorg(2),
    block(2, "h2b"),
    sprout(2, "n"),
    block(3, "h3b"),
  ];
  expect(seen.filterSnapshot(snapshot)).toEqual([
    reorg(2),
    block(2, "h2b"),
    sprout(2, "n"),
    block(3, "h3b"),
  ]);
});

test("a trailing reorg with no following block passes (re-applying is harmless)", () => {
  const seen = seenWith([block(1), block(2)]);
  expect(seen.filterSnapshot([block(1), block(2), reorg(2)])).toEqual([reorg(2)]);
});

test("recording a reorg forgets the invalidated heights", () => {
  const seen = seenWith([block(1), block(2), block(3), reorg(2)]);
  expect(seen.filterSnapshot([block(1), block(2), block(3)])).toEqual([block(2), block(3)]);
});
