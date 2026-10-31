import * as THREE from "three";
import { expect, test, vi } from "vitest";
import type { SproutEvent } from "@grove/shared";
import { Pieces } from "../src/themes/gallery/pieces.js";

const mint = (coinId: string, height = 1): SproutEvent => ({
  type: "sprout",
  kind: "nft",
  height,
  coinId,
  amount: "1000000000000",
  mint: true,
});

const id = (n: number) => n.toString(16).padStart(8, "0") + "00".repeat(28);
const lid = (n: number) => "ff" + n.toString(16).padStart(62, "0");
const nft = (coinId: string, launcherId: string, height = 1): SproutEvent => ({
  type: "sprout",
  kind: "nft",
  height,
  coinId,
  amount: "1",
  launcherId,
});

test("each add hangs a pickable piece carrying its event meta", () => {
  const pieces = new Pieces(new THREE.Scene(), 28);
  pieces.add(mint(id(1)), new THREE.Texture());
  expect(pieces.count()).toBe(1);
  const obj = pieces.pickables()[0];
  expect(pieces.metaFor(obj)?.coinId).toBe(id(1));
});

test("pool wraps at the cap, overwriting the oldest", () => {
  const pieces = new Pieces(new THREE.Scene(), 4);
  for (let i = 0; i < 6; i++) pieces.add(mint(id(i)), new THREE.Texture());
  expect(pieces.count()).toBe(4);
});

test("removeRecent drops pieces at or above the fork height", () => {
  const pieces = new Pieces(new THREE.Scene(), 28);
  pieces.add(mint(id(1), 10), new THREE.Texture());
  pieces.add(mint(id(2), 11), new THREE.Texture());
  pieces.add(mint(id(3), 12), new THREE.Texture());
  expect(pieces.removeRecent(11)).toBe(2); // heights 11 and 12 removed
  expect(pieces.count()).toBe(1);
});

test("newestX advances to new columns as pieces fill", () => {
  const pieces = new Pieces(new THREE.Scene(), 28);
  pieces.add(mint(id(1)), new THREE.Texture());
  const first = pieces.newestX();
  for (let i = 2; i <= 6; i++) pieces.add(mint(id(i)), new THREE.Texture()); // into later columns
  expect(pieces.newestX()).toBeGreaterThan(first);
});

// the art plane — the only pickable mesh per piece
const frameOf = (pieces: Pieces) => pieces.pickables()[0] as THREE.Mesh | undefined;

test("retiring a video piece pauses and releases its <video> element", () => {
  const pieces = new Pieces(new THREE.Scene(), 1); // cap 1 → next add retires this one
  const fakeVideo = { pause: vi.fn(), removeAttribute: vi.fn(), load: vi.fn() };
  const videoTexture = new THREE.Texture();
  videoTexture.image = fakeVideo; // stand in for a VideoTexture's <video> element
  pieces.add(mint(id(1)), videoTexture);

  pieces.add(mint(id(2)), new THREE.Texture()); // wraps → retires the video piece
  expect(fakeVideo.pause).toHaveBeenCalledTimes(1);
  expect(fakeVideo.removeAttribute).toHaveBeenCalledWith("src");
});

test("tracks NFTs by launcher id for dedup", () => {
  const pieces = new Pieces(new THREE.Scene(), 28);
  pieces.add(nft(id(1), lid(1)), new THREE.Texture());
  expect(pieces.hasLauncher(lid(1))).toBe(true);
  expect(pieces.hasLauncher(lid(2))).toBe(false);
});

test("ping refreshes the latest event, bumps the count, and reports success", () => {
  const pieces = new Pieces(new THREE.Scene(), 28);
  pieces.add(nft(id(1), lid(1), 10), new THREE.Texture());
  const obj = pieces.pickables()[0];
  expect(pieces.eventCountFor(obj)).toBe(1);

  expect(pieces.ping(nft(id(9), lid(1), 11))).toBe(true);
  expect(pieces.eventCountFor(obj)).toBe(2);
  expect(pieces.metaFor(obj)?.coinId).toBe(id(9)); // latest event wins
  expect(pieces.metaFor(obj)?.height).toBe(11);
});

