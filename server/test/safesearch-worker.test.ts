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
const headOk = (): Response => new Response(null, { status: 200 });

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
    fetchImpl: (async (url: string, init?: RequestInit) => {
      if (init?.method === "HEAD") {
        archiveActive++;
        archivePeak = Math.max(archivePeak, archiveActive);
        await held;
        archiveActive--;
        return headOk();
      }
      if (String(url).includes("images:annotate")) return visionOk();
      return new Response("{}", { status: 404 });
    }) as typeof fetch,
  });

  for (let i = 0; i < N; i++)
    worker.maybeEnqueue(nftEvent({ launcherId: `L${i}`, nftId: `nft${i}` }));
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
  for (let i = 0; i < N; i++)
    worker.maybeEnqueue(nftEvent({ launcherId: `L${i}`, nftId: `nft${i}` }));
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
    fetchImpl: (async (url: string, init?: RequestInit) => {
      const s = String(url);
      if (init?.method === "HEAD") {
        polled.add(s);
        await held;
        return headOk();
      }
      if (s.includes("images:annotate")) return visionOk();
      return new Response("{}", { status: 404 });
    }) as typeof fetch,
  });
  for (let i = 0; i < 3; i++)
    worker.maybeEnqueue(nftEvent({ launcherId: `L${i}`, nftId: `nft${i}` }));
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
      if (init?.method === "HEAD") return headOk();
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

// Two never-checked NFTs sharing a content hash, enqueued in the same tick (e.g.
// an edition mint drop landing in one block), have no persisted verdict for
// either yet — the DB-based reuse check above can't help. Without in-flight
// coalescing both independently proceed to Vision, burning N paid calls for
// what should be one.
test("two never-checked NFTs sharing a content hash in the same batch coalesce onto one Vision call", async () => {
  const SHARED_HASH = "cd".repeat(32);
  const media = new MediaIndex(10);
  media.set("La", { url: "https://e/a.png", kind: "image" });
  media.set("Lb", { url: "https://e/b.png", kind: "image" });
  const store = new ContentStore(":memory:");
  store.putCheap("La", "nfta", { disposition: "ok" }, SHARED_HASH);
  store.putCheap("Lb", "nftb", { disposition: "ok" }, SHARED_HASH);
  const flags: ContentFlagEvent[] = [];
  let visionCalls = 0;
  const worker = new SafeSearchWorker({
    media,
    store,
    apiKey: "k",
    onFlag: (e) => flags.push(e),
    fetchImpl: (async () => {
      visionCalls++;
      return new Response(
        JSON.stringify({ responses: [{ safeSearchAnnotation: { adult: "VERY_LIKELY" } }] }),
        { status: 200 }
      );
    }) as typeof fetch,
  });

  // Both enqueued back-to-back with no await between them, simulating a batch.
  worker.maybeEnqueue(nftEvent({ launcherId: "La", nftId: "nfta" }));
  worker.maybeEnqueue(nftEvent({ launcherId: "Lb", nftId: "nftb" }));
  await flushMicrotasks();

  expect(visionCalls).toBe(1);
  expect(store.get("La")?.disposition).toBe("sensitive");
  expect(store.get("Lb")?.disposition).toBe("sensitive");
  expect(store.get("La")?.safesearchChecked).toBe(true);
  expect(store.get("Lb")?.safesearchChecked).toBe(true);
  expect(flags.length).toBe(2);
  store.close();
});

// ── image-URI fallback dedup: when MintGarden never resolves a content hash ──
// Seen in production: an edition drop where MintGarden's indexer hadn't hashed
// the asset for 6 of 7 launcherIds sharing one IPFS URI — content_hash stayed
// NULL for those rows, so the content-hash dedup above never engaged at all
// (not just raced) and each burned its own paid Vision call.

