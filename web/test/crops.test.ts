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

test("re-plowing a row clears the crops still standing on it", () => {
  const scene = new THREE.Scene();
  const tractor = new Tractor(scene);
  const crops = new CropSystem(scene, new THREE.Texture());
  tractor.startRow(9, 0);
  crops.plant(sprout("xch", "00000001" + "00".repeat(28), 10), 0, 0);
  crops.plant(sprout("nft", "00000002" + "00".repeat(28), 10), 0, 1);
  crops.plant(sprout("cat", "00000003" + "00".repeat(28), 11), 1, 0);
  crops.update(0.01, 0.01, tractor);
  expect(activeHeights(crops)).toEqual([10, 10, 11]);

  // the field wrapped: row 0 is plowed again for a new block
  crops.clearRow(0);
  expect(activeHeights(crops)).toEqual([11]);
  const visibleGlows = scene.children.filter((o) => o instanceof THREE.Sprite && o.visible);
  // the tractor's own sprites are hidden while it is unused, so any visible
  // sprite would be a stale sunflower glow
  expect(visibleGlows.length).toBe(0);
});

test("sunflower glows stay hidden until their sunflower is planted", () => {
  const scene = new THREE.Scene();
  const tractor = new Tractor(scene);
  const crops = new CropSystem(scene, new THREE.Texture());
  const glows = () => scene.children.filter((o) => o instanceof THREE.Sprite && o.visible).length;
  expect(glows()).toBe(0);
  tractor.startRow(5, 0);
  crops.plant(sprout("nft", "00000002" + "00".repeat(28), 11), 1, 0);
  crops.update(0.01, 0.01, tractor);
  expect(glows()).toBe(1);
});

test("a wilt dips only the crops on the recent rows", () => {
  const scene = new THREE.Scene();
  const tractor = new Tractor(scene);
  const crops = new CropSystem(scene, new THREE.Texture());
  tractor.startRow(9, 0);
  crops.plant(sprout("cat", "00000001" + "00".repeat(28), 10), 0, 0); // old row
  crops.plant(sprout("cat", "00000002" + "00".repeat(28), 17), 7, 0); // recent row
  crops.update(0.01, 0.01, tractor);
  crops.update(5, 0.1, tractor); // fully grown
  crops.wilt(5, [8, 7, 6]);
  expect(crops.wiltingCount()).toBe(1);

  const heightOf = (h: number): number => {
    for (const mesh of crops.pickables()) {
      const m = mesh as THREE.InstancedMesh;
      for (let i = 0; i < m.count; i++) {
        if (crops.metaFor(mesh, i)?.height === h) {
          const matrix = new THREE.Matrix4();
          m.getMatrixAt(i, matrix);
          return new THREE.Vector3().setFromMatrixColumn(matrix, 1).length();
        }
      }
    }
    return NaN;
  };
  const before = [heightOf(10), heightOf(17)];
  crops.update(5.3, 0.1, tractor);
  expect(heightOf(10)).toBeCloseTo(before[0], 5); // old row untouched
  expect(heightOf(17)).toBeLessThan(before[1]); // recent row dips
  crops.update(8, 0.1, tractor); // wilt over: restored
  expect(heightOf(17)).toBeCloseTo(before[1], 5);
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
