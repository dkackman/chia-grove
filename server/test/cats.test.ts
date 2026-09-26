import { expect, test, vi } from "vitest";
import type { GroveEvent } from "@grove/shared";
import { CatRegistry } from "../src/classify/cats.js";

interface FakeAsset {
  id: string;
  name: string | null;
  code: string | null;
}

const asset = (n: number): FakeAsset => ({
  id: `a${n}`.padEnd(64, "0"),
  name: `Asset ${n}`,
  code: `A${n}`,
});

/** fetchImpl serving fixed pages; records how many requests were made. */
function pagedFetch(pages: FakeAsset[][]) {
  const calls: string[] = [];
  const fetchImpl = (async (url: URL | RequestInfo) => {
    calls.push(String(url));
    const page = Number(new URL(String(url)).searchParams.get("page"));
    const assets = pages[page - 1] ?? [];
    return new Response(JSON.stringify({ assets }), { status: 200 });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

test("refresh pages through assets and stops on an empty page", async () => {
  const { fetchImpl, calls } = pagedFetch([[asset(1), asset(2)], [asset(3)], []]);
  const registry = new CatRegistry({ fetchImpl });
  await registry.refresh();
  expect(calls.length).toBe(3);
  expect(registry.lookup(asset(1).id)?.ticker).toBe("A1");
  expect(registry.lookup(asset(3).id)?.name).toBe("Asset 3");
});

test("overlapping refresh calls share a single pass", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let calls = 0;
  const fetchImpl = (async () => {
    calls++;
    await gate;
    return new Response(JSON.stringify({ assets: [] }), { status: 200 });
  }) as typeof fetch;

  const registry = new CatRegistry({ fetchImpl });
  const first = registry.refresh();
  const second = registry.refresh(); // must join the in-flight pass, not start another
  release();
  await Promise.all([first, second]);
  expect(calls).toBe(1);

  // a later refresh (nothing in flight) runs again
  await registry.refresh();
  expect(calls).toBe(2);
});

test("pagination stops at the page cap even if pages never empty", async () => {
  const fullPage = Array.from({ length: 100 }, (_, i) => asset(i));
  const { fetchImpl, calls } = pagedFetch(Array.from({ length: 50 }, () => fullPage));
  const registry = new CatRegistry({ fetchImpl, maxPages: 3 });
  await registry.refresh();
  expect(calls.length).toBe(3);
});

test("a hung request is aborted by the fetch timeout", async () => {
  const fetchImpl = ((_url: URL | RequestInfo, init?: RequestInit) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    })) as typeof fetch;

  const registry = new CatRegistry({ fetchImpl, timeoutMs: 10 });
  await expect(registry.refresh()).rejects.toThrow("aborted");
});

test("a failed initial load retries on a short backoff, then settles into hourly refreshes", async () => {
  vi.useFakeTimers();
  try {
    let fail = 2;
    let calls = 0;
    const fetchImpl = (async (url: URL | RequestInfo) => {
      calls++;
      if (fail > 0) {
        fail--;
        return new Response("rate limited", { status: 429 });
      }
      const page = Number(new URL(String(url)).searchParams.get("page"));
      return new Response(JSON.stringify({ assets: page === 1 ? [asset(1)] : [] }), {
        status: 200,
      });
    }) as typeof fetch;
    const registry = new CatRegistry({
      fetchImpl,
      retryBaseMs: 1000,
      retryMaxMs: 60_000,
      refreshMs: 3_600_000,
    });
    let loads = 0;
    registry.onLoad(() => loads++);

    await registry.start(); // attempt 1 fails
    expect(registry.lookup(asset(1).id)).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1000); // retry after 1 s — fails again
    expect(loads).toBe(0);
    await vi.advanceTimersByTimeAsync(1999); // backoff doubled to 2 s: not yet
    expect(loads).toBe(0);
    await vi.advanceTimersByTimeAsync(1); // succeeds
    expect(loads).toBe(1);
    expect(registry.lookup(asset(1).id)?.ticker).toBe("A1");

    const before = calls;
    await vi.advanceTimersByTimeAsync(60_000); // healthy: no retry storm
    expect(calls).toBe(before);
    await vi.advanceTimersByTimeAsync(3_600_000); // hourly refresh
    expect(calls).toBeGreaterThan(before);
    registry.stop();
  } finally {
    vi.useRealTimers();
  }
});

test("a failed refresh keeps the previously loaded names", async () => {
  let ok = true;
  const fetchImpl = (async (url: URL | RequestInfo) => {
    if (!ok) return new Response("down", { status: 503 });
    const page = Number(new URL(String(url)).searchParams.get("page"));
    return new Response(JSON.stringify({ assets: page === 1 ? [asset(1)] : [] }), { status: 200 });
  }) as typeof fetch;
  const registry = new CatRegistry({ fetchImpl });
  await registry.refresh();
  ok = false;
  await expect(registry.refresh()).rejects.toThrow();
  expect(registry.lookup(asset(1).id)?.name).toBe("Asset 1");
});

test("fillNames patches nameless CAT spends and leaves everything else alone", async () => {
  const { fetchImpl } = pagedFetch([[asset(1)], []]);
  const registry = new CatRegistry({ fetchImpl });
  await registry.refresh();
  const cat = (assetId: string, extra = {}): GroveEvent => ({
    type: "sprout",
    kind: "cat",
    height: 1,
    coinId: "c".repeat(64),
    amount: "1000",
    assetId,
    ...extra,
  });
  const nameless = cat(asset(1).id);
  const unknown = cat(asset(9).id);
  const named = cat(asset(1).id, { catName: "Kept", catTicker: "KEEP" });
  const xch: GroveEvent = { type: "sprout", kind: "xch", height: 1, coinId: "d", amount: "1" };
  expect(registry.fillNames([nameless, unknown, named, xch])).toBe(1);
  expect(nameless).toMatchObject({ catName: "Asset 1", catTicker: "A1" });
  expect(unknown).not.toHaveProperty("catName");
  expect(named).toMatchObject({ catName: "Kept", catTicker: "KEEP" });
});
