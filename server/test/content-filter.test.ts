import { fileURLToPath } from "node:url";
import { expect, test, vi } from "vitest";
import {
  mapMintgarden,
  mapMintgardenSignals,
  extractContentHash,
} from "../src/content-filter/index.js";
import { ContentFilter } from "../src/content-filter/index.js";
import { MediaIndex } from "../src/web/media-index.js";
import { buildDenylistMap } from "../src/content-filter/signals/denylist.js";
import { buildWhitelistSet } from "../src/content-filter/signals/whitelist.js";
import { ContentStore } from "../src/content-filter/store.js";
import type { GroveEvent, SproutEvent } from "@grove/shared";

test("is_blocked true → blocked", () => {
  expect(mapMintgarden({ is_blocked: true })).toBe("blocked");
});

test("collection.blocked_content true → blocked", () => {
  expect(mapMintgarden({ collection: { blocked_content: true } })).toBe("blocked");
});

test("creator.verification_state 2 → blocked", () => {
  expect(mapMintgarden({ creator: { verification_state: 2 } })).toBe("blocked");
});

test("verification_state type fuzz: only the exact number 2 blocks", () => {
  const fuzz = ["2", 2n, true, [2], { state: 2 }, null, undefined, NaN, 1, 3, 2.5, "flagged"];
  for (const verification_state of fuzz) {
    expect(mapMintgarden({ creator: { verification_state } })).toBe("ok");
  }
});

test("collection.sensitive_content true → sensitive", () => {
  expect(mapMintgarden({ collection: { sensitive_content: true } })).toBe("sensitive");
});

test("metadata_json.sensitive_content boolean true → sensitive", () => {
  expect(mapMintgarden({ data: { metadata_json: { sensitive_content: true } } })).toBe("sensitive");
});

test('metadata_json.sensitive_content string "true" → sensitive', () => {
  expect(mapMintgarden({ data: { metadata_json: { sensitive_content: "true" } } })).toBe(
    "sensitive"
  );
});

test("metadata_json.sensitive_content non-empty array → sensitive", () => {
  expect(mapMintgarden({ data: { metadata_json: { sensitive_content: ["nudity"] } } })).toBe(
    "sensitive"
  );
});

test("sensitive_content bare descriptive string → sensitive", () => {
  expect(mapMintgarden({ collection: { sensitive_content: "nudity" } })).toBe("sensitive");
});

test('sensitive_content "false" / empty string → ok', () => {
  expect(mapMintgarden({ collection: { sensitive_content: "false" } })).toBe("ok");
  expect(mapMintgarden({ collection: { sensitive_content: "False" } })).toBe("ok");
  expect(mapMintgarden({ collection: { sensitive_content: "  " } })).toBe("ok");
});

test("blocked takes precedence over sensitive", () => {
  expect(mapMintgarden({ is_blocked: true, collection: { sensitive_content: true } })).toBe(
    "blocked"
  );
});

test("benign NFT → ok", () => {
  expect(
    mapMintgarden({
      is_blocked: false,
      collection: { blocked_content: false, sensitive_content: false },
      creator: { verification_state: 1 },
      data: { metadata_json: { sensitive_content: false } },
    })
  ).toBe("ok");
});

test("missing fields / non-object → ok", () => {
  expect(mapMintgarden({})).toBe("ok");
  expect(mapMintgarden(null)).toBe("ok");
  expect(mapMintgarden("nope")).toBe("ok");
  expect(mapMintgarden({ collection: null, data: null, creator: null })).toBe("ok");
});

test("lexicon hit in nft name → sensitive", () => {
  expect(mapMintgarden({ name: "Hardcore #1" })).toBe("sensitive");
});

test("lexicon hit in collection name → sensitive", () => {
  expect(mapMintgarden({ collection: { name: "XXX Club" } })).toBe("sensitive");
});

test("lexicon hit in metadata description → sensitive", () => {
  expect(mapMintgarden({ data: { metadata_json: { description: "explicit content" } } })).toBe(
    "sensitive"
  );
});

test("lexicon hit in metadata name → sensitive", () => {
  expect(mapMintgarden({ data: { metadata_json: { name: "XXX Drop" } } })).toBe("sensitive");
});

test("benign name with embedded substring does not match (word boundary)", () => {
  expect(mapMintgarden({ name: "Sussex Coastline", collection: { name: "Analysis" } })).toBe("ok");
});

test("denylisted collection returns its declared disposition", () => {
  const denylist = buildDenylistMap([{ collectionId: "col_bad", disposition: "blocked" }]);
  expect(mapMintgarden({ collection: { id: "col_bad" } }, { denylist })).toBe("blocked");
});

test("denylist sensitive entry → sensitive", () => {
  const denylist = buildDenylistMap([{ collectionId: "col_nsfw", disposition: "sensitive" }]);
  expect(mapMintgarden({ collection: { id: "col_nsfw" } }, { denylist })).toBe("sensitive");
});

test("denylist blocked overrides a co-occurring text sensitive hit", () => {
  const denylist = buildDenylistMap([{ collectionId: "col_bad", disposition: "blocked" }]);
  expect(mapMintgarden({ name: "nude study", collection: { id: "col_bad" } }, { denylist })).toBe(
    "blocked"
  );
});

