import { expect, test, vi } from "vitest";
import { CoinsetPoller } from "../src/ingest/coinset-poller.js";
import type { BlockData, BlockInfo, ChainState, RpcView } from "../src/ingest/types.js";

interface FakeBlock {
  height: number;
  headerHash: string;
  prevHash: string;
  timestamp: bigint | null;
}

class FakeRpc implements RpcView {
  blocks = new Map<number, FakeBlock>();
  peak = 0;
  failState = false;

  chain(hashes: Array<{ h: number; hash: string; tx?: boolean }>): void {
    for (const { h, hash, tx = true } of hashes) {
      const prev = this.blocks.get(h - 1);
      this.blocks.set(h, {
        height: h,
        headerHash: hash,
        prevHash: prev?.headerHash ?? "genesis",
        timestamp: tx ? BigInt(1_700_000_000 + h) : null,
      });
      this.peak = Math.max(this.peak, h);
    }
  }

  async getState(): Promise<ChainState> {
    if (this.failState) throw new Error("boom");
    const peak = this.blocks.get(this.peak)!;
    return {
      peakHeight: peak.height,
      peakHeaderHash: peak.headerHash,
      mempoolSize: 7,
      mempoolCost: 100n,
      mempoolFees: 5n,
      space: 30n * 2n ** 60n,
    };
  }

  async getBlockInfo(height: number): Promise<BlockInfo> {
    const b = this.blocks.get(height);
    if (!b) throw new Error(`no block at ${height}`);
    return { ...b, fees: 1n };
  }

  async getSpends(): Promise<never[]> {
    return [];
  }
}

function collect() {
  const blocks: BlockData[] = [];
  const ambients: ChainState[] = [];
  const reorgs: number[] = [];
  return {
    blocks,
    ambients,
    reorgs,
    handlers: {
      onBlock: (b: BlockData) => { blocks.push(b); },
      onAmbient: (s: ChainState) => { ambients.push(s); },
      onReorg: (f: number) => { reorgs.push(f); },
    },
  };
}

test("backfills the last N transaction blocks on first tick", async () => {
  const rpc = new FakeRpc();
  rpc.chain(Array.from({ length: 20 }, (_, i) => ({ h: i, hash: `h${i}` })));
  const sink = collect();
  const poller = new CoinsetPoller(rpc, sink.handlers, { backfillBlocks: 5 });
  await poller.tick();
  expect(sink.blocks.map((b) => b.height)).toEqual([15, 16, 17, 18, 19]);
  expect(sink.ambients).toHaveLength(1);
});

test("walks multi-block jumps and skips non-transaction blocks", async () => {
  const rpc = new FakeRpc();
  rpc.chain([{ h: 0, hash: "h0" }]);
  const sink = collect();
  const poller = new CoinsetPoller(rpc, sink.handlers, { backfillBlocks: 1 });
  await poller.tick();
  rpc.chain([
    { h: 1, hash: "h1" },
    { h: 2, hash: "h2", tx: false },
    { h: 3, hash: "h3" },
  ]);
  await poller.tick();
  expect(sink.blocks.map((b) => b.height)).toEqual([0, 1, 3]);
});

test("detects a reorg, emits fork height, and re-walks the new chain", async () => {
  const rpc = new FakeRpc();
  rpc.chain([
    { h: 0, hash: "h0" },
    { h: 1, hash: "h1" },
    { h: 2, hash: "h2" },
  ]);
  const sink = collect();
  const poller = new CoinsetPoller(rpc, sink.handlers, { backfillBlocks: 3 });
  await poller.tick();

  // replace blocks 1-2 with a competing chain and extend it
  rpc.blocks.set(1, {
    height: 1,
    headerHash: "h1b",
    prevHash: "h0",
    timestamp: BigInt(1_700_000_101),
  });
  rpc.blocks.set(2, {
    height: 2,
    headerHash: "h2b",
    prevHash: "h1b",
    timestamp: BigInt(1_700_000_102),
  });
  rpc.chain([{ h: 3, hash: "h3b" }]);
  await poller.tick();

  expect(sink.reorgs).toEqual([0]);
  expect(sink.blocks.map((b) => b.headerHash)).toEqual(["h0", "h1", "h2", "h1b", "h2b", "h3b"]);
});

test("reorg deeper than hash memory resets and re-backfills", async () => {
  const rpc = new FakeRpc();
  rpc.chain(Array.from({ length: 10 }, (_, i) => ({ h: i, hash: `h${i}` })));
  const sink = collect();
  const poller = new CoinsetPoller(rpc, sink.handlers, { backfillBlocks: 3 });
  await poller.tick(); // emits 7,8,9
  // replace the ENTIRE remembered window with a competing chain
  for (let h = 6; h <= 9; h++) {
    rpc.blocks.set(h, {
      height: h,
      headerHash: `h${h}b`,
      prevHash: h === 6 ? "h5" : `h${h - 1}b`,
      timestamp: BigInt(1_700_000_200 + h),
    });
  }
  rpc.chain([{ h: 10, hash: "h10b" }]);
  await poller.tick(); // detects reorg, resets
  await poller.tick(); // re-backfills from new peak
  expect(sink.reorgs).toEqual([-1]);
  const tail = sink.blocks.slice(3).map((b) => b.headerHash);
  expect(tail).toEqual(["h8b", "h9b", "h10b"]);
});

test("backs off exponentially on failure and recovers", async () => {
  vi.useFakeTimers();
  const rpc = new FakeRpc();
  rpc.chain([{ h: 0, hash: "h0" }]);
  const sink = collect();
  const poller = new CoinsetPoller(rpc, sink.handlers, {
    pollIntervalMs: 1000,
    backfillBlocks: 1,
    maxBackoffMs: 8000,
  });

  rpc.failState = true;
  poller.start();
  await vi.advanceTimersByTimeAsync(0);
  expect(poller.delayMs).toBe(2000);
  await vi.advanceTimersByTimeAsync(2000);
  expect(poller.delayMs).toBe(4000);
  await vi.advanceTimersByTimeAsync(4000);
  await vi.advanceTimersByTimeAsync(8000);
  expect(poller.delayMs).toBe(8000); // capped

  rpc.failState = false;
  await vi.advanceTimersByTimeAsync(8000);
  expect(poller.delayMs).toBe(1000); // reset on success
  expect(sink.blocks.map((b) => b.height)).toEqual([0]);
  poller.stop();
  vi.useRealTimers();
});

test("awaits an async onBlock so blocks are processed in order", async () => {
  const rpc = new FakeRpc();
  rpc.chain([
    { h: 0, hash: "h0" },
    { h: 1, hash: "h1" },
    { h: 2, hash: "h2" },
  ]);
  const order: number[] = [];
  const handlers = {
    // block 0 resolves slowest; without awaiting, its push would land last
    onBlock: async (b: BlockData) => {
      await new Promise((r) => setTimeout(r, b.height === 0 ? 20 : 1));
      order.push(b.height);
    },
    onAmbient: () => {},
    onReorg: () => {},
  };
  const poller = new CoinsetPoller(rpc, handlers, { backfillBlocks: 3 });
  await poller.tick();
  expect(order).toEqual([0, 1, 2]);
});
