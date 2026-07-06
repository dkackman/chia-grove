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

const frameOf = (pieces: Pieces) =>
  pieces.pickables().find((o) => (o as THREE.Mesh).geometry instanceof THREE.BoxGeometry) as
    THREE.Mesh | undefined;

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

const emissiveOf = (frame: THREE.Mesh) =>
  (frame.material as THREE.MeshStandardMaterial).emissiveIntensity;

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

test("a pinged frame lights up and then cools back to rest", () => {
  const pieces = new Pieces(new THREE.Scene(), 28);
  pieces.add(nft(id(1), lid(1)), new THREE.Texture());
  const frame = frameOf(pieces)!;
  pieces.ping(nft(id(2), lid(1)));
  pieces.update(0, 0); // apply heat, no time elapsed
  expect(emissiveOf(frame)).toBeGreaterThan(0);
  pieces.update(10, 10); // 10s later → fully cooled
  expect(emissiveOf(frame)).toBe(0);
});

test("hovering lights a frame; a wrapped-out slot does not stay hovered", () => {
  const pieces = new Pieces(new THREE.Scene(), 1); // cap 1 → every add wraps slot 0
  pieces.add(nft(id(1), lid(1)), new THREE.Texture());
  const frameA = frameOf(pieces)!;
  pieces.setHovered(frameA);
  pieces.update(0, 0);
  expect(emissiveOf(frameA)).toBeGreaterThan(0); // hovered frame glows

  pieces.add(nft(id(2), lid(2)), new THREE.Texture()); // wraps: retires A, clears hover
  const frameB = frameOf(pieces)!;
  pieces.update(1, 1);
  // B reused A's slot but was never hovered — a stale hover pointer would light it
  expect(emissiveOf(frameB)).toBe(0);
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
