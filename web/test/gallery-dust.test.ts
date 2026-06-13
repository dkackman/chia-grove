import * as THREE from "three";
import { expect, test } from "vitest";
import type { SproutEvent } from "@grove/shared";
import { SpendDust, dustColor } from "../src/themes/gallery/dust.js";

const ev = (over: Partial<SproutEvent>): SproutEvent => ({
  type: "sprout",
  kind: "xch",
  height: 1,
  coinId: "ab".repeat(32),
  amount: "1",
  ...over,
});

test("dustColor varies by kind and is deterministic per CAT asset", () => {
  expect(dustColor(ev({ kind: "xch" })).getHex()).not.toBe(dustColor(ev({ kind: "did" })).getHex());
  const a = dustColor(ev({ kind: "cat", assetId: "11".repeat(32) }));
  const b = dustColor(ev({ kind: "cat", assetId: "11".repeat(32) }));
  expect(a.getHex()).toBe(b.getHex());
});

test("emit activates a speck; it deactivates once its life elapses", () => {
  const dust = new SpendDust(new THREE.Scene(), new THREE.Texture(), 8);
  expect(dust.activeCount()).toBe(0);
  dust.emit(ev({}), 0);
  expect(dust.activeCount()).toBe(1);
  dust.update(0.1);
  expect(dust.activeCount()).toBe(1);
  dust.update(20); // longer than any speck's max life
  expect(dust.activeCount()).toBe(0);
});

test("the pool wraps without exceeding its cap", () => {
  const dust = new SpendDust(new THREE.Scene(), new THREE.Texture(), 4);
  for (let i = 0; i < 10; i++) dust.emit(ev({}), 0);
  expect(dust.activeCount()).toBeLessThanOrEqual(4);
});
