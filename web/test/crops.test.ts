import * as THREE from "three";
import { expect, test } from "vitest";
import type { SproutEvent } from "@grove/shared";
import { CropSystem } from "../src/themes/farm/crops.js";
import { PASS_SECONDS, Tractor } from "../src/themes/farm/tractor.js";

const sprout = (kind: SproutEvent["kind"], coinId: string): SproutEvent => ({
  type: "sprout",
  kind,
  height: 1,
  coinId,
  amount: "1000000000000",
});

test("crops wait for the tractor and plant once it passes", () => {
  const scene = new THREE.Scene();
  const tractor = new Tractor(scene);
  // a bare Texture keeps the test off the DOM (no canvas needed)
  const crops = new CropSystem(scene, new THREE.Texture());

  tractor.startRow(0, 0);
  crops.plant(sprout("xch", "00000001" + "00".repeat(28)), 0, 0); // near row start
  crops.plant(sprout("cat", "00000002" + "00".repeat(28)), 0, 100); // near row end
  expect(crops.pendingCount()).toBe(2);

  crops.update(0.2, 0.2, tractor); // tractor barely started
  expect(crops.pendingCount()).toBeGreaterThan(0);

  crops.update(PASS_SECONDS + 0.1, 0.1, tractor); // pass complete
  expect(crops.pendingCount()).toBe(0);
});

test("crops on older rows plant immediately", () => {
  const scene = new THREE.Scene();
  const tractor = new Tractor(scene);
  const crops = new CropSystem(scene, new THREE.Texture());

  tractor.startRow(5, 0);
  crops.plant(sprout("nft", "00000003" + "00".repeat(28)), 4, 0);
  crops.update(0.01, 0.01, tractor);
  expect(crops.pendingCount()).toBe(0);
});
