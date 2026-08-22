import { expect, test, vi } from "vitest";
import { WhitelistRegistry } from "../src/content-filter/signals/whitelist-registry.js";
import { WHITELIST_SET } from "../src/content-filter/signals/whitelist.js";
import { log } from "../src/logger.js";

function jsonFetch(status: number, body: unknown) {
  return (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
}

test("with no gistUrl configured, uses the bundled default and does not fetch", async () => {
  const fetchImpl = vi.fn();
  const registry = new WhitelistRegistry({ fetchImpl: fetchImpl as unknown as typeof fetch });
  await registry.start();
  expect(fetchImpl).not.toHaveBeenCalled();
  expect(registry.get()).toEqual(WHITELIST_SET);
});

test("loads entries from the gist on success", async () => {
  const fetchImpl = jsonFetch(200, [
    { collectionId: "col1fromgist" },
    { creatorDid: "did:chia:fromgist" },
  ]);
  const registry = new WhitelistRegistry({
    gistUrl: "https://gist.example/whitelist.json",
    fetchImpl,
  });
  await registry.start();
  const set = registry.get();
  expect(set.has("col1fromgist")).toBe(true);
  expect(set.has("did:chia:fromgist")).toBe(true);
});

test("falls back to the bundled default and logs a distinct error on HTTP failure", async () => {
  const errSpy = vi.spyOn(log, "error").mockImplementation(() => undefined as never);
  const fetchImpl = jsonFetch(404, {});
  const registry = new WhitelistRegistry({
    gistUrl: "https://gist.example/missing.json",
    fetchImpl,
  });
  await registry.start();
  expect(registry.get()).toEqual(WHITELIST_SET);
  expect(errSpy).toHaveBeenCalledWith(
    expect.objectContaining({ event: "whitelist_gist_load_failed" }),
    expect.any(String)
  );
  errSpy.mockRestore();
});

test("falls back to the bundled default and logs a distinct error on malformed payload", async () => {
  const errSpy = vi.spyOn(log, "error").mockImplementation(() => undefined as never);
  const fetchImpl = jsonFetch(200, [{ note: "no identifiers" }]);
  const registry = new WhitelistRegistry({ gistUrl: "https://gist.example/bad.json", fetchImpl });
  await registry.start();
  expect(registry.get()).toEqual(WHITELIST_SET);
  expect(errSpy).toHaveBeenCalledWith(
    expect.objectContaining({ event: "whitelist_gist_load_failed" }),
    expect.any(String)
  );
  errSpy.mockRestore();
});

test("falls back to the bundled default on timeout", async () => {
  const errSpy = vi.spyOn(log, "error").mockImplementation(() => undefined as never);
  const fetchImpl = ((_url: URL | RequestInfo, init?: RequestInit) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    })) as typeof fetch;
  const registry = new WhitelistRegistry({
    gistUrl: "https://gist.example/hung.json",
    fetchImpl,
    timeoutMs: 10,
  });
  await registry.start();
  expect(registry.get()).toEqual(WHITELIST_SET);
  expect(errSpy).toHaveBeenCalledWith(
    expect.objectContaining({ event: "whitelist_gist_load_failed" }),
    expect.any(String)
  );
  errSpy.mockRestore();
});
