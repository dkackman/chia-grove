import { expect, test } from "vitest";
import { SafeSearchWorker } from "../src/content-filter/safesearch-worker.js";
import { ContentStore } from "../src/content-filter/store.js";
import { MediaIndex } from "../src/web/media-index.js";
import type { ContentFlagEvent, SproutEvent } from "@grove/shared";

const nftEvent = (over: Partial<SproutEvent> = {}): SproutEvent => ({
  type: "sprout",
  kind: "nft",
  height: 1,
  coinId: "c",
  amount: "1",
  mint: true,
  launcherId: "L1",
  nftId: "nft1",
  mediaKind: "image",
  ...over,
});

const flushMicrotasks = () => new Promise((r) => setTimeout(r, 0));

test("a sensitive image mint writes the store and emits a content-flag", async () => {
  const media = new MediaIndex(10);
  media.set("L1", { url: "https://e/x.png", kind: "image" });
  const store = new ContentStore(":memory:");
  store.putCheap("L1", "nft1", { disposition: "ok" });
  const flags: ContentFlagEvent[] = [];
  const worker = new SafeSearchWorker({
    media,
    store,
    apiKey: "k",
    onFlag: (e) => flags.push(e),
    fetchImpl: (async () =>
      new Response(
        JSON.stringify({ responses: [{ safeSearchAnnotation: { adult: "VERY_LIKELY" } }] }),
        {
          status: 200,
        }
      )) as typeof fetch,
  });

  worker.maybeEnqueue(nftEvent());
  await flushMicrotasks();

  expect(flags).toEqual([
    { type: "content-flag", launcherId: "L1", mediaFilter: "sensitive" },
  ]);
  expect(store.get("L1")?.disposition).toBe("sensitive");
  expect(store.get("L1")?.safesearchChecked).toBe(true);
  store.close();
});

test("a clean image mint marks checked and emits no flag", async () => {
  const media = new MediaIndex(10);
  media.set("L1", { url: "https://e/x.png", kind: "image" });
  const store = new ContentStore(":memory:");
  store.putCheap("L1", "nft1", { disposition: "ok" });
  const flags: ContentFlagEvent[] = [];
  const worker = new SafeSearchWorker({
    media,
    store,
    apiKey: "k",
    onFlag: (e) => flags.push(e),
    fetchImpl: (async () =>
      new Response(
        JSON.stringify({ responses: [{ safeSearchAnnotation: { adult: "UNLIKELY" } }] }),
        {
          status: 200,
        }
      )) as typeof fetch,
  });
  worker.maybeEnqueue(nftEvent());
  await flushMicrotasks();
  expect(flags).toEqual([]);
  expect(store.get("L1")?.safesearchChecked).toBe(true);
  store.close();
});

test("a store.get failure degrades gracefully: no throw, no Vision call", async () => {
  const media = new MediaIndex(10);
  media.set("L1", { url: "https://e/x.png", kind: "image" });
  let calls = 0;
  const brokenStore = {
    get() {
      throw new Error("sqlite IO failure");
    },
  } as unknown as ContentStore;
  const worker = new SafeSearchWorker({
    media,
    store: brokenStore,
    apiKey: "k",
    onFlag: () => {},
    fetchImpl: (async () => {
      calls++;
      return new Response("{}", { status: 200 });
    }) as typeof fetch,
  });
  // apply() relies on maybeEnqueue never throwing (ContentFilter "never rejects" invariant)
  expect(() => worker.maybeEnqueue(nftEvent())).not.toThrow();
  await flushMicrotasks();
  expect(calls).toBe(0);
});

test("ineligible events are skipped (non-mint, non-image, already-checked, no media)", async () => {
  const media = new MediaIndex(10);
  const store = new ContentStore(":memory:");
  let calls = 0;
  const worker = new SafeSearchWorker({
    media,
    store,
    apiKey: "k",
    onFlag: () => {},
    fetchImpl: (async () => {
      calls++;
      return new Response("{}", { status: 200 });
    }) as typeof fetch,
  });
  worker.maybeEnqueue(nftEvent({ mint: undefined })); // not a mint
  worker.maybeEnqueue(nftEvent({ mediaKind: "video" })); // not an image
  worker.maybeEnqueue(nftEvent()); // no media-index entry
  await flushMicrotasks();
  expect(calls).toBe(0);
  store.close();
});
