import * as THREE from "three";
import { expect, test, vi } from "vitest";
import type { SproutEvent, SproutKind } from "@grove/shared";

// glowTexture draws on a <canvas>; the node test env has no DOM
vi.mock("../src/themes/shared/textures.js", () => ({ glowTexture: () => new THREE.Texture() }));

const { FloraSystem, GLOW, bloomVariant, coolGlow } = await import("../src/themes/grove/flora.js");

let seq = 0;
function sprout(kind: SproutKind, height: number, mint = false): SproutEvent {
  seq++;
  const coinId = (seq * 2654435761).toString(16).padStart(16, "0").slice(-16).repeat(4);
  return { type: "sprout", kind, height, coinId, amount: "1000000000000", mint };
}

function hiddenSpriteCount(scene: THREE.Scene): { visible: number; total: number } {
  let visible = 0;
  let total = 0;
  scene.traverse((o) => {
    if (o instanceof THREE.Sprite) {
      total++;
      if (o.visible) visible++;
    }
  });
  return { visible, total };
}

test("glow sprites stay hidden (no draw calls) until planted", () => {
  const scene = new THREE.Scene();
  const flora = new FloraSystem(scene);
  expect(hiddenSpriteCount(scene).visible).toBe(0);
  flora.plant(sprout("nft", 1), { x: 0, z: 0 }, 0);
  flora.plant(sprout("did", 1), { x: 0, z: 0 }, 0);
  expect(hiddenSpriteCount(scene).visible).toBe(2);
  // ground pools are one instanced draw, not a mesh per bloom
  const meshes: THREE.Object3D[] = [];
  scene.traverse((o) => {
    if (o instanceof THREE.Mesh && !(o instanceof THREE.InstancedMesh)) meshes.push(o);
  });
  expect(meshes).toHaveLength(0);
});

test("clearAbove removes every kind at or above the fork height, and hides their glows", () => {
  const scene = new THREE.Scene();
  const flora = new FloraSystem(scene);
  const at = { x: 0, z: 0 };
  for (const h of [10, 11, 12]) {
    for (const kind of ["xch", "cat", "nft", "did"] as const) flora.plant(sprout(kind, h), at, 0);
  }
  expect(flora.activeCounts()).toEqual({ grass: 3, mushroom: 3, bloom: 3, wisp: 3, glows: 3 });

  flora.clearAbove(11);
  expect(flora.activeCounts()).toEqual({ grass: 1, mushroom: 1, bloom: 1, wisp: 1, glows: 1 });
  expect(hiddenSpriteCount(scene).visible).toBe(2); // the surviving bloom glow + wisp

  flora.clearAbove(0);
  expect(flora.activeCounts()).toEqual({ grass: 0, mushroom: 0, bloom: 0, wisp: 0, glows: 0 });
  expect(hiddenSpriteCount(scene).visible).toBe(0);
});

test("the ringed bloom variant is reserved for mints", () => {
  expect(bloomVariant(true, 0)).toBe(1);
  expect(bloomVariant(true, 0.99)).toBe(1);
  for (const r of [0, 0.2, 0.5, 0.7, 0.99]) expect(bloomVariant(false, r)).not.toBe(1);
});

test("mint glow cools slowly to a level above an ordinary bloom's", () => {
  expect(GLOW.mintRest).toBeGreaterThan(GLOW.rest);
  let base: number = GLOW.mintBirth;
  for (let i = 0; i < 5 * 60; i++) base = coolGlow(base, GLOW.mintRest, GLOW.mintDecay, 1 / 60);
  // still well above rest after 5 s
  expect(base).toBeGreaterThan(GLOW.mintRest + 0.2);
  for (let i = 0; i < 60 * 60; i++) base = coolGlow(base, GLOW.mintRest, GLOW.mintDecay, 1 / 60);
  expect(base).toBe(GLOW.mintRest);
  expect(coolGlow(0.2, 0.3, 1, 1)).toBe(0.2);
});