test("MintGarden blocked flag still wins over a text sensitive hit", () => {
  expect(mapMintgarden({ is_blocked: true, name: "nude study" })).toBe("blocked");
});

test("custom lexicon via opts is honored", () => {
  expect(mapMintgarden({ name: "contains widget" }, { lexicon: ["widget"] })).toBe("sensitive");
});

test("non-denylisted collection with default (empty) denylist → ok", () => {
  expect(mapMintgarden({ collection: { id: "col_unknown" } })).toBe("ok");
});

const nftEvent = (over: Partial<SproutEvent> = {}): SproutEvent => ({
  type: "sprout",
  kind: "nft",
  height: 1,
  coinId: "ab".repeat(32),
  amount: "1",
  launcherId: "cd".repeat(32),
  nftId: "nft1example",
  mediaKind: "image",
  ...over,
});

const okJson = (obj: unknown) =>
  ({ ok: true, status: 200, json: async () => obj }) as unknown as Response;
const statusResp = (status: number) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => ({}) }) as unknown as Response;
const tick = () => new Promise((r) => setTimeout(r, 20));

test("enrich marks blocked NFTs and makes their art unreachable", async () => {
  const media = new MediaIndex(10);
  media.set("cd".repeat(32), { url: "https://x/a.png", kind: "image" });
  const filter = new ContentFilter(media, {
    fetchImpl: async () => okJson({ is_blocked: true }),
  });
  const event = nftEvent();
  await filter.enrich([event]);
  expect(event.mediaFilter).toBe("blocked");
  expect(media.get("cd".repeat(32))).toBeUndefined();
});

test("enrich marks sensitive NFTs but keeps their art entry", async () => {
  const media = new MediaIndex(10);
  media.set("cd".repeat(32), { url: "https://x/a.png", kind: "image" });
  const filter = new ContentFilter(media, {
    fetchImpl: async () => okJson({ collection: { sensitive_content: true } }),
  });
  const event = nftEvent();
  await filter.enrich([event]);
  expect(event.mediaFilter).toBe("sensitive");
  expect(media.get("cd".repeat(32))).toBeDefined();
});

test("enrich leaves benign NFTs unflagged", async () => {
  const filter = new ContentFilter(new MediaIndex(10), {
    fetchImpl: async () => okJson({ is_blocked: false }),
  });
  const event = nftEvent();
  await filter.enrich([event]);
  expect(event.mediaFilter).toBeUndefined();
});

test("a determination is cached per nftId (no refetch)", async () => {
  let calls = 0;
  const filter = new ContentFilter(new MediaIndex(10), {
    fetchImpl: async () => {
      calls++;
      return okJson({ collection: { sensitive_content: true } });
    },
  });
  await filter.enrich([nftEvent(), nftEvent()]);
  expect(calls).toBe(1);
});

test("a fetch error is permissive, negatively cached within TTL, retried after it", async () => {
  let calls = 0;
  let clock = 1000;
  const filter = new ContentFilter(new MediaIndex(10), {
    fetchImpl: async () => {
      calls++;
      throw new Error("network");
    },
    failTtlMs: 60000,
    now: () => clock,
  });
  const a = nftEvent();
  await filter.enrich([a]);
  expect(a.mediaFilter).toBeUndefined();
  // within the TTL the failed lookup is not repeated (doesn't re-stall every block)
  await filter.enrich([nftEvent()]);
  expect(calls).toBe(1);
  // once the TTL lapses the next lookup retries
  clock += 60001;
  await filter.enrich([nftEvent()]);
  expect(calls).toBe(2);
});

test("a 404 is positively cached as ok (no refetch)", async () => {
  let calls = 0;
  const filter = new ContentFilter(new MediaIndex(10), {
    fetchImpl: async () => {
      calls++;
      return statusResp(404);
    },
  });
  await filter.enrich([nftEvent()]);
  await filter.enrich([nftEvent()]);
  expect(calls).toBe(1);
});

test("a 5xx is permissive, not positively cached, retried after TTL", async () => {
  let calls = 0;
  let clock = 0;
  const filter = new ContentFilter(new MediaIndex(10), {
    fetchImpl: async () => {
      calls++;
      return statusResp(503);
    },
    failTtlMs: 1000,
    now: () => clock,
  });
  const a = nftEvent();
  await filter.enrich([a]);
  expect(a.mediaFilter).toBeUndefined();
  await filter.enrich([nftEvent()]); // within TTL → no refetch (not poisoned as a permanent ok)
  expect(calls).toBe(1);
  clock += 1001;
  await filter.enrich([nftEvent()]); // TTL elapsed → retry
  expect(calls).toBe(2);
});

test("enrich returns within budget when MintGarden is slow, then warms the cache", async () => {
  let release: () => void = () => {};
  const filter = new ContentFilter(new MediaIndex(10), {
    enrichBudgetMs: 10,
    fetchImpl: () =>
      new Promise<Response>((res) => {
        release = () => res(okJson({ is_blocked: true }));
      }),
  });
  const a = nftEvent();
  const t0 = Date.now();
  await filter.enrich([a]);
  // didn't block on the still-pending lookup, and published permissive for now
  expect(Date.now() - t0).toBeLessThan(300);
  expect(a.mediaFilter).toBeUndefined();
  // the background lookup finishes and warms the cache; a later spend sees it
  release();
  await tick();
  const b = nftEvent();
  await filter.enrich([b]);
  expect(b.mediaFilter).toBe("blocked");
});

