import { expect, test, vi } from "vitest";
import { BlockDetail } from "../src/themes/board/detail.js";
import type { DetailState } from "../src/themes/board/detail.js";
import type { GroveEvent } from "@grove/shared";

function sprout(height: number): GroveEvent {
  return { type: "sprout", kind: "xch", height, coinId: "00".repeat(32), amount: "1000" };
}

test("load() reports loading, then loaded with rows and block stats", async () => {
  const states: DetailState[] = [];
  const detail = new BlockDetail(
    async (height) => ({
      events: [
        { type: "block", height, headerHash: "aa", timestamp: 1, spendCount: 2, fees: "50" },
        sprout(height),
        sprout(height),
      ],
    }),
    (s) => states.push(s)
  );
  await detail.load(500);
  expect(states.map((s) => s.status)).toEqual(["loading", "loaded"]);
  expect(states[1].rows).toHaveLength(2);
  expect(states[1].spendCount).toBe(2);
  expect(states[1].fees).toBe("50");
  expect(states[1].height).toBe(500);
});

test("a block with no sprout events reports empty, not loaded", async () => {
  const states: DetailState[] = [];
  const detail = new BlockDetail(
    async (height) => ({
      events: [{ type: "block", height, headerHash: "aa", timestamp: 1, spendCount: 0, fees: "0" }],
    }),
    (s) => states.push(s)
  );
  await detail.load(500);
  expect(states.at(-1)!.status).toBe("empty");
  expect(states.at(-1)!.rows).toEqual([]);
});

test("a fetch failure reports error", async () => {
  const states: DetailState[] = [];
  const detail = new BlockDetail(
    async () => {
      throw new Error("network down");
    },
    (s) => states.push(s)
  );
  await detail.load(500);
  expect(states.map((s) => s.status)).toEqual(["loading", "error"]);
});

test("currentHeight reflects the most recently requested height", async () => {
  const detail = new BlockDetail(
    async (height) => ({
      events: [{ type: "block", height, headerHash: "", timestamp: 1, spendCount: 0, fees: "0" }],
    }),
    () => {}
  );
  await detail.load(700);
  expect(detail.currentHeight).toBe(700);
});

test("a stale response is dropped when a newer load supersedes it before it resolves", async () => {
  const states: DetailState[] = [];
  let resolveFirst!: (v: { events: GroveEvent[] }) => void;
  const fetchBlock = vi
    .fn()
    .mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
    .mockImplementationOnce(async (height: number) => ({
      events: [
        { type: "block", height, headerHash: "", timestamp: 1, spendCount: 1, fees: "0" },
        sprout(height),
      ],
    }));
  const detail = new BlockDetail(fetchBlock, (s) => states.push(s));

  const first = detail.load(100); // stays pending until resolveFirst() is called
  await detail.load(200); // resolves immediately, supersedes 100
  resolveFirst!({
    events: [
      { type: "block", height: 100, headerHash: "", timestamp: 1, spendCount: 0, fees: "0" },
    ],
  });
  await first;

  // 100's late resolution must not overwrite the now-current view of block 200
  expect(states.map((s) => `${s.status}:${s.height}`)).toEqual([
    "loading:100",
    "loading:200",
    "loaded:200",
  ]);
});
