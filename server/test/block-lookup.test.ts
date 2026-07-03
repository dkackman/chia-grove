import { expect, test, vi } from "vitest";
import fastify from "fastify";
import { Clvm, Simulator } from "chia-wallet-sdk";
import type { CoinSpend } from "chia-wallet-sdk";
import { registerBlockLookup } from "../src/web/block-lookup.js";
import type { BlockLookupDeps } from "../src/web/block-lookup.js";
import { MediaIndex } from "../src/web/media-index.js";
import { CatRegistry } from "../src/classify/cats.js";
import type { BlockInfo, RpcView } from "../src/ingest/types.js";
import type { GroveEvent } from "@grove/shared";

interface FakeBlock {
  headerHash: string;
  timestamp: bigint | null;
  spends: CoinSpend[];
}

class FakeRpc implements RpcView {
  blocks = new Map<number, FakeBlock>();

  set(height: number, opts: { headerHash?: string; timestamp: bigint | null; spends?: CoinSpend[] }) {
    this.blocks.set(height, {
      headerHash: opts.headerHash ?? `h${height}`,
      timestamp: opts.timestamp,
      spends: opts.spends ?? [],
    });
  }

  async getState(): Promise<never> {
    throw new Error("not used by this route");
  }

  async getBlockInfo(height: number): Promise<BlockInfo> {
    const b = this.blocks.get(height);
    if (!b) throw new Error(`no block at ${height}`);
    return { height, headerHash: b.headerHash, prevHash: "", timestamp: b.timestamp, fees: 25n };
  }

  async getSpends(headerHash: string): Promise<CoinSpend[]> {
    for (const b of this.blocks.values()) if (b.headerHash === headerHash) return b.spends;
    return [];
  }
}

function deps(rpc: RpcView, enrich = vi.fn(async () => {})): BlockLookupDeps {
  return { rpc, cats: new CatRegistry(), contentFilter: { enrich } };
}

test("GET /block/:height with a non-numeric height → 400", async () => {
  const app = fastify();
  registerBlockLookup(app, deps(new FakeRpc()), new MediaIndex(10));
  const res = await app.inject({ method: "GET", url: "/block/abc" });
  expect(res.statusCode).toBe(400);
  await app.close();
});

test("GET /block/:height with a negative height → 400", async () => {
  const app = fastify();
  registerBlockLookup(app, deps(new FakeRpc()), new MediaIndex(10));
  const res = await app.inject({ method: "GET", url: "/block/-5" });
  expect(res.statusCode).toBe(400);
  await app.close();
});

test("a non-transaction block (null timestamp) returns a zero-spend block event", async () => {
  const rpc = new FakeRpc();
  rpc.set(100, { timestamp: null });
  const app = fastify();
  registerBlockLookup(app, deps(rpc), new MediaIndex(10));
  const res = await app.inject({ method: "GET", url: "/block/100" });
  expect(res.statusCode).toBe(200);
  const body = res.json() as { events: GroveEvent[] };
  expect(body.events).toEqual([
    { type: "block", height: 100, headerHash: "", timestamp: 0, spendCount: 0, fees: "0" },
  ]);
  await app.close();
});

test("an RPC failure (height beyond the chain tip) returns a zero-spend block event, not an error", async () => {
  const rpc = new FakeRpc(); // nothing registered at 999
  const app = fastify();
  registerBlockLookup(app, deps(rpc), new MediaIndex(10));
  const res = await app.inject({ method: "GET", url: "/block/999" });
  expect(res.statusCode).toBe(200);
  const body = res.json() as { events: GroveEvent[] };
  expect(body.events[0]).toMatchObject({ type: "block", height: 999, spendCount: 0 });
  await app.close();
});

test("a transaction block with a real spend classifies it and calls contentFilter.enrich", async () => {
  const sim = new Simulator();
  const clvm = new Clvm();
  const alice = sim.bls(1000n);
  clvm.spendStandardCoin(
    alice.coin,
    alice.pk,
    clvm.delegatedSpend([clvm.createCoin(alice.puzzleHash, 1000n)])
  );
  const rpc = new FakeRpc();
  rpc.set(200, { timestamp: 1_700_000_000n, spends: clvm.coinSpends() });
  const enrich = vi.fn(async () => {});
  const app = fastify();
  registerBlockLookup(app, deps(rpc, enrich), new MediaIndex(10));
  const res = await app.inject({ method: "GET", url: "/block/200" });
  expect(res.statusCode).toBe(200);
  const body = res.json() as { events: GroveEvent[] };
  expect(body.events[0]).toMatchObject({ type: "block", height: 200, spendCount: 1 });
  expect(body.events[1]).toMatchObject({ type: "sprout", kind: "xch", height: 200 });
  expect(enrich).toHaveBeenCalledTimes(1);
  await app.close();
});