test("reuses a prior verdict by image URI when no content hash is available (sequential)", async () => {
  const SHARED_URI = "https://gw.example/ipfs/bafybeigshared";
  const media = new MediaIndex(10);
  media.set("Lsrc2", { url: SHARED_URI, kind: "image" });
  media.set("Ldup2", { url: SHARED_URI, kind: "image" });
  const store = new ContentStore(":memory:");
  store.putCheap("Lsrc2", "nftsrc2", { disposition: "ok" }); // no contentHash
  store.putCheap("Ldup2", "nftdup2", { disposition: "ok" }); // no contentHash, same URI
  const flags: ContentFlagEvent[] = [];
  let visionCalls = 0;
  const worker = new SafeSearchWorker({
    media,
    store,
    apiKey: "k",
    onFlag: (e) => flags.push(e),
    fetchImpl: (async () => {
      visionCalls++;
      return new Response(
        JSON.stringify({ responses: [{ safeSearchAnnotation: { adult: "VERY_LIKELY" } }] }),
        { status: 200 }
      );
    }) as typeof fetch,
  });

  worker.maybeEnqueue(nftEvent({ launcherId: "Lsrc2", nftId: "nftsrc2" }));
  await flushMicrotasks(); // let the first check fully persist before the second starts
  worker.maybeEnqueue(nftEvent({ launcherId: "Ldup2", nftId: "nftdup2" }));
  await flushMicrotasks();

  expect(visionCalls).toBe(1);
  expect(store.get("Ldup2")?.disposition).toBe("sensitive");
  expect(store.get("Ldup2")?.safesearchChecked).toBe(true);
  expect(flags.length).toBe(2);
  store.close();
});

test("two never-checked NFTs sharing an image URI (no content hash) in the same batch coalesce onto one Vision call", async () => {
  const SHARED_URI = "https://gw.example/ipfs/bafybeigbatch";
  const media = new MediaIndex(10);
  media.set("Lc", { url: SHARED_URI, kind: "image" });
  media.set("Ld", { url: SHARED_URI, kind: "image" });
  const store = new ContentStore(":memory:");
  store.putCheap("Lc", "nftc", { disposition: "ok" });
  store.putCheap("Ld", "nftd", { disposition: "ok" });
  let visionCalls = 0;
  const worker = new SafeSearchWorker({
    media,
    store,
    apiKey: "k",
    onFlag: () => {},
    fetchImpl: (async () => {
      visionCalls++;
      return new Response(
        JSON.stringify({ responses: [{ safeSearchAnnotation: { adult: "UNLIKELY" } }] }),
        { status: 200 }
      );
    }) as typeof fetch,
  });

  worker.maybeEnqueue(nftEvent({ launcherId: "Lc", nftId: "nftc" }));
  worker.maybeEnqueue(nftEvent({ launcherId: "Ld", nftId: "nftd" }));
  await flushMicrotasks();

  expect(visionCalls).toBe(1);
  expect(store.get("Lc")?.safesearchChecked).toBe(true);
  expect(store.get("Ld")?.safesearchChecked).toBe(true);
  store.close();
});

// ── shared failure backoff: don't re-poll Archive per launcher for the same
// content ────────────────────────────────────────────────────────────────────
// Seen in production: 11 launcherIds sharing one content hash, each running
// its own archiveCheckAttempts loop against an asset Archive hadn't ingested
// yet — N times the network calls (and N cold failures) for what Archive
// answers identically for all of them. In-flight coalescing alone doesn't
// cover this: by the time a later launcher arrives, the leader may have
// already failed and been removed from the in-flight map.