test("ping on an unknown launcher is a no-op", () => {
  const pieces = new Pieces(new THREE.Scene(), 28);
  expect(pieces.ping(nft(id(1), lid(1)))).toBe(false);
});

test("wrapping out an NFT frees its launcher so it can hang again later", () => {
  const pieces = new Pieces(new THREE.Scene(), 1);
  pieces.add(nft(id(1), lid(1)), new THREE.Texture());
  pieces.add(nft(id(2), lid(2)), new THREE.Texture()); // wraps out lid(1)
  expect(pieces.hasLauncher(lid(1))).toBe(false);
  expect(pieces.hasLauncher(lid(2))).toBe(true);
});

test("a pinged piece's lamp lights up and then cools back to rest", () => {
  const pieces = new Pieces(new THREE.Scene(), 28);
  pieces.add(nft(id(1), lid(1)), new THREE.Texture());
  const frame = frameOf(pieces)!;
  pieces.ping(nft(id(2), lid(1)));
  pieces.update(0, 0); // apply heat, no time elapsed
  expect(pieces.lampGlowFor(frame)).toBeGreaterThan(0);
  pieces.update(10, 10); // 10s later → fully cooled
  expect(pieces.lampGlowFor(frame)).toBe(0);
});

test("hovering lights a frame; a wrapped-out slot does not stay hovered", () => {
  const pieces = new Pieces(new THREE.Scene(), 1); // cap 1 → every add wraps slot 0
  pieces.add(nft(id(1), lid(1)), new THREE.Texture());
  const frameA = frameOf(pieces)!;
  pieces.setHovered(frameA);
  pieces.update(0, 0);
  expect(pieces.lampGlowFor(frameA)).toBeGreaterThan(0); // hovered piece's lamp glows

  pieces.add(nft(id(2), lid(2)), new THREE.Texture()); // wraps: retires A, clears hover
  const frameB = frameOf(pieces)!;
  pieces.update(1, 1);
  // B reused A's slot but was never hovered — a stale hover pointer would light it
  expect(pieces.lampGlowFor(frameB)).toBe(0);
});

const imageOf = (pieces: Pieces) =>
  pieces.pickables().find((o) => (o as THREE.Mesh).geometry instanceof THREE.PlaneGeometry) as
    THREE.Mesh | undefined;

test("a content-flag that arrives while art is still loading blurs the piece once it lands", () => {
  const pieces = new Pieces(new THREE.Scene(), 28);
  const placeholder = new THREE.Texture();
  // flagged before the NFT is hung (art still in flight) — nothing to blur yet
  expect(pieces.markSensitive(lid(1), placeholder)).toBe(false);

  const realArt = new THREE.Texture();
  pieces.add(nft(id(1), lid(1)), realArt);

  const image = imageOf(pieces)!;
  const mat = image.material as THREE.MeshBasicMaterial;
  expect(mat.map).toBe(placeholder);
  expect(pieces.metaFor(image)?.mediaFilter).toBe("sensitive");
});

test("markSensitive pauses and releases a video already swapped to a live VideoTexture", () => {
  const pieces = new Pieces(new THREE.Scene(), 28);
  const fakeVideo = { pause: vi.fn(), removeAttribute: vi.fn(), load: vi.fn(), play: vi.fn() };
  const videoTex = new THREE.Texture();
  videoTex.image = fakeVideo; // stand in for a VideoTexture after swapToVideo() has run
  pieces.add(nft(id(1), lid(1)), videoTex);

  expect(pieces.markSensitive(lid(1), new THREE.Texture())).toBe(true);
  expect(fakeVideo.pause).toHaveBeenCalledTimes(1);
  expect(fakeVideo.removeAttribute).toHaveBeenCalledWith("src");
});