test("non-NFT and nftId-less events are ignored", async () => {
  let calls = 0;
  const filter = new ContentFilter(new MediaIndex(10), {
    fetchImpl: async () => {
      calls++;
      return okJson({});
    },
  });
  const xch: SproutEvent = { type: "sprout", kind: "xch", height: 1, coinId: "1", amount: "1" };
  const noId = nftEvent({ nftId: undefined });
  await filter.enrich([xch as GroveEvent, noId]);
  expect(calls).toBe(0);
});

test("mapMintgardenSignals returns blocked when creator verification fires", () => {
  const v = mapMintgardenSignals({
    name: "totally nsfw piece",
    collection: { sensitive_content: true },
    creator: { verification_state: 2 },
  });
  expect(v.disposition).toBe("blocked");
});

test("mapMintgardenSignals chip7 metadata sensitive_content returns sensitive", () => {
  const v = mapMintgardenSignals({ data: { metadata_json: { sensitive_content: "nudity" } } });
  expect(v.disposition).toBe("sensitive");
});

test("mapMintgardenSignals clean json returns ok", () => {
  const v = mapMintgardenSignals({ name: "a calm landscape" });
  expect(v).toEqual({ disposition: "ok" });
});

test("mapMintgardenSignals: allow-list match on an otherwise-clean NFT sets whitelisted", () => {
  const whitelist = buildWhitelistSet([{ creatorDid: "did:chia:good", collectionId: "col_good" }]);
  const v = mapMintgardenSignals(
    { creator: { encoded_id: "did:chia:good" }, collection: { id: "col_good" } },
    { whitelist }
  );
  expect(v).toEqual({ disposition: "ok", whitelisted: true, signal: "whitelist" });
});

test("mapMintgardenSignals: allow-list does not suppress a lexicon hit", () => {
  const whitelist = buildWhitelistSet([{ creatorDid: "did:chia:good", collectionId: "col_good" }]);
  const v = mapMintgardenSignals(
    {
      name: "explicit piece",
      creator: { encoded_id: "did:chia:good" },
      collection: { id: "col_good" },
    },
    { whitelist }
  );
  expect(v).toEqual({ disposition: "sensitive", signal: "lexicon" });
});

test("mapMintgardenSignals: allow-list does not suppress a denylist entry", () => {
  const whitelist = buildWhitelistSet([{ creatorDid: "did:chia:good", collectionId: "col_good" }]);
  const denylist = buildDenylistMap([{ collectionId: "col_good", disposition: "blocked" }]);
  const v = mapMintgardenSignals(
    { creator: { encoded_id: "did:chia:good" }, collection: { id: "col_good" } },
    { whitelist, denylist }
  );
  expect(v).toEqual({ disposition: "blocked", signal: "denylist" });
});

test("mapMintgardenSignals: allow-list does not suppress a sensitive_content flag", () => {
  const whitelist = buildWhitelistSet([{ creatorDid: "did:chia:good", collectionId: "col_good" }]);
  const v = mapMintgardenSignals(
    {
      creator: { encoded_id: "did:chia:good" },
      collection: { id: "col_good", sensitive_content: true },
    },
    { whitelist }
  );
  expect(v).toEqual({ disposition: "sensitive", signal: "collection-sensitive" });
});

test("mapMintgardenSignals: allow-list does not suppress MintGarden authoritative blocked", () => {
  const whitelist = buildWhitelistSet([{ creatorDid: "did:chia:good", collectionId: "col_good" }]);
  const v = mapMintgardenSignals(
    { is_blocked: true, creator: { encoded_id: "did:chia:good" }, collection: { id: "col_good" } },
    { whitelist }
  );
  expect(v).toEqual({ disposition: "blocked", signal: "collection-blocked" });
});

test("mapMintgardenSignals: collection id alone is enough to whitelist (OR semantics)", () => {
  const whitelist = buildWhitelistSet([{ collectionId: "col_good" }]);
  const v = mapMintgardenSignals(
    { creator: { encoded_id: "did:chia:other" }, collection: { id: "col_good" } },
    { whitelist }
  );
  expect(v).toEqual({ disposition: "ok", whitelisted: true, signal: "whitelist" });
});

test("mapMintgardenSignals: creator DID alone is enough to whitelist (OR semantics)", () => {
  const whitelist = buildWhitelistSet([{ creatorDid: "did:chia:good" }]);
  const v = mapMintgardenSignals(
    { creator: { encoded_id: "did:chia:good" }, collection: { id: "col_unknown" } },
    { whitelist }
  );
  expect(v).toEqual({ disposition: "ok", whitelisted: true, signal: "whitelist" });
});

test("mapMintgardenSignals: neither identifier on the list leaves the verdict plain ok", () => {
  const whitelist = buildWhitelistSet([{ collectionId: "col_good" }]);
  const v = mapMintgardenSignals(
    { creator: { encoded_id: "did:chia:other" }, collection: { id: "col_other" } },
    { whitelist }
  );
  expect(v).toEqual({ disposition: "ok" });
});

