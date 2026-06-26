import { expect, test } from "vitest";
import { mapMintgarden } from "../src/classify/content-filter.js";
import { ContentFilter } from "../src/classify/content-filter.js";
import { MediaIndex } from "../src/web/media-index.js";
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

test("blocked takes precedence over sensitive", () => {
  expect(
    mapMintgarden({ is_blocked: true, collection: { sensitive_content: true } })
  ).toBe("blocked");
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
  ({ ok: true, json: async () => obj }) as unknown as Response;

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

test("a fetch error is permissive and not cached (retries next time)", async () => {
  let calls = 0;
  const filter = new ContentFilter(new MediaIndex(10), {
    fetchImpl: async () => {
      calls++;
      throw new Error("network");
    },
  });
  const a = nftEvent();
  await filter.enrich([a]);
  expect(a.mediaFilter).toBeUndefined();
  const b = nftEvent();
  await filter.enrich([b]);
  expect(calls).toBe(2);
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