test("videoFor returns the backing <video> for a video piece, null otherwise", () => {
  const pieces = new Pieces(new THREE.Scene(), 28);

  const fakeVideo = { play: vi.fn(), pause: vi.fn() };
  const videoTex = new THREE.Texture();
  videoTex.image = fakeVideo; // stand in for a VideoTexture's <video> element
  pieces.add(mint(id(1)), videoTex);

  pieces.add(mint(id(2)), new THREE.Texture()); // image piece — no video-like image

  const forCoin = (coin: string) =>
    pieces.pickables().find((o) => pieces.metaFor(o)?.coinId === coin)!;

  expect(pieces.videoFor(forCoin(id(1)))).toBe(fakeVideo);
  expect(pieces.videoFor(forCoin(id(2)))).toBeNull();
  expect(pieces.videoFor(new THREE.Mesh())).toBeNull(); // unknown object
});

test("pickables are only the art planes, cached until the wall changes", () => {
  const pieces = new Pieces(new THREE.Scene(), 28);
  pieces.add(nft(id(1), lid(1)), new THREE.Texture());
  pieces.add(nft(id(2), lid(2)), new THREE.Texture());
  const picks = pieces.pickables();
  expect(picks).toHaveLength(2);
  expect(picks.every((o) => (o as THREE.Mesh).geometry instanceof THREE.PlaneGeometry)).toBe(true);
  expect(pieces.pickables()).toBe(picks); // same array: not rebuilt per pointermove
  pieces.add(nft(id(3), lid(3)), new THREE.Texture());
  expect(pieces.pickables()).not.toBe(picks); // invalidated on add
  expect(pieces.pickables()).toHaveLength(3);
});

test("frames share moulding geometry and materials across pieces in a bucket", () => {
  const pieces = new Pieces(new THREE.Scene(), 400);
  const scene = (pieces as unknown as { scene: THREE.Scene }).scene;
  for (let i = 0; i < 300; i++) pieces.add(nft(id(i), lid(i)), new THREE.Texture());
  const frames = scene.children
    .filter((c) => c instanceof THREE.Group)
    .map((g) => g.children[0] as THREE.Mesh);
  expect(new Set(frames.map((f) => f.material)).size).toBeLessThanOrEqual(4);
  expect(new Set(frames.map((f) => f.geometry)).size).toBeLessThan(frames.length);
});

test("a content-flag remembered for a load that never lands can be forgotten", () => {
  const pieces = new Pieces(new THREE.Scene(), 28);
  const placeholder = new THREE.Texture();
  const dispose = vi.spyOn(placeholder, "dispose");
  pieces.markSensitive(lid(1), placeholder);
  expect(pieces.pendingSensitiveCount).toBe(1);
  pieces.forgetSensitive(lid(1)); // its load dropped / failed / timed out
  expect(pieces.pendingSensitiveCount).toBe(0);
  expect(dispose).toHaveBeenCalled();
});

test("markSensitive with remember=false disposes the placeholder instead of holding it", () => {
  const pieces = new Pieces(new THREE.Scene(), 28);
  const placeholder = new THREE.Texture();
  const dispose = vi.spyOn(placeholder, "dispose");
  expect(pieces.markSensitive(lid(1), placeholder, false)).toBe(false);
  expect(pieces.pendingSensitiveCount).toBe(0);
  expect(dispose).toHaveBeenCalled();
});

test("remembered content-flags are capped, disposing the oldest", () => {
  const pieces = new Pieces(new THREE.Scene(), 4);
  const first = new THREE.Texture();
  const dispose = vi.spyOn(first, "dispose");
  pieces.markSensitive(lid(0), first);
  for (let i = 1; i <= 600; i++) pieces.markSensitive(lid(i), new THREE.Texture());
  expect(pieces.pendingSensitiveCount).toBeLessThanOrEqual(512);
  expect(dispose).toHaveBeenCalled();
  // the newest flag is still honoured when its art lands
  pieces.add(nft(id(1), lid(600)), new THREE.Texture());
  expect(pieces.metaFor(imageOf(pieces)!)?.mediaFilter).toBe("sensitive");
});

