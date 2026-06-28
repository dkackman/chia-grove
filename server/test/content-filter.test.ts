import { expect, test } from "vitest";
import { mapMintgarden, mapMintgardenSignals } from "../src/content-filter/index.js";
import { ContentFilter } from "../src/content-filter/index.js";
import { MediaIndex } from "../src/web/media-index.js";
import { buildDenylistMap } from "../src/content-filter/signals/denylist.js";
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

test("mapMintgardenSignals reports which signals fired", () => {
  const v = mapMintgardenSignals({
    name: "totally nsfw piece",
    collection: { sensitive_content: true },
    creator: { verification_state: 2 },
  });
  expect(v.disposition).toBe("blocked"); // creator verification wins
  expect(v.signals.sort()).toEqual(["lexicon", "mintgarden", "mintgarden-creator"].sort());
});

test("mapMintgardenSignals chip7 metadata sensitive_content fires chip7", () => {
  const v = mapMintgardenSignals({ data: { metadata_json: { sensitive_content: "nudity" } } });
  expect(v.disposition).toBe("sensitive");
  expect(v.signals).toEqual(["chip7"]);
});

test("mapMintgardenSignals clean json fires nothing", () => {
  const v = mapMintgardenSignals({ name: "a calm landscape" });
  expect(v).toEqual({ disposition: "ok", signals: [] });
});

test("enrich uses a stored verdict and skips the MintGarden fetch", async () => {
  const store = new ContentStore(":memory:");
  store.putCheap("launchX", "nft1x", { disposition: "sensitive", signals: ["lexicon"] });
  let fetched = 0;
  const filter = new ContentFilter(new MediaIndex(10), {
    store,
    fetchImpl: (async () => {
      fetched++;
      return new Response("{}", { status: 200 });
    }) as typeof fetch,
  });
  const event: SproutEvent = {
    type: "sprout", kind: "nft", height: 1, coinId: "c", amount: "1",
    launcherId: "launchX", nftId: "nft1x", mediaKind: "image",
  };
  await filter.enrich([event]);
  expect(fetched).toBe(0);
  expect(event.mediaFilter).toBe("sensitive");
  expect(event.signals).toEqual(["lexicon"]);
  store.close();
});
