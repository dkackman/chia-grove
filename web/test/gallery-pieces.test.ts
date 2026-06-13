import * as THREE from "three";
import { expect, test } from "vitest";
import type { SproutEvent } from "@grove/shared";
import { Pieces } from "../src/themes/gallery/pieces.js";

const mint = (coinId: string, height = 1): SproutEvent => ({
  type: "sprout",
  kind: "nft",
  height,
  coinId,
  amount: "1000000000000",
  mint: true,
  imageUrl: "https://example.test/" + coinId + ".png",
});

const id = (n: number) => n.toString(16).padStart(8, "0") + "00".repeat(28);

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

test("newestX advances rightward as pieces are added", () => {
  const pieces = new Pieces(new THREE.Scene(), 28);
  pieces.add(mint(id(1)), new THREE.Texture());
  const first = pieces.newestX();
  pieces.add(mint(id(2)), new THREE.Texture());
  expect(pieces.newestX()).toBeGreaterThan(first);
});