test("a reorg rewinds the hang cursor so the next pieces fill the emptied tail", () => {
  const pieces = new Pieces(new THREE.Scene(), 28);
  for (let i = 0; i < 6; i++) pieces.add(mint(id(i), 10 + Math.floor(i / 2)), new THREE.Texture());
  // heights: 10,10,11,11,12,12 → fork at 11 orphans the last four
  expect(pieces.nextIndex).toBe(6);
  expect(pieces.removeRecent(11)).toBe(4);
  expect(pieces.nextIndex).toBe(2);
  pieces.add(mint(id(9), 11), new THREE.Texture());
  expect(pieces.nextIndex).toBe(3); // took index 2, not 6 — no gap left behind
});

test("rewind stops at a surviving piece and never re-opens wrapped-over slots", () => {
  const pieces = new Pieces(new THREE.Scene(), 4);
  for (let i = 0; i < 6; i++) pieces.add(mint(id(i), 10 + i), new THREE.Texture());
  // pool holds indexes 2..5 (heights 12..15); orphan 14 and 15
  pieces.removeRecent(14);
  expect(pieces.nextIndex).toBe(4);
  pieces.removeRecent(0); // everything goes
  expect(pieces.nextIndex).toBe(2); // floor = next - cap; indexes 0,1 were wrapped over
  expect(pieces.count()).toBe(0);
});

test("reorg removal keys on the hanging block, not a later ping", () => {
  const pieces = new Pieces(new THREE.Scene(), 28);
  pieces.add(nft(id(1), lid(1), 10), new THREE.Texture());
  pieces.ping(nft(id(2), lid(1), 12)); // a later transfer of an NFT hung at 10
  expect(pieces.removeRecent(11)).toBe(0); // the piece itself predates the fork
  expect(pieces.hasLauncher(lid(1))).toBe(true);
});

test("a mint hangs without a sold dot; a transfer (or a later sale) gets one", () => {
  const pieces = new Pieces(new THREE.Scene(), 28);
  pieces.add({ ...nft(id(1), lid(1)), mint: true }, new THREE.Texture());
  const minted = imageOf(pieces)!;
  expect(pieces.isSold(minted)).toBe(false);
  pieces.ping(nft(id(2), lid(1))); // sold on
  expect(pieces.isSold(minted)).toBe(true);

  const other = new Pieces(new THREE.Scene(), 28);
  other.add(nft(id(3), lid(3)), new THREE.Texture());
  expect(other.isSold(imageOf(other)!)).toBe(true);
});

test("a block plaque marks where each new block's pieces start", () => {
  const pieces = new Pieces(new THREE.Scene(), 28);
  pieces.add(mint(id(1), 10), new THREE.Texture());
  pieces.add(mint(id(2), 10), new THREE.Texture());
  pieces.add(mint(id(3), 11), new THREE.Texture());
  const byCoin = (c: string) => pieces.pickables().find((o) => pieces.metaFor(o)?.coinId === c)!;
  expect(pieces.hasPlaque(byCoin(id(1)))).toBe(true);
  expect(pieces.hasPlaque(byCoin(id(2)))).toBe(false);
  expect(pieces.hasPlaque(byCoin(id(3)))).toBe(true);
});

test("a new piece's lamp switches on over the ramp instead of instantly", () => {
  const pieces = new Pieces(new THREE.Scene(), 28);
  pieces.add(mint(id(1)), new THREE.Texture());
  const obj = imageOf(pieces)!;
  expect(pieces.lampOnFor(obj)).toBe(0);
  pieces.update(0, 0.3);
  const mid = pieces.lampOnFor(obj);
  expect(mid).toBeGreaterThan(0);
  expect(mid).toBeLessThan(1);
  pieces.update(1, 1);
  expect(pieces.lampOnFor(obj)).toBe(1);
});
