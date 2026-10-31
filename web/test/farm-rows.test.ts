import { expect, test } from "vitest";
import {
  blockAgeSeconds,
  contiguousBand,
  isReplayBlock,
  REPLAY_AGE_SECONDS,
  RowPlanner,
} from "../src/themes/farm/rows.js";

test("blocks take rows in order and wrap after the last row", () => {
  const rows = new RowPlanner(4);
  expect([100, 101, 102, 103].map((h) => rows.next(h))).toEqual([0, 1, 2, 3]);
  expect(rows.next(104)).toBe(0);
  expect(rows.currentRow).toBe(0);
  // the wrapped row forgets its previous owner
  expect(rows.rowOfHeight(100)).toBeUndefined();
  expect(rows.rowOfHeight(104)).toBe(0);
  expect(rows.rowOfHeight(103)).toBe(3);
});

test("a reorg rewinds so replacement blocks reuse the invalidated rows", () => {
  const rows = new RowPlanner(48);
  for (let h = 10; h < 20; h++) rows.next(h); // rows 0..9
  const removed = rows.rewind(17); // 17, 18, 19 invalidated
  expect(removed).toEqual([9, 8, 7]); // newest first
  expect(rows.currentRow).toBe(6);
  expect(rows.rowOfHeight(17)).toBeUndefined();
  expect(rows.rowOfHeight(16)).toBe(6);
  // the replacement chain re-plows rows 7, 8, 9 rather than leaving them dead
  expect([17, 18, 19, 20].map((h) => rows.next(h))).toEqual([7, 8, 9, 10]);
});

test("a rewind across the wrap stays modulo the field", () => {
  const rows = new RowPlanner(4);
  for (let h = 1; h <= 6; h++) rows.next(h); // rows 0,1,2,3,0,1
  expect(rows.rewind(5)).toEqual([1, 0]);
  expect(rows.currentRow).toBe(3);
  expect(rows.next(5)).toBe(0);
  expect(rows.recentRows(3)).toEqual([0, 3, 2]);
});

test("a fork above every block removes nothing; fork 0 clears everything", () => {
  const rows = new RowPlanner(48);
  for (let h = 10; h < 13; h++) rows.next(h);
  expect(rows.rewind(99)).toEqual([]);
  expect(rows.next(13)).toBe(3);
  expect(rows.rewind(0).sort()).toEqual([0, 1, 2, 3]);
  expect(rows.allocated).toBe(0);
  expect(rows.next(50)).toBe(0);
});

test("recent rows wrap modulo the field and never exceed what was plowed", () => {
  const rows = new RowPlanner(48);
  expect(rows.recentRows(6)).toEqual([]);
  rows.next(1);
  rows.next(2);
  expect(rows.recentRows(6)).toEqual([1, 0]);
  for (let h = 3; h <= 50; h++) rows.next(h); // 50 blocks: last rows are 1, 0, 47, 46...
  expect(rows.recentRows(4)).toEqual([1, 0, 47, 46]);
});

test("the crow band follows the newest row and stops at the wrap", () => {
  expect(contiguousBand([])).toEqual([]);
  expect(contiguousBand([9, 8, 7, 6, 5, 4])).toEqual([4, 5, 6, 7, 8, 9]);
  // wrapped: newest is row 1, so the band is rows 0-1, not 0..47
  expect(contiguousBand([1, 0, 47, 46, 45])).toEqual([0, 1]);
  // newest at the far end, just before the wrap
  expect(contiguousBand([47, 46, 45])).toEqual([45, 46, 47]);
});

test("old blocks are snapshot replay, fresh ones are live", () => {
  const now = 1_700_000_000_000;
  const nowS = now / 1000;
  expect(isReplayBlock(nowS, now)).toBe(false);
  expect(isReplayBlock(nowS - 52, now)).toBe(false);
  expect(isReplayBlock(nowS - REPLAY_AGE_SECONDS - 1, now)).toBe(true);
  expect(isReplayBlock(nowS - 3600, now)).toBe(true);
  // a block stamped slightly in the future (clock skew) is live
  expect(isReplayBlock(nowS + 5, now)).toBe(false);
  expect(blockAgeSeconds(nowS - 90, now)).toBeCloseTo(90);
  expect(blockAgeSeconds(nowS + 5, now)).toBe(0);
});