// ── ContentStore content_hash persistence ───────────────────────────────────

test("putCheap persists contentHash and get() returns it", () => {
  const store = new ContentStore(":memory:");
  store.putCheap("lid1", "nft1a", { disposition: "ok" }, "ab".repeat(32));
  const v = store.get("lid1");
  expect(v?.contentHash).toBe("ab".repeat(32));
  store.close();
});

test("putCheap without contentHash returns undefined from get()", () => {
  const store = new ContentStore(":memory:");
  store.putCheap("lid2", "nft1b", { disposition: "ok" });
  const v = store.get("lid2");
  expect(v?.contentHash).toBeUndefined();
  store.close();
});

test("putCheap COALESCE: existing hash preserved when update omits it", () => {
  const store = new ContentStore(":memory:");
  store.putCheap("lid3", "nft1c", { disposition: "ok" }, "cd".repeat(32));
  // second upsert with no hash — should not overwrite
  store.putCheap("lid3", "nft1c", { disposition: "sensitive" });
  const v = store.get("lid3");
  expect(v?.contentHash).toBe("cd".repeat(32));
  expect(v?.disposition).toBe("sensitive");
  store.close();
});

test("enrich upgrades MediaIndex on store-hit path when contentHash was persisted", async () => {
  const HASH = "ab".repeat(32);
  const store = new ContentStore(":memory:");
  // pre-populate store with a verdict that includes a contentHash (simulating
  // a prior network fetch that extracted the hash and persisted it)
  store.putCheap("cd".repeat(32), "nft1example", { disposition: "ok" }, HASH);
  let fetchCalls = 0;
  const media = new MediaIndex(10);
  media.set("cd".repeat(32), { url: "https://ipfs.mintgarden.io/ipfs/old", kind: "image" });
  const filter = new ContentFilter(media, {
    store,
    fetchImpl: async () => {
      fetchCalls++;
      return okJson({});
    },
  });
  // enrich should take store-hit path (no network call) and still upgrade MediaIndex
  await filter.enrich([nftEvent()]);
  expect(fetchCalls).toBe(0); // confirms store-hit path taken
  expect(media.get("cd".repeat(32))?.url).toBe(`https://archive.mintgarden.io/content/${HASH}`);
  store.close();
});

test("enrich uses a stored verdict and skips the MintGarden fetch", async () => {
  const store = new ContentStore(":memory:");
  store.putCheap("launchX", "nft1x", { disposition: "sensitive" });
  let fetched = 0;
  const filter = new ContentFilter(new MediaIndex(10), {
    store,
    fetchImpl: (async () => {
      fetched++;
      return new Response("{}", { status: 200 });
    }) as typeof fetch,
  });
  const event: SproutEvent = {
    type: "sprout",
    kind: "nft",
    height: 1,
    coinId: "c",
    amount: "1",
    launcherId: "launchX",
    nftId: "nft1x",
    mediaKind: "image",
  };
  await filter.enrich([event]);
  expect(fetched).toBe(0);
  expect(event.mediaFilter).toBe("sensitive");
  store.close();
});

test("enrich queues SafeSearch for a clean image mint and emits a flag", async () => {
  const media = new MediaIndex(10);
  media.set("Lg", { url: "https://e/g.png", kind: "image" });
  const store = new ContentStore(":memory:");
  const flags: import("@grove/shared").ContentFlagEvent[] = [];
  const filter = new ContentFilter(media, {
    store,
    googleApiKey: "k",
    onFlag: (e) => flags.push(e),
    fetchImpl: (async (url: string) => {
      if (String(url).includes("images:annotate")) {
        return new Response(
          JSON.stringify({ responses: [{ safeSearchAnnotation: { adult: "LIKELY" } }] }),
          { status: 200 }
        );
      }
      return new Response("{}", { status: 404 }); // MintGarden unknown → ok
    }) as typeof fetch,
  });
  const event: SproutEvent = {
    type: "sprout",
    kind: "nft",
    height: 1,
    coinId: "c",
    amount: "1",
    mint: true,
    launcherId: "Lg",
    nftId: "nft1g",
    mediaKind: "image",
  };
  await filter.enrich([event]);
  await new Promise((r) => setTimeout(r, 0));
  expect(event.mediaFilter).toBeUndefined(); // streamed permissive
  expect(flags).toEqual([{ type: "content-flag", launcherId: "Lg", mediaFilter: "sensitive" }]);
  store.close();
});

test("enrich skips SafeSearch entirely for a whitelisted collection", async () => {
  const media = new MediaIndex(10);
  media.set("Wl", { url: "https://e/w.png", kind: "image" });
  const store = new ContentStore(":memory:");
  const flags: import("@grove/shared").ContentFlagEvent[] = [];
  let visionCalls = 0;
  const whitelist = buildWhitelistSet([{ creatorDid: "did:chia:good", collectionId: "col_good" }]);
  const filter = new ContentFilter(media, {
    store,
    googleApiKey: "k",
    onFlag: (e) => flags.push(e),
    whitelist,
    fetchImpl: (async (url: string) => {
      if (String(url).includes("images:annotate")) {
        visionCalls++;
        return new Response(
          JSON.stringify({ responses: [{ safeSearchAnnotation: { adult: "VERY_LIKELY" } }] }),
          { status: 200 }
        );
      }
      return okJson({ creator: { encoded_id: "did:chia:good" }, collection: { id: "col_good" } });
    }) as typeof fetch,
  });
  const event: SproutEvent = {
    type: "sprout",
    kind: "nft",
    height: 1,
    coinId: "c",
    amount: "1",
    mint: true,
    launcherId: "Wl",
    nftId: "nft1w",
    mediaKind: "image",
  };
  await filter.enrich([event]);
  await tick();
  expect(event.mediaFilter).toBeUndefined();
  expect(visionCalls).toBe(0);
  expect(flags).toEqual([]);
  expect(store.get("Wl")?.safesearchChecked).toBe(true);
  store.close();
});

