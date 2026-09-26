import { expect, test } from "vitest";
import { MempoolTracker, coinsetMempoolTxIds } from "../src/ingest/mempool-tracker.js";

/** A tracker whose mempool is whatever `pool` holds at fetch time. */
function tracked(initial: string[]) {
  const state = { pool: initial, fail: false, calls: 0 };
  const tracker = new MempoolTracker({
    intervalMs: 0,
    fetchTxIds: async () => {
      state.calls++;
      if (state.fail) throw new Error("boom");
      return [...state.pool];
    },
  });
  return { tracker, state };
}

test("the first block has no baseline to compare against", async () => {
  const { tracker } = tracked(["a", "b"]);
  expect(await tracker.onBlock()).toBeNull();
});

test("a block reports the items that left the mempool and what remains", async () => {
  const { tracker, state } = tracked(["a", "b", "c"]);
  await tracker.refresh();
  state.pool = ["c", "d"]; // a, b included; d arrived
  expect(await tracker.onBlock()).toEqual({ included: 2, remaining: 2 });
});

test("inclusions seen by a refresh before the block arrives still count toward it", async () => {
  const { tracker, state } = tracked(["a", "b", "c"]);
  await tracker.refresh();
  state.pool = ["c"];
  await tracker.refresh(); // coinset already saw the block; our poller hasn't yet
  expect(await tracker.onBlock()).toEqual({ included: 2, remaining: 1 });
  expect(await tracker.onBlock()).toEqual({ included: 0, remaining: 1 }); // reset after reporting
});

test("a failed refresh reports what was already counted, else null", async () => {
  const { tracker, state } = tracked(["a", "b"]);
  await tracker.refresh();
  state.pool = ["b"];
  await tracker.refresh();
  state.fail = true;
  expect(await tracker.onBlock()).toEqual({ included: 1, remaining: 1 });
  expect(await tracker.onBlock()).toBeNull();
});

test("overlapping refreshes share one request", async () => {
  const { tracker, state } = tracked(["a"]);
  await Promise.all([tracker.refresh(), tracker.refresh()]);
  expect(state.calls).toBe(1);
});

test("coinsetMempoolTxIds posts to coinset and returns the ids", async () => {
  let seen = "";
  const fetchImpl = (async (url: URL | RequestInfo) => {
    seen = String(url);
    return new Response(JSON.stringify({ success: true, tx_ids: ["0x01", "0x02"] }));
  }) as typeof fetch;
  expect(await coinsetMempoolTxIds("https://example.test", fetchImpl)()).toEqual(["0x01", "0x02"]);
  expect(seen).toBe("https://example.test/get_all_mempool_tx_ids");
});

test("coinsetMempoolTxIds rejects an unsuccessful response", async () => {
  const fetchImpl = (async () =>
    new Response(JSON.stringify({ success: false, error: "nope" }))) as typeof fetch;
  await expect(coinsetMempoolTxIds("https://example.test", fetchImpl)()).rejects.toThrow("nope");
});
