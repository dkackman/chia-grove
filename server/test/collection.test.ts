import { expect, test } from "vitest";
import type { SproutEvent } from "@grove/shared";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { Collection } from "../src/web/collection.js";
import { MediaIndex } from "../src/web/media-index.js";
import { buildServer } from "../src/web/server.js";
import { Hub } from "../src/web/hub.js";
import { RingBuffer } from "../src/web/ring-buffer.js";
import type { GroveEvent } from "@grove/shared";

const id = (n: number): string => n.toString(16).padStart(64, "0");

const nft = (n: number, over: Partial<SproutEvent> = {}): SproutEvent => ({
  type: "sprout",
  kind: "nft",
  height: 100 + n,
  coinId: id(1000 + n),
  amount: "1",
  launcherId: id(n),
  nftId: `nft1${n}`,
  mediaKind: "image",
  ...over,
});

/** A collection over a fresh MediaIndex that already knows art for launchers 1..count. */
function setup(
  opts: { clean?: (launcherId: string) => boolean; capacity?: number; count?: number } = {}
) {
  const media = new MediaIndex(100);
  for (let n = 1; n <= (opts.count ?? 9); n++) {
    media.set(id(n), { url: `https://art.example/${n}.png`, kind: "image" });
  }
  const flagged = new Set<string>();
  const collection = new Collection(":memory:", media, {
    isClean: opts.clean ?? ((launcherId) => !flagged.has(launcherId)),
    capacity: opts.capacity,
  });
  return { media, collection, flagged };
}

test("lists offered image NFTs newest first, shaped as NFT sprouts without URLs", () => {
  const { collection } = setup();
  collection.offer(nft(1, { mint: true }));
  collection.offer(nft(2));
  const pieces = collection.list(10);
  expect(pieces.map((p) => p.launcherId)).toEqual([id(2), id(1)]);
  expect(pieces[1]).toEqual({
    type: "sprout",
    kind: "nft",
    height: 101,
    coinId: id(1001),
    amount: "1",
    launcherId: id(1),
    nftId: "nft11",
    mediaKind: "image",
    mint: true,
  });
  expect(JSON.stringify(pieces)).not.toContain("art.example");
});

test("never collects anything the cheap tier marked sensitive or blocked", () => {
  const { collection } = setup();
  collection.offer(nft(1, { mediaFilter: "sensitive" }));
  collection.offer(nft(2, { mediaFilter: "blocked" }));
  expect(collection.size).toBe(0);
  expect(collection.list(10)).toEqual([]);
});

test("only still images with proxiable art are collected", () => {
  const { collection, media } = setup();
  collection.offer(nft(1, { mediaKind: "video" }));
  collection.offer(nft(2, { mediaKind: undefined }));
  collection.offer(nft(50)); // no MediaIndex entry
  collection.offer({ ...nft(3), kind: "cat" });
  media.set(id(4), { url: "https://art.example/4.mp4", kind: "video" });
  collection.offer(nft(4)); // event says image, index says video
  expect(collection.size).toBe(0);
});

test("a piece whose verdict is not clean is withheld, and shown once it clears", () => {
  const { collection, flagged } = setup();
  collection.offer(nft(1));
  collection.offer(nft(2));
  flagged.add(id(2));
  expect(collection.list(10).map((p) => p.launcherId)).toEqual([id(1)]);
  flagged.delete(id(2)); // e.g. SafeSearch finished and found it clean
  expect(collection.list(10).map((p) => p.launcherId)).toEqual([id(2), id(1)]);
});

test("a verdict check that throws fails closed", () => {
  const { collection } = setup({
    clean: () => {
      throw new Error("store unavailable");
    },
  });
  collection.offer(nft(1));
  expect(collection.list(10)).toEqual([]);
});

test("remove() takes a flagged piece out for good and releases its art", () => {
  const { collection, media } = setup();
  collection.offer(nft(1));
  collection.offer(nft(2));
  collection.remove(id(2));
  expect(collection.list(10).map((p) => p.launcherId)).toEqual([id(1)]);
  expect(collection.size).toBe(1);
  // the live entry for 2 is untouched; only the pin is released
  expect(media.get(id(2))?.url).toBe("https://art.example/2.png");
});

test("a collected piece stays resolvable after its live media entry evicts", () => {
  const media = new MediaIndex(2);
  media.set(id(1), {
    url: "https://art.example/1.png",
    kind: "image",
    fallbackUrl: "https://orig/1",
  });
  const collection = new Collection(":memory:", media, { isClean: () => true });
  collection.offer(nft(1));
  media.set(id(2), { url: "u2", kind: "image" });
  media.set(id(3), { url: "u3", kind: "image" }); // evicts 1 from the bounded map
  expect(media.get(id(1))).toEqual({
    url: "https://art.example/1.png",
    kind: "image",
    fallbackUrl: "https://orig/1",
  });
  collection.remove(id(1));
  expect(media.get(id(1))).toBeUndefined();
});

test("blocking an NFT (MediaIndex.delete) also drops its pin", () => {
  const { collection, media } = setup();
  collection.offer(nft(1));
  media.delete(id(1));
  expect(media.get(id(1))).toBeUndefined();
});