test("enrich still runs SafeSearch when the NFT is not on the allow-list", async () => {
  const media = new MediaIndex(10);
  media.set("Nw", { url: "https://e/n.png", kind: "image" });
  const store = new ContentStore(":memory:");
  let visionCalls = 0;
  const whitelist = buildWhitelistSet([{ creatorDid: "did:chia:good", collectionId: "col_good" }]);
  const filter = new ContentFilter(media, {
    store,
    googleApiKey: "k",
    onFlag: () => {},
    whitelist,
    fetchImpl: (async (url: string) => {
      if (String(url).includes("images:annotate")) {
        visionCalls++;
        return new Response(
          JSON.stringify({ responses: [{ safeSearchAnnotation: { adult: "UNLIKELY" } }] }),
          { status: 200 }
        );
      }
      // different creator/collection than the whitelist entry above
      return okJson({ creator: { encoded_id: "did:chia:other" }, collection: { id: "col_other" } });
    }) as typeof fetch,
  });
  const event: SproutEvent = {
    type: "sprout",
    kind: "nft",
    height: 1,
    coinId: "c",
    amount: "1",
    mint: true,
    launcherId: "Nw",
    nftId: "nft1n",
    mediaKind: "image",
  };
  await filter.enrich([event]);
  await tick();
  expect(visionCalls).toBe(1);
  store.close();
});

test("enrich does not throw and still stamps verdict when store.get throws", async () => {
  // construct a fake store whose get() and putCheap() both throw to simulate
  // an SQLite IO failure; the filter should degrade gracefully (cache miss path)
  const throwingStore = {
    get: (_launcherId: string) => {
      throw new Error("sqlite disk error");
    },
    putCheap: (
      _launcherId: string,
      _nftId: string | undefined,
      _verdict: unknown,
      _contentHash?: string
    ) => {
      throw new Error("sqlite disk error");
    },
  } as unknown as import("../src/content-filter/store.js").ContentStore;

  const filter = new ContentFilter(new MediaIndex(10), {
    store: throwingStore,
    // fetchImpl returns a 404 → "ok" verdict from the network path
    fetchImpl: async () =>
      ({ ok: false, status: 404, json: async () => ({}) }) as unknown as Response,
  });
  const event = nftEvent();
  // must resolve without throwing
  await expect(filter.enrich([event])).resolves.toBeUndefined();
  // 404 → ok, so no mediaFilter stamped
  expect(event.mediaFilter).toBeUndefined();
});

test("enrich stamps sensitive verdict from network path when store.get throws", async () => {
  const throwingStore = {
    get: (_launcherId: string) => {
      throw new Error("sqlite disk error");
    },
    putCheap: (
      _launcherId: string,
      _nftId: string | undefined,
      _verdict: unknown,
      _contentHash?: string
    ) => {
      throw new Error("sqlite disk error");
    },
  } as unknown as import("../src/content-filter/store.js").ContentStore;

  const filter = new ContentFilter(new MediaIndex(10), {
    store: throwingStore,
    fetchImpl: async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({ collection: { sensitive_content: true } }),
      }) as unknown as Response,
  });
  const event = nftEvent();
  await expect(filter.enrich([event])).resolves.toBeUndefined();
  expect(event.mediaFilter).toBe("sensitive");
});

// ── extractContentHash ──────────────────────────────────────────────────────

test("extractContentHash returns lowercase hash for valid 64-char hex", () => {
  expect(extractContentHash({ data: { data_hash: "ab".repeat(32) } })).toBe("ab".repeat(32));
});

test("extractContentHash normalizes uppercase hex to lowercase", () => {
  expect(extractContentHash({ data: { data_hash: "AB".repeat(32) } })).toBe("ab".repeat(32));
});

test("extractContentHash returns undefined for 63-char string", () => {
  expect(extractContentHash({ data: { data_hash: "a".repeat(63) } })).toBeUndefined();
});

test("extractContentHash returns undefined for non-hex characters", () => {
  expect(extractContentHash({ data: { data_hash: "z".repeat(64) } })).toBeUndefined();
});

test("extractContentHash returns undefined when data_hash is null", () => {
  expect(extractContentHash({ data: { data_hash: null } })).toBeUndefined();
});

test("extractContentHash returns undefined when data key is absent", () => {
  expect(extractContentHash({ name: "no data key here" })).toBeUndefined();
});

test("extractContentHash returns undefined for null input", () => {
  expect(extractContentHash(null)).toBeUndefined();
});

