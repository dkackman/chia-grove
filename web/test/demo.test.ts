import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { BlockEvent, GroveEvent } from "@grove/shared";
import { demoBacklog, startDemo, type DemoSink } from "../src/net/demo.js";

const blocks = (events: GroveEvent[]): BlockEvent[] =>
  events.filter((e): e is BlockEvent => e.type === "block");

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

test("backlog is contiguous, backdated history ending just below the tip", () => {
  const now = 1_800_000_000;
  const backlog = blocks(demoBacklog(7_000_000, now));
  expect(backlog).toHaveLength(30);
  expect(backlog.map((b) => b.height)).toEqual(
    Array.from({ length: 30 }, (_, i) => 7_000_000 - 30 + i)
  );
  // like a real connect: all but the newest couple are past themes' 120 s replay cutoff
  expect(backlog.filter((b) => now - b.timestamp > 120)).toHaveLength(28);
  // oldest first, strictly increasing timestamps
  for (let i = 1; i < backlog.length; i++)
    expect(backlog[i].timestamp).toBeGreaterThan(backlog[i - 1].timestamp);
});

test("backlog goes out as one snapshot; live blocks and ambient as batches", () => {
  const snapshots: GroveEvent[][] = [];
  const batches: GroveEvent[][] = [];
  const sink: DemoSink = {
    snapshot: (e) => snapshots.push(e),
    batch: (e) => batches.push(e),
  };
  startDemo(sink);
  expect(snapshots).toHaveLength(1);
  expect(blocks(snapshots[0])).toHaveLength(30);

  vi.advanceTimersByTime(8000);
  const live = batches.flat().filter((e) => e.type === "block");
  expect(live).toHaveLength(1);
  expect((live[0] as BlockEvent).height).toBe(7_000_000);
  expect(batches.flat().some((e) => e.type === "ambient")).toBe(true);
});

test("every 12th live block is preceded by a reorg replacing the previous height", () => {
  const events: GroveEvent[] = [];
  startDemo({ snapshot: () => {}, batch: (e) => events.push(...e) });
  vi.advanceTimersByTime(8000 * 12);
  const chain = events.filter((e) => e.type === "block" || e.type === "reorg");
  const reorgAt = chain.findIndex((e) => e.type === "reorg");
  expect(reorgAt).toBe(11);
  const reorg = chain[reorgAt] as { forkHeight: number };
  const replacement = chain[reorgAt + 1] as BlockEvent;
  expect(reorg.forkHeight).toBe(7_000_010);
  expect(replacement.height).toBe(7_000_010);
});