test("a repeat spend moves the piece to the front without duplicating it", () => {
  const { collection } = setup();
  collection.offer(nft(1));
  collection.offer(nft(2));
  collection.offer(nft(1, { height: 500, coinId: id(7777) }));
  expect(collection.size).toBe(2);
  const pieces = collection.list(10);
  expect(pieces.map((p) => p.launcherId)).toEqual([id(1), id(2)]);
  expect(pieces[0].height).toBe(500);
});

test("keeps only the newest `capacity` candidates and unpins the rest", () => {
  const media = new MediaIndex(2);
  const collection = new Collection(":memory:", media, { isClean: () => true, capacity: 2 });
  for (const n of [1, 2, 3]) {
    media.set(id(n), { url: `u${n}`, kind: "image" });
    collection.offer(nft(n));
  }
  expect(collection.list(10).map((p) => p.launcherId)).toEqual([id(3), id(2)]);
  expect(media.get(id(1))).toBeUndefined(); // evicted from the map and unpinned
});

test("limit caps the list after filtering", () => {
  const { collection, flagged } = setup();
  for (let n = 1; n <= 6; n++) collection.offer(nft(n));
  flagged.add(id(6));
  expect(collection.list(2).map((p) => p.launcherId)).toEqual([id(5), id(4)]);
});

test("a reorg forgets pieces collected from the orphaned blocks", () => {
  const { collection } = setup();
  collection.offer(nft(1)); // height 101
  collection.offer(nft(2)); // height 102
  collection.offer(nft(3)); // height 103
  collection.removeFrom(102);
  expect(collection.list(10).map((p) => p.launcherId)).toEqual([id(1)]);
});

test("seed() fills only an empty collection, newest first, skipping video posters", () => {
  const media = new MediaIndex(10);
  const collection = new Collection(":memory:", media, { isClean: () => true });
  const added = collection.seed([
    { launcherId: id(3), nftId: "nft13", uri: "https://archive.example/content/c" },
    { launcherId: id(2), uri: "https://assets.example/thumbnails/b_512.webp" },
    { launcherId: id(1), uri: "https://archive.example/content/a" },
    { launcherId: id(4), uri: "ipfs://not-https" },
  ]);
  expect(added).toBe(2);
  const pieces = collection.list(10);
  expect(pieces.map((p) => p.launcherId)).toEqual([id(3), id(1)]);
  expect(pieces[0]).toMatchObject({ height: 0, coinId: id(3), nftId: "nft13", mediaKind: "image" });
  expect(media.get(id(3))).toEqual({ url: "https://archive.example/content/c", kind: "image" });
  expect(media.get(id(2))).toBeUndefined();
  // already populated: a second seed is a no-op
  expect(collection.seed([{ launcherId: id(5), uri: "https://archive.example/content/e" }])).toBe(
    0
  );
  expect(collection.size).toBe(2);
});

test("seeded pieces are still subject to the verdict check", () => {
  const media = new MediaIndex(10);
  const flagged = new Set([id(1)]);
  const collection = new Collection(":memory:", media, { isClean: (l) => !flagged.has(l) });
  collection.seed([
    { launcherId: id(1), uri: "https://archive.example/content/a" },
    { launcherId: id(2), uri: "https://archive.example/content/b" },
  ]);
  expect(collection.list(10).map((p) => p.launcherId)).toEqual([id(2)]);
});

test("persists across restarts and re-pins the art", () => {
  const path = join(mkdtempSync(join(tmpdir(), "grove-collection-")), "c.sqlite");
  const media1 = new MediaIndex(10);
  media1.set(id(1), {
    url: "https://art.example/1.png",
    kind: "image",
    thumbnailUrl: "https://t/1",
  });
  const c1 = new Collection(path, media1, { isClean: () => true });
  c1.offer(nft(1));
  c1.close();

  const media2 = new MediaIndex(10); // fresh process: live index is empty
  const c2 = new Collection(path, media2, { isClean: () => true });
  expect(c2.list(10).map((p) => p.launcherId)).toEqual([id(1)]);
  expect(media2.get(id(1))).toEqual({
    url: "https://art.example/1.png",
    kind: "image",
    thumbnailUrl: "https://t/1",
  });
  c2.close();
});

test("GET /collection serves the list, clamps limit, and is empty without a collection", async () => {
  const silent = pino({ level: "silent" });
  const hub = () => new Hub(new RingBuffer<GroveEvent>(10), "test");
  const { collection, media } = setup({ count: 60 });
  for (let n = 1; n <= 60; n++) collection.offer(nft(n));

  const app = await buildServer(hub(), media, silent, undefined, collection);
  const byDefault = await app.inject({ method: "GET", url: "/collection" });
  expect(byDefault.statusCode).toBe(200);
  expect(byDefault.json().pieces).toHaveLength(18);
  expect(byDefault.json().pieces[0].launcherId).toBe(id(60));
  expect(
    (await app.inject({ method: "GET", url: "/collection?limit=5" })).json().pieces
  ).toHaveLength(5);
  expect(
    (await app.inject({ method: "GET", url: "/collection?limit=999" })).json().pieces
  ).toHaveLength(48);
  expect(
    (await app.inject({ method: "GET", url: "/collection?limit=abc" })).json().pieces
  ).toHaveLength(18);
  await app.close();

  const bare = await buildServer(hub(), new MediaIndex(10), silent);
  expect((await bare.inject({ method: "GET", url: "/collection" })).json()).toEqual({ pieces: [] });
  await bare.close();
});