// ── Archive CDN URL upgrade ─────────────────────────────────────────────────

const CONTENT_HASH = "ab".repeat(32); // valid 64-char hex

test("enrich upgrades MediaIndex to Archive CDN URL when data_hash is present", async () => {
  const media = new MediaIndex(10);
  media.set("cd".repeat(32), { url: "https://ipfs.mintgarden.io/ipfs/abc", kind: "image" });
  const filter = new ContentFilter(media, {
    fetchImpl: async () => okJson({ is_blocked: false, data: { data_hash: CONTENT_HASH } }),
  });
  await filter.enrich([nftEvent()]);
  expect(media.get("cd".repeat(32))?.url).toBe(
    `https://archive.mintgarden.io/content/${CONTENT_HASH}`
  );
  expect(media.get("cd".repeat(32))?.kind).toBe("image");
});

test("enrich does not change MediaIndex URL when data_hash is absent", async () => {
  const media = new MediaIndex(10);
  const originalUrl = "https://ipfs.mintgarden.io/ipfs/abc";
  media.set("cd".repeat(32), { url: originalUrl, kind: "image" });
  const filter = new ContentFilter(media, {
    fetchImpl: async () => okJson({ is_blocked: false }),
  });
  await filter.enrich([nftEvent()]);
  expect(media.get("cd".repeat(32))?.url).toBe(originalUrl);
});

test("enrich deletes blocked NFT from MediaIndex even when data_hash is present", async () => {
  const media = new MediaIndex(10);
  media.set("cd".repeat(32), { url: "https://ipfs.mintgarden.io/ipfs/abc", kind: "image" });
  const filter = new ContentFilter(media, {
    fetchImpl: async () => okJson({ is_blocked: true, data: { data_hash: CONTENT_HASH } }),
  });
  await filter.enrich([nftEvent()]);
  expect(media.get("cd".repeat(32))).toBeUndefined();
});

test("enrich respects archiveBaseUrl option when upgrading MediaIndex", async () => {
  const media = new MediaIndex(10);
  media.set("cd".repeat(32), { url: "https://ipfs/a.png", kind: "image" });
  const filter = new ContentFilter(media, {
    fetchImpl: async () => okJson({ data: { data_hash: CONTENT_HASH } }),
    archiveBaseUrl: "https://test-archive.example",
  });
  await filter.enrich([nftEvent()]);
  expect(media.get("cd".repeat(32))?.url).toBe(
    `https://test-archive.example/content/${CONTENT_HASH}`
  );
});

test("SafeSearch receives Archive CDN URL when data_hash is present", async () => {
  const media = new MediaIndex(10);
  media.set("cd".repeat(32), { url: "https://ipfs.mintgarden.io/ipfs/abc", kind: "image" });
  const store = new ContentStore(":memory:");
  let capturedVisionUri: string | undefined;
  const filter = new ContentFilter(media, {
    store,
    googleApiKey: "k",
    onFlag: () => {},
    archiveBaseUrl: "https://archive.mintgarden.io",
    archiveCheckAttempts: 1,
    archiveCheckDelayMs: 0,
    fetchImpl: (async (url: string, init?: RequestInit) => {
      if (String(url).includes("images:annotate")) {
        const body = JSON.parse((init?.body as string) ?? "{}");
        capturedVisionUri = body.requests?.[0]?.image?.source?.imageUri;
        return new Response(
          JSON.stringify({ responses: [{ safeSearchAnnotation: { adult: "UNLIKELY" } }] }),
          { status: 200 }
        );
      }
      if (init?.method === "HEAD") {
        return new Response(null, { status: 200 });
      }
      // api.mintgarden.io response with data_hash
      return new Response(JSON.stringify({ data: { data_hash: CONTENT_HASH } }), { status: 200 });
    }) as typeof fetch,
  });
  await filter.enrich([nftEvent({ mint: true })]);
  await tick();
  expect(capturedVisionUri).toBe(`https://archive.mintgarden.io/content/${CONTENT_HASH}`);
  store.close();
});

// ── Archive ingestion pre-check ──────────────────────────────────────────────

const ARCHIVE_BASE = "https://archive.mintgarden.io";
const ARCHIVE_MEDIA_URL = `${ARCHIVE_BASE}/content/${"ab".repeat(32)}`;

test("SafeSearch HEAD-probes the content URL before Vision when it is an Archive URL", async () => {
  const media = new MediaIndex(10);
  media.set("cd".repeat(32), { url: ARCHIVE_MEDIA_URL, kind: "image" });
  const store = new ContentStore(":memory:");
  let archiveCalls = 0,
    visionCalls = 0;
  const filter = new ContentFilter(media, {
    store,
    googleApiKey: "k",
    onFlag: () => {},
    archiveBaseUrl: ARCHIVE_BASE,
    archiveCheckAttempts: 3,
    archiveCheckDelayMs: 0,
    fetchImpl: (async (url: string, init?: RequestInit) => {
      const s = String(url);
      if (s.includes("images:annotate")) {
        visionCalls++;
        return new Response(
          JSON.stringify({ responses: [{ safeSearchAnnotation: { adult: "UNLIKELY" } }] }),
          { status: 200 }
        );
      }
      if (init?.method === "HEAD") {
        archiveCalls++;
        return new Response(null, { status: 200 });
      }
      return new Response("{}", { status: 404 });
    }) as typeof fetch,
  });
  await filter.enrich([nftEvent({ mint: true })]);
  await tick();
  expect(archiveCalls).toBe(1);
  expect(visionCalls).toBe(1);
  store.close();
});

