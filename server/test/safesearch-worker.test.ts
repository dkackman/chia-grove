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

  expect(flags).toEqual([{ type: "content-flag", launcherId: "L1", mediaFilter: "sensitive" }]);
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

test("ineligible events are skipped (audio NFT, no media entry)", async () => {
  const media = new MediaIndex(10);
  media.set("AUD", { url: "https://e/a.mp3", kind: "audio" });
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
  worker.maybeEnqueue(nftEvent({ launcherId: "AUD", nftId: "nfta", mediaKind: "audio" })); // nothing to classify
  worker.maybeEnqueue(nftEvent({ launcherId: "MISSING", nftId: "nftm" })); // no media-index entry
  await flushMicrotasks();
  expect(calls).toBe(0);
  store.close();
});

// ── concurrency decoupling ───────────────────────────────────────────────────
// The Vision call is paid + rate-limited and must stay behind the gate; the
// Archive readiness wait is cheap polling and must NOT occupy a Vision slot,
// otherwise throughput collapses to concurrency / archiveWait.

const ARCHIVE = "https://archive.mintgarden.io";
const visionOk = (): Response =>
  new Response(JSON.stringify({ responses: [{ safeSearchAnnotation: { adult: "UNLIKELY" } }] }), {
    status: 200,
  });
const archiveReady = (): Response =>
  new Response(JSON.stringify({ assets: [{ role: "data", fetch_succeeded: true }] }), {
    status: 200,
  });

test("archive readiness waits run concurrently instead of serialized by the Vision gate", async () => {
  const N = 5;
  const media = new MediaIndex(20);
  const store = new ContentStore(":memory:");
  for (let i = 0; i < N; i++) media.set(`L${i}`, { url: `${ARCHIVE}/content/${i}`, kind: "image" });
  let archiveActive = 0;
  let archivePeak = 0;
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  const worker = new SafeSearchWorker({
    media,
    store,
    apiKey: "k",
    onFlag: () => {},
    archiveBaseUrl: ARCHIVE,
    archiveCheckAttempts: 1,
    archiveCheckDelayMs: 0,
    concurrency: 2,
    fetchImpl: (async (url: string) => {
      const s = String(url);
      if (s.includes("images:annotate")) return visionOk();
      if (s.includes(`${ARCHIVE}/nfts/`)) {
        archiveActive++;
        archivePeak = Math.max(archivePeak, archiveActive);
        await held;
        archiveActive--;
        return archiveReady();
      }
      return new Response("{}", { status: 404 });
    }) as typeof fetch,
  });

  for (let i = 0; i < N; i++) worker.maybeEnqueue(nftEvent({ launcherId: `L${i}`, nftId: `nft${i}` }));
  await flushMicrotasks();
  // all N poll the Archive at once — the wait is no longer capped at concurrency=2
  expect(archivePeak).toBe(N);
  release();
  await flushMicrotasks();
  store.close();
});

test("the Vision call stays bounded by concurrency even when many waits resolve at once", async () => {
  const N = 5;
  const concurrency = 2;
  const media = new MediaIndex(20);
  const store = new ContentStore(":memory:");
  for (let i = 0; i < N; i++) media.set(`L${i}`, { url: `https://e/${i}.png`, kind: "image" });
  let visionActive = 0;
  let visionPeak = 0;
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  const worker = new SafeSearchWorker({
    media,
    store,
    apiKey: "k",
    onFlag: () => {},
    concurrency,
    fetchImpl: (async (url: string) => {
      if (String(url).includes("images:annotate")) {
        visionActive++;
        visionPeak = Math.max(visionPeak, visionActive);
        await held;
        visionActive--;
        return visionOk();
      }
      return new Response("{}", { status: 404 });
    }) as typeof fetch,
  });
  for (let i = 0; i < N; i++) worker.maybeEnqueue(nftEvent({ launcherId: `L${i}`, nftId: `nft${i}` }));
  await flushMicrotasks();
  expect(visionPeak).toBe(concurrency);
  release();
  await flushMicrotasks();
  store.close();
});

test("maybeEnqueue drops work beyond maxPending so the in-flight set stays bounded", async () => {
  const media = new MediaIndex(20);
  const store = new ContentStore(":memory:");
  for (let i = 0; i < 3; i++) media.set(`L${i}`, { url: `${ARCHIVE}/content/${i}`, kind: "image" });
  const polled = new Set<string>();
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  const worker = new SafeSearchWorker({
    media,
    store,
    apiKey: "k",
    onFlag: () => {},
    archiveBaseUrl: ARCHIVE,
    archiveCheckAttempts: 1,
    archiveCheckDelayMs: 0,
    concurrency: 10, // high enough that only maxPending, not the gate, limits work
    maxPending: 2,
    fetchImpl: (async (url: string) => {
      const s = String(url);
      const m = s.match(/\/nfts\/(L\d+)/);
      if (m) {
        polled.add(m[1]);
        await held;
        return archiveReady();
      }
      if (s.includes("images:annotate")) return visionOk();
      return new Response("{}", { status: 404 });
    }) as typeof fetch,
  });
  for (let i = 0; i < 3; i++) worker.maybeEnqueue(nftEvent({ launcherId: `L${i}`, nftId: `nft${i}` }));
  await flushMicrotasks();
  expect(polled.size).toBe(2); // third enqueue dropped by the cap
  release();
  await flushMicrotasks();
  store.close();
});

