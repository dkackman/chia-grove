import * as THREE from "three";
import { expect, test } from "vitest";
import type { SproutEvent } from "@grove/shared";
import { CropSystem } from "../src/themes/farm/crops.js";
import { PASS_SECONDS, Tractor } from "../src/themes/farm/tractor.js";

const sprout = (kind: SproutEvent["kind"], coinId: string, height = 1): SproutEvent => ({
  type: "sprout",
  kind,
  height,
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

function activeHeights(crops: CropSystem): number[] {
  const heights: number[] = [];
  for (const mesh of crops.pickables()) {
    const count = (mesh as THREE.InstancedMesh).count;
    for (let i = 0; i < count; i++) {
      const meta = crops.metaFor(mesh, i);
      if (meta) heights.push(meta.height);
    }
  }
  return heights.sort((a, b) => a - b);
}

test("clearAbove removes planted and pending crops from reorged blocks", () => {
  const scene = new THREE.Scene();
  const tractor = new Tractor(scene);
  const crops = new CropSystem(scene, new THREE.Texture());

  // rows 0-2 are behind the tractor, so these plant immediately
  tractor.startRow(5, 0);
  crops.plant(sprout("xch", "00000001" + "00".repeat(28), 10), 0, 0);
  crops.plant(sprout("nft", "00000002" + "00".repeat(28), 11), 1, 0);
  crops.plant(sprout("cat", "00000003" + "00".repeat(28), 12), 2, 0);
  crops.update(0.01, 0.01, tractor);
  expect(activeHeights(crops)).toEqual([10, 11, 12]);
  const litGlows = () =>
    scene.children.filter((o) => o instanceof THREE.Sprite && o.material.opacity > 0).length;
  expect(litGlows()).toBe(1); // the planted sunflower's glow

  // still queued on the unplowed current row, from a reorged block
  crops.plant(sprout("did", "00000004" + "00".repeat(28), 12), 5, 100);
  expect(crops.pendingCount()).toBe(1);

  crops.clearAbove(11);
  expect(activeHeights(crops)).toEqual([10]);
  expect(crops.pendingCount()).toBe(0);
  expect(litGlows()).toBe(0); // culled sunflower's glow is extinguished
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