test("SafeSearch retries Archive check until ready then calls Vision", async () => {
  const media = new MediaIndex(10);
  media.set("cd".repeat(32), { url: ARCHIVE_MEDIA_URL, kind: "image" });
  const store = new ContentStore(":memory:");
  let archiveCalls = 0,
    visionCalls = 0;
  const filter = new ContentFilter(media, {
    store,
    googleApiKey: "k",
    onFlag: () => {},
    archiveBaseUrl: ARCHIVE_BASE,
    archiveCheckAttempts: 3,
    archiveCheckDelayMs: 0,
    fetchImpl: (async (url: string, init?: RequestInit) => {
      const s = String(url);
      if (s.includes("images:annotate")) {
        visionCalls++;
        return new Response(
          JSON.stringify({ responses: [{ safeSearchAnnotation: { adult: "UNLIKELY" } }] }),
          { status: 200 }
        );
      }
      if (init?.method === "HEAD") {
        archiveCalls++;
        return new Response(null, { status: archiveCalls >= 3 ? 200 : 404 });
      }
      return new Response("{}", { status: 404 });
    }) as typeof fetch,
  });
  await filter.enrich([nftEvent({ mint: true })]);
  await tick();
  expect(archiveCalls).toBe(3);
  expect(visionCalls).toBe(1);
  store.close();
});

test("SafeSearch does not call Vision when Archive check is exhausted", async () => {
  const media = new MediaIndex(10);
  media.set("cd".repeat(32), { url: ARCHIVE_MEDIA_URL, kind: "image" });
  const store = new ContentStore(":memory:");
  let archiveCalls = 0,
    visionCalls = 0;
  const filter = new ContentFilter(media, {
    store,
    googleApiKey: "k",
    onFlag: () => {},
    archiveBaseUrl: ARCHIVE_BASE,
    archiveCheckAttempts: 2,
    archiveCheckDelayMs: 0,
    fetchImpl: (async (url: string, init?: RequestInit) => {
      const s = String(url);
      if (s.includes("images:annotate")) {
        visionCalls++;
        return new Response(
          JSON.stringify({ responses: [{ safeSearchAnnotation: { adult: "UNLIKELY" } }] }),
          { status: 200 }
        );
      }
      if (init?.method === "HEAD") {
        archiveCalls++;
        return new Response(null, { status: 404 });
      }
      return new Response("{}", { status: 404 });
    }) as typeof fetch,
  });
  await filter.enrich([nftEvent({ mint: true })]);
  await tick();
  expect(archiveCalls).toBe(2);
  expect(visionCalls).toBe(0);
  store.close();
});

test("SafeSearch skips Archive check when imageUri is not an Archive URL", async () => {
  const media = new MediaIndex(10);
  media.set("cd".repeat(32), { url: "https://ipfs.mintgarden.io/ipfs/abc", kind: "image" });
  const store = new ContentStore(":memory:");
  let archiveCalls = 0,
    visionCalls = 0;
  const filter = new ContentFilter(media, {
    store,
    googleApiKey: "k",
    onFlag: () => {},
    archiveBaseUrl: ARCHIVE_BASE,
    archiveCheckAttempts: 3,
    archiveCheckDelayMs: 0,
    fetchImpl: (async (url: string, init?: RequestInit) => {
      const s = String(url);
      if (s.includes("images:annotate")) {
        visionCalls++;
        return new Response(
          JSON.stringify({ responses: [{ safeSearchAnnotation: { adult: "UNLIKELY" } }] }),
          { status: 200 }
        );
      }
      if (init?.method === "HEAD") {
        archiveCalls++;
        return new Response(null, { status: 404 });
      }
      return new Response("{}", { status: 404 });
    }) as typeof fetch,
  });
  await filter.enrich([nftEvent({ mint: true })]);
  await tick();
  expect(archiveCalls).toBe(0);
  expect(visionCalls).toBe(1);
  store.close();
});

test("SafeSearch treats Archive network error as not-ready and retries to exhaustion", async () => {
  const media = new MediaIndex(10);
  media.set("cd".repeat(32), { url: ARCHIVE_MEDIA_URL, kind: "image" });
  const store = new ContentStore(":memory:");
  let archiveCalls = 0,
    visionCalls = 0;
  const filter = new ContentFilter(media, {
    store,
    googleApiKey: "k",
    onFlag: () => {},
    archiveBaseUrl: ARCHIVE_BASE,
    archiveCheckAttempts: 2,
    archiveCheckDelayMs: 0,
    fetchImpl: (async (url: string, init?: RequestInit) => {
      const s = String(url);
      if (s.includes("images:annotate")) {
        visionCalls++;
        return new Response(
          JSON.stringify({ responses: [{ safeSearchAnnotation: { adult: "UNLIKELY" } }] }),
          { status: 200 }
        );
      }
      if (init?.method === "HEAD") {
        archiveCalls++;
        throw new Error("network error");
      }
      return new Response("{}", { status: 404 });
    }) as typeof fetch,
  });
  await filter.enrich([nftEvent({ mint: true })]);
  await tick();
  expect(archiveCalls).toBe(2);
  expect(visionCalls).toBe(0);
  store.close();
});