test("a content hash's archive failure suppresses later launchers instead of each re-polling", async () => {
  const SHARED_HASH = "ef".repeat(32);
  const ARCHIVE_URL = `${ARCHIVE}/content/${SHARED_HASH}`;
  const media = new MediaIndex(20);
  for (const id of ["Lp", "Lq", "Lr"]) media.set(id, { url: ARCHIVE_URL, kind: "image" });
  const store = new ContentStore(":memory:");
  store.putCheap("Lp", "nftp", { disposition: "ok" }, SHARED_HASH);
  store.putCheap("Lq", "nftq", { disposition: "ok" }, SHARED_HASH);
  store.putCheap("Lr", "nftr", { disposition: "ok" }, SHARED_HASH);
  let archiveCalls = 0;
  const worker = new SafeSearchWorker({
    media,
    store,
    apiKey: "k",
    onFlag: () => {},
    archiveBaseUrl: ARCHIVE,
    archiveCheckAttempts: 2,
    archiveCheckDelayMs: 0,
    fetchImpl: (async (_url: string, init?: RequestInit) => {
      if (init?.method === "HEAD") {
        archiveCalls++;
        return new Response(null, { status: 404 }); // never ready
      }
      return new Response("{}", { status: 404 });
    }) as typeof fetch,
  });

  // Lp runs to completion (fails) before Lq/Lr arrive — the in-flight leader
  // entry is long gone by the time they show up, unlike the same-batch case.
  worker.maybeEnqueue(nftEvent({ launcherId: "Lp", nftId: "nftp" }));
  await flushMicrotasks();
  await flushMicrotasks();

  worker.maybeEnqueue(nftEvent({ launcherId: "Lq", nftId: "nftq" }));
  worker.maybeEnqueue(nftEvent({ launcherId: "Lr", nftId: "nftr" }));
  await flushMicrotasks();

  expect(archiveCalls).toBe(2); // only Lp's own archiveCheckAttempts ran
  store.close();
});

// ── content-readiness probe: HEAD of the URL Vision will fetch ───────────────
// The archive answers an immutable 301 (to files.mintgarden.io) for ingested
// content and 404 otherwise, so a redirect counts as ready. Probing the content
// URL itself (not /nfts/{launcherId}) means readiness is content-keyed.

test("the readiness probe is a HEAD of the content URL and a redirect counts as ready", async () => {
  const HASH = "1a".repeat(32);
  const CONTENT_URL = `${ARCHIVE}/content/${HASH}`;
  const media = new MediaIndex(10);
  media.set("L1", { url: CONTENT_URL, kind: "image" });
  const store = new ContentStore(":memory:");
  store.putCheap("L1", "nft1", { disposition: "ok" }, HASH);
  const headUrls: string[] = [];
  let visionUri: string | undefined;
  const worker = new SafeSearchWorker({
    media,
    store,
    apiKey: "k",
    onFlag: () => {},
    archiveBaseUrl: ARCHIVE,
    archiveCheckAttempts: 3,
    archiveCheckDelayMs: 0,
    fetchImpl: (async (url: string, init?: RequestInit) => {
      if (init?.method === "HEAD") {
        headUrls.push(String(url));
        return new Response(null, { status: 301 });
      }
      visionUri = JSON.parse((init?.body as string) ?? "{}").requests?.[0]?.image?.source?.imageUri;
      return visionOk();
    }) as typeof fetch,
  });
  worker.maybeEnqueue(nftEvent());
  await flushMicrotasks();
  expect(headUrls).toEqual([CONTENT_URL]); // one probe, of the content URL itself
  expect(visionUri).toBe(CONTENT_URL);
  expect(store.get("L1")?.safesearchChecked).toBe(true);
  store.close();
});

test("a video poster on the assets CDN is probed for readiness before Vision", async () => {
  const POSTER = "https://assets.mainnet.mintgarden.io/thumbnails/9f_512.webp";
  const media = new MediaIndex(10);
  media.set("V9", { url: "https://ipfs/clip.mp4", kind: "video", thumbnailUrl: POSTER });
  const store = new ContentStore(":memory:");
  store.putCheap("V9", "nftv9", { disposition: "ok" });
  let headCalls = 0;
  let visionCalls = 0;
  const worker = new SafeSearchWorker({
    media,
    store,
    apiKey: "k",
    onFlag: () => {},
    archiveCheckAttempts: 2,
    archiveCheckDelayMs: 0,
    fetchImpl: (async (url: string, init?: RequestInit) => {
      if (init?.method === "HEAD") {
        headCalls++;
        return new Response(null, { status: 404 }); // thumbnail not generated yet
      }
      if (String(url).includes("images:annotate")) visionCalls++;
      return new Response("{}", { status: 404 });
    }) as typeof fetch,
  });
  worker.maybeEnqueue(nftEvent({ launcherId: "V9", nftId: "nftv9", mediaKind: "video" }));
  await flushMicrotasks();
  expect(headCalls).toBe(2); // probed with retries, like archive URLs
  expect(visionCalls).toBe(0); // no Vision attempt burned on a missing poster
  expect(store.get("V9")?.safesearchChecked).toBe(false);
  store.close();
});

