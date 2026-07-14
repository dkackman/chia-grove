import { expect, test } from "vitest";
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