// ── video thumbnail URL ──────────────────────────────────────────────────────
// MintGarden serves a static poster for video NFTs at its assets CDN, keyed by
// content hash: https://assets.mainnet.mintgarden.io/thumbnails/{hash}_512.webp
// (the on-chain `data.thumbnail_uri`). The archive CDN does NOT serve thumbnails.

test("enrich sets the MintGarden thumbnail URL for a video NFT with a data_hash", async () => {
  const media = new MediaIndex(10);
  media.set("cd".repeat(32), { url: "https://ipfs.mintgarden.io/ipfs/clip.mp4", kind: "video" });
  const filter = new ContentFilter(media, {
    fetchImpl: async () => okJson({ data: { data_hash: CONTENT_HASH } }),
  });
  await filter.enrich([nftEvent({ mediaKind: "video" })]);
  expect(media.get("cd".repeat(32))?.thumbnailUrl).toBe(
    `https://assets.mainnet.mintgarden.io/thumbnails/${CONTENT_HASH}_512.webp`
  );
});

test("enrich leaves thumbnailUrl unset for an image NFT", async () => {
  const media = new MediaIndex(10);
  media.set("cd".repeat(32), { url: "https://ipfs.mintgarden.io/ipfs/a.png", kind: "image" });
  const filter = new ContentFilter(media, {
    fetchImpl: async () => okJson({ data: { data_hash: CONTENT_HASH } }),
  });
  await filter.enrich([nftEvent()]);
  expect(media.get("cd".repeat(32))?.thumbnailUrl).toBeUndefined();
});

// ── periodic SafeSearch sweep wiring ─────────────────────────────────────────

test("the sweep interval re-checks an unchecked NFT without a new spend, and close() stops it", async () => {
  vi.useFakeTimers();
  try {
    const media = new MediaIndex(10);
    media.set("cd".repeat(32), { url: "https://e/x.png", kind: "image" });
    const store = new ContentStore(":memory:");
    store.putCheap("cd".repeat(32), "nft1", { disposition: "ok" });
    let visionCalls = 0;
    const filter = new ContentFilter(media, {
      store,
      googleApiKey: "k",
      onFlag: () => {},
      safesearchSweepIntervalMs: 1000,
      fetchImpl: (async (url: string) => {
        if (String(url).includes("images:annotate")) {
          visionCalls++;
          return new Response(
            JSON.stringify({ responses: [{ safeSearchAnnotation: { adult: "UNLIKELY" } }] }),
            { status: 200 }
          );
        }
        return new Response("{}", { status: 404 });
      }) as typeof fetch,
    });
    await vi.advanceTimersByTimeAsync(1000); // first tick → sweep → Vision
    expect(visionCalls).toBe(1);
    filter.close();
    // a fresh, unchecked launcher that a further tick WOULD pick up if the
    // timer were still alive (the first launcher is now safesearchChecked, so
    // it alone can't distinguish a stopped timer from the checked-flag guard)
    media.set("ef".repeat(32), { url: "https://e/y.png", kind: "image" });
    store.putCheap("ef".repeat(32), "nft2", { disposition: "ok" });
    await vi.advanceTimersByTimeAsync(5000);
    expect(visionCalls).toBe(1); // closed → no further sweeps
    store.close();
  } finally {
    vi.useRealTimers();
  }
});

test("localNsfwModelPath alone (no googleApiKey) still runs local classification standalone", async () => {
  const media = new MediaIndex(10);
  media.set("Lnsfw", { url: "https://e/local.png", kind: "image" });
  const store = new ContentStore(":memory:");
  const flags: import("@grove/shared").ContentFlagEvent[] = [];
  let visionCalls = 0;
  let byteFetchCalls = 0;
  const modelPath = fileURLToPath(new URL("../models/opennsfw2.onnx", import.meta.url));
  const sourceBytes = new Uint8Array(
    (await import("node:fs")).readFileSync(
      fileURLToPath(new URL("./fixtures/nsfw-parity-source.png", import.meta.url))
    )
  );
  const filter = new ContentFilter(media, {
    store,
    onFlag: (e) => flags.push(e),
    localNsfwModelPath: modelPath,
    fetchImpl: (async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        visionCalls++;
        return new Response("{}", { status: 200 });
      }
      byteFetchCalls++;
      return new Response(sourceBytes, { status: 200 });
    }) as typeof fetch,
  });
  const event: SproutEvent = {
    type: "sprout",
    kind: "nft",
    height: 1,
    coinId: "c",
    amount: "1",
    mint: true,
    launcherId: "Lnsfw",
    nftId: "nft-local",
    mediaKind: "image",
  };
  await filter.enrich([event]);
  await new Promise((r) => setTimeout(r, 500)); // ONNX inference is real, not instant

  expect(visionCalls).toBe(0);
  expect(byteFetchCalls).toBeGreaterThan(0);
  expect(flags).toEqual([]);
  expect(store.get("Lnsfw")?.safesearchChecked).toBe(false);
  filter.close();
  store.close();
});