// ── original-URL fallback when the Archive never ingests the content ─────────
// The archive URL upgrade exists because ipfs.mintgarden.io blocks Google's IP
// ranges — so the fallback skips that host, but plain HTTPS art (nftstorage
// gateways etc.) is worth one Vision attempt instead of giving up entirely.

test("archive never ready + reachable original URL → Vision checks the fallback", async () => {
  const HASH = "2b".repeat(32);
  const ORIGINAL = "https://bafy.nftstorage.link/1.png";
  const media = new MediaIndex(10);
  media.set("L1", { url: `${ARCHIVE}/content/${HASH}`, kind: "image", fallbackUrl: ORIGINAL });
  const store = new ContentStore(":memory:");
  store.putCheap("L1", "nft1", { disposition: "ok" }, HASH);
  let visionUri: string | undefined;
  const worker = new SafeSearchWorker({
    media,
    store,
    apiKey: "k",
    onFlag: () => {},
    archiveBaseUrl: ARCHIVE,
    archiveCheckAttempts: 2,
    archiveCheckDelayMs: 0,
    fetchImpl: (async (url: string, init?: RequestInit) => {
      if (init?.method === "HEAD") return new Response(null, { status: 404 });
      visionUri = JSON.parse((init?.body as string) ?? "{}").requests?.[0]?.image?.source?.imageUri;
      return visionOk();
    }) as typeof fetch,
  });
  worker.maybeEnqueue(nftEvent());
  await flushMicrotasks();
  expect(visionUri).toBe(ORIGINAL);
  expect(store.get("L1")?.safesearchChecked).toBe(true);
  // checked_uri records the URL actually classified, so URI dedup finds it
  expect(store.getSafeSearchByUri(ORIGINAL)?.adult).toBe("UNLIKELY");
  store.close();
});

test("a fallback on a Google-unreachable gateway is not attempted", async () => {
  const HASH = "3c".repeat(32);
  const media = new MediaIndex(10);
  media.set("L1", {
    url: `${ARCHIVE}/content/${HASH}`,
    kind: "image",
    fallbackUrl: "https://ipfs.mintgarden.io/ipfs/abc",
  });
  const store = new ContentStore(":memory:");
  store.putCheap("L1", "nft1", { disposition: "ok" }, HASH);
  let visionCalls = 0;
  const worker = new SafeSearchWorker({
    media,
    store,
    apiKey: "k",
    onFlag: () => {},
    archiveBaseUrl: ARCHIVE,
    archiveCheckAttempts: 1,
    archiveCheckDelayMs: 0,
    fetchImpl: (async (url: string, init?: RequestInit) => {
      if (init?.method === "HEAD") return new Response(null, { status: 404 });
      if (String(url).includes("images:annotate")) visionCalls++;
      return new Response("{}", { status: 404 });
    }) as typeof fetch,
  });
  worker.maybeEnqueue(nftEvent());
  await flushMicrotasks();
  expect(visionCalls).toBe(0); // guaranteed-failure host: fail and back off instead
  expect(store.get("L1")?.safesearchChecked).toBe(false);
  store.close();
});

test("a video NFT never falls back to the raw clip when its poster is not ready", async () => {
  const POSTER = "https://assets.mainnet.mintgarden.io/thumbnails/4d_512.webp";
  const media = new MediaIndex(10);
  media.set("V1", {
    url: "https://gw.example/clip.mp4",
    kind: "video",
    thumbnailUrl: POSTER,
    fallbackUrl: "https://gw.example/clip.mp4",
  });
  const store = new ContentStore(":memory:");
  store.putCheap("V1", "nftv", { disposition: "ok" });
  let visionCalls = 0;
  const worker = new SafeSearchWorker({
    media,
    store,
    apiKey: "k",
    onFlag: () => {},
    archiveCheckAttempts: 1,
    archiveCheckDelayMs: 0,
    fetchImpl: (async (url: string, init?: RequestInit) => {
      if (init?.method === "HEAD") return new Response(null, { status: 404 });
      if (String(url).includes("images:annotate")) visionCalls++;
      return new Response("{}", { status: 404 });
    }) as typeof fetch,
  });
  worker.maybeEnqueue(nftEvent({ launcherId: "V1", nftId: "nftv", mediaKind: "video" }));
  await flushMicrotasks();
  expect(visionCalls).toBe(0); // Vision can't decode video frames
  store.close();
});