// ── video NFTs: SafeSearch the poster (best-effort) ──────────────────────────
// Vision can't decode video frames, but the MintGarden poster is a still image,
// so we classify that. A video with no resolved thumbnail is skipped.

test("a video NFT is SafeSearch-checked against its thumbnail poster, not the clip", async () => {
  const media = new MediaIndex(10);
  const POSTER = "https://assets.mainnet.mintgarden.io/thumbnails/abc_512.webp";
  media.set("V1", { url: "https://ipfs/clip.mp4", kind: "video", thumbnailUrl: POSTER });
  const store = new ContentStore(":memory:");
  store.putCheap("V1", "nftv", { disposition: "ok" });
  const flags: ContentFlagEvent[] = [];
  let visionUri: string | undefined;
  const worker = new SafeSearchWorker({
    media,
    store,
    apiKey: "k",
    onFlag: (e) => flags.push(e),
    fetchImpl: (async (_url: string, init?: RequestInit) => {
      visionUri = JSON.parse((init?.body as string) ?? "{}").requests?.[0]?.image?.source?.imageUri;
      return new Response(
        JSON.stringify({ responses: [{ safeSearchAnnotation: { adult: "VERY_LIKELY" } }] }),
        { status: 200 }
      );
    }) as typeof fetch,
  });
  worker.maybeEnqueue(nftEvent({ launcherId: "V1", nftId: "nftv", mediaKind: "video" }));
  await flushMicrotasks();
  expect(visionUri).toBe(POSTER);
  expect(flags).toEqual([{ type: "content-flag", launcherId: "V1", mediaFilter: "sensitive" }]);
  expect(store.get("V1")?.safesearchChecked).toBe(true);
  store.close();
});

test("a video NFT with no thumbnail is skipped (no Vision call)", async () => {
  const media = new MediaIndex(10);
  media.set("V2", { url: "https://ipfs/clip.mp4", kind: "video" }); // no thumbnailUrl
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
  worker.maybeEnqueue(nftEvent({ launcherId: "V2", nftId: "nftv2", mediaKind: "video" }));
  await flushMicrotasks();
  expect(calls).toBe(0);
  store.close();
});

// ── content-hash dedup: reuse a prior verdict for identical bytes ─────────────
// Distinct NFTs (different launcherIds) can share the same on-chain data. Once
// one is SafeSearch-checked, others with the same content hash reuse that verdict
// instead of burning a second paid Vision call.

const HASH = "ab".repeat(32);
const seededStore = (sensitive: boolean): ContentStore => {
  const store = new ContentStore(":memory:");
  store.putCheap("Lsrc", "nftsrc", { disposition: "ok" }, HASH);
  store.putSafeSearch("Lsrc", {
    sensitive,
    adult: sensitive ? "VERY_LIKELY" : "UNLIKELY",
    raw: { adult: sensitive ? "VERY_LIKELY" : "UNLIKELY" },
  });
  store.putCheap("Ldup", "nftdup", { disposition: "ok" }, HASH); // same hash, not yet checked
  return store;
};

test("reuses a prior sensitive verdict for another NFT with the same content hash", async () => {
  const media = new MediaIndex(10);
  media.set("Ldup", { url: "https://e/y.png", kind: "image" });
  const store = seededStore(true);
  const flags: ContentFlagEvent[] = [];
  let visionCalls = 0;
  const worker = new SafeSearchWorker({
    media,
    store,
    apiKey: "k",
    onFlag: (e) => flags.push(e),
    fetchImpl: (async () => {
      visionCalls++;
      return new Response("{}", { status: 200 });
    }) as typeof fetch,
  });
  worker.maybeEnqueue(nftEvent({ launcherId: "Ldup", nftId: "nftdup" }));
  await flushMicrotasks();
  expect(visionCalls).toBe(0); // reused — no paid call
  expect(store.get("Ldup")?.disposition).toBe("sensitive");
  expect(store.get("Ldup")?.safesearchChecked).toBe(true);
  expect(flags).toEqual([{ type: "content-flag", launcherId: "Ldup", mediaFilter: "sensitive" }]);
  store.close();
});

test("reuses a prior ok verdict for the same content hash and still skips Vision", async () => {
  const media = new MediaIndex(10);
  media.set("Ldup", { url: "https://e/y.png", kind: "image" });
  const store = seededStore(false);
  const flags: ContentFlagEvent[] = [];
  let visionCalls = 0;
  const worker = new SafeSearchWorker({
    media,
    store,
    apiKey: "k",
    onFlag: (e) => flags.push(e),
    fetchImpl: (async () => {
      visionCalls++;
      return new Response("{}", { status: 200 });
    }) as typeof fetch,
  });
  worker.maybeEnqueue(nftEvent({ launcherId: "Ldup", nftId: "nftdup" }));
  await flushMicrotasks();
  expect(visionCalls).toBe(0);
  expect(store.get("Ldup")?.safesearchChecked).toBe(true);
  expect(flags).toEqual([]);
  store.close();
});
