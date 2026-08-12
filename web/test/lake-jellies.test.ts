import * as THREE from "three";
import { expect, test, vi } from "vitest";
import type { SproutEvent } from "@grove/shared";
import { Jellies } from "../src/themes/lake/jellies.js";

// markSensitive() reaches sensitivePlaceholderTexture(), which builds its
// (memoized, one-time) placeholder via document.createElement("canvas") — a
// real browser global that doesn't exist in vitest's default node
// environment. Stub just enough of the Canvas API for THREE.CanvasTexture to
// wrap it, mirroring the vi.stubGlobal pattern feed.test.ts and
// drain-queue.test.ts already use for other browser-only globals.
class FakeContext2D {
  fillStyle = "";
  strokeStyle = "";
  lineWidth = 0;
  fillRect(): void {}
  beginPath(): void {}
  moveTo(): void {}
  lineTo(): void {}
  stroke(): void {}
}
class FakeCanvas {
  width = 0;
  height = 0;
  getContext(): FakeContext2D {
    return new FakeContext2D();
  }
}
vi.stubGlobal("document", {
  createElement: (tag: string) => (tag === "canvas" ? new FakeCanvas() : {}),
});

const id = (n: number) => n.toString(16).padStart(8, "0") + "00".repeat(28);
const lid = (n: number) => "ff" + n.toString(16).padStart(62, "0");
// no mediaKind and no dataUri → resolveMedia returns { render: "none" }, so
// these tests never touch the loader or the DOM
const nft = (coinId: string, launcherId: string, height = 1): SproutEvent => ({
  type: "sprout",
  kind: "nft",
  height,
  coinId,
  amount: "1",
  launcherId,
});

test("tracks NFTs by launcher id so repeat spends can be skipped", () => {
  const j = new Jellies(new THREE.Scene());
  j.plant(nft(id(1), lid(1)), 0);
  expect(j.has(lid(1))).toBe(true);
  expect(j.has(lid(2))).toBe(false);
});

test("wrapping a jellyfish out of the pool frees its launcher", () => {
  const j = new Jellies(new THREE.Scene(), 1);
  j.plant(nft(id(1), lid(1)), 0);
  j.plant(nft(id(2), lid(2)), 0);
  expect(j.has(lid(1))).toBe(false);
  expect(j.has(lid(2))).toBe(true);
});

test("clearAbove frees the launchers of the jellyfish it removes", () => {
  const j = new Jellies(new THREE.Scene());
  j.plant(nft(id(1), lid(1), 10), 0);
  j.plant(nft(id(2), lid(2), 12), 0);
  j.clearAbove(12);
  expect(j.has(lid(1))).toBe(true);
  expect(j.has(lid(2))).toBe(false);
});

test("only planted jellyfish are pickable", () => {
  const j = new Jellies(new THREE.Scene());
  expect(j.pickables()).toHaveLength(0);
  j.plant(nft(id(1), lid(1)), 0);
  expect(j.pickables()).toHaveLength(1);
  expect(j.metaFor(j.pickables()[0])?.launcherId).toBe(lid(1));
});

test("a late content flag swaps a hung jellyfish to the placeholder", () => {
  const j = new Jellies(new THREE.Scene());
  j.plant(nft(id(1), lid(1)), 0);
  expect(j.markSensitive(lid(1))).toBe(true);
  expect(j.markSensitive(lid(2))).toBe(false);
  expect(j.metaFor(j.pickables()[0])?.mediaFilter).toBe("sensitive");
});

test("jellyfish sink with age like everything else in the column", () => {
  const j = new Jellies(new THREE.Scene(), 4);
  j.plant(nft(id(1), lid(1)), 0);
  const group = j.pickables()[0].parent as THREE.Object3D;
  const camera = new THREE.PerspectiveCamera();
  j.update(camera, 0, 0);
  const fresh = group.position.y;
  j.update(camera, 0, 10);
  expect(group.position.y).toBeLessThan(fresh);
});