test("coalesced followers of a fallback-checked leader record their own imageUri, not the leader's fallback", async () => {
  const HASH = "6f".repeat(32);
  const ARCHIVE_URL = `${ARCHIVE}/content/${HASH}`;
  const media = new MediaIndex(10);
  // Same bytes (one content hash, one archive URL), but each launcher preserved
  // a different on-chain original — only the leader's fallback gets classified.
  media.set("L1", {
    url: ARCHIVE_URL,
    kind: "image",
    fallbackUrl: "https://original1.example/a.png",
  });
  media.set("L2", {
    url: ARCHIVE_URL,
    kind: "image",
    fallbackUrl: "https://original2.example/b.png",
  });
  const store = new ContentStore(":memory:");
  store.putCheap("L1", "nft1", { disposition: "ok" }, HASH);
  store.putCheap("L2", "nft2", { disposition: "ok" }, HASH);
  let visionCalls = 0;
  const worker = new SafeSearchWorker({
    media,
    store,
    apiKey: "k",
    onFlag: () => {},
    archiveBaseUrl: ARCHIVE,
    archiveCheckAttempts: 1,
    archiveCheckDelayMs: 0,
    fetchImpl: (async (url: string, init?: RequestInit) => {
      if (init?.method === "HEAD") return new Response(null, { status: 404 }); // never ready
      if (String(url).includes("images:annotate")) visionCalls++;
      return visionOk();
    }) as typeof fetch,
  });
  // Same batch, no await between them — L2 joins L1's in-flight check.
  worker.maybeEnqueue(nftEvent());
  worker.maybeEnqueue(nftEvent({ launcherId: "L2", nftId: "nft2" }));
  await flushMicrotasks();
  expect(visionCalls).toBe(1); // coalesced onto the leader's fallback check
  expect(store.get("L1")?.safesearchChecked).toBe(true);
  expect(store.get("L2")?.safesearchChecked).toBe(true);
  // Leader's checked_uri is the fallback it actually classified; the follower
  // records its own imageUri (the archive URL), not the leader's fallback.
  expect(store.getSafeSearchByUri("https://original1.example/a.png")?.adult).toBe("UNLIKELY");
  expect(store.getSafeSearchByUri(ARCHIVE_URL)?.adult).toBe("UNLIKELY");
  store.close();
});

test("a sensitive verdict reached via the fallback URL still emits a content-flag", async () => {
  const HASH = "5e".repeat(32);
  const ORIGINAL = "https://bafy.nftstorage.link/2.png";
  const media = new MediaIndex(10);
  media.set("L1", { url: `${ARCHIVE}/content/${HASH}`, kind: "image", fallbackUrl: ORIGINAL });
  const store = new ContentStore(":memory:");
  store.putCheap("L1", "nft1", { disposition: "ok" }, HASH);
  const flags: ContentFlagEvent[] = [];
  const worker = new SafeSearchWorker({
    media,
    store,
    apiKey: "k",
    onFlag: (e) => flags.push(e),
    archiveBaseUrl: ARCHIVE,
    archiveCheckAttempts: 1,
    archiveCheckDelayMs: 0,
    fetchImpl: (async (_url: string, init?: RequestInit) => {
      if (init?.method === "HEAD") return new Response(null, { status: 404 });
      return new Response(
        JSON.stringify({ responses: [{ safeSearchAnnotation: { adult: "VERY_LIKELY" } }] }),
        { status: 200 }
      );
    }) as typeof fetch,
  });
  worker.maybeEnqueue(nftEvent());
  await flushMicrotasks();
  expect(flags).toEqual([{ type: "content-flag", launcherId: "L1", mediaFilter: "sensitive" }]);
  expect(store.get("L1")?.disposition).toBe("sensitive");
  store.close();
});
