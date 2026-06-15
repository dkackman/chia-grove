import * as THREE from "three";
import { expect, test } from "vitest";
import type { SproutEvent } from "@grove/shared";
import { Paintings } from "../src/themes/mine/structures.js";

const seat = { col: 0, row: 0, layer: 0 };
const chunk = { x: 0, z: 0 };
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

test("tracks NFTs by launcher id so duplicates can be skipped", () => {
  const p = new Paintings(new THREE.Scene());
  p.plant(nft(id(1), lid(1)), chunk, seat);
  expect(p.has(lid(1))).toBe(true);
  expect(p.has(lid(2))).toBe(false);
});

test("wrapping an NFT out of the pool frees its launcher", () => {
  const p = new Paintings(new THREE.Scene(), 1); // cap 1 → next plant wraps slot 0
  p.plant(nft(id(1), lid(1)), chunk, seat);
  p.plant(nft(id(2), lid(2)), chunk, seat); // overwrites lid(1)
  expect(p.has(lid(1))).toBe(false);
  expect(p.has(lid(2))).toBe(true);
});

test("clearAbove frees the launchers of the paintings it removes", () => {
  const p = new Paintings(new THREE.Scene());
  p.plant(nft(id(1), lid(1), 10), chunk, seat);
  p.plant(nft(id(2), lid(2), 12), chunk, seat);
  p.clearAbove(12); // removes only lid(2)
  expect(p.has(lid(1))).toBe(true);
  expect(p.has(lid(2))).toBe(false);
});
