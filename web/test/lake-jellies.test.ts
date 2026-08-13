import * as THREE from "three";
import { expect, test, vi } from "vitest";
import type { SproutEvent } from "@grove/shared";
import { Jellies, tentacleGeometry } from "../src/themes/lake/jellies.js";

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

test("tentacles are segmented ribbons, not rigid boxes", () => {
  const g = tentacleGeometry();
  // a 1×8-segment plane has 18 vertices; a box has 24 — assert on segmentation
  const pos = g.getAttribute("position");
  expect(pos.count).toBeGreaterThanOrEqual(18);
  g.computeBoundingBox();
  expect(g.boundingBox!.max.y).toBeLessThanOrEqual(0.001); // hangs downward from its root
});

/** Walks the scene to find a jelly's bell and tentacle meshes by geometry shape. */
function findJellyMaterials(scene: THREE.Scene): {
  bell: THREE.Material;
  tentacle: THREE.Material;
} {
  for (const group of scene.children) {
    let bell: THREE.Material | undefined;
    let tentacle: THREE.Material | undefined;
    for (const child of group.children) {
      if (!(child instanceof THREE.Mesh)) continue;
      if (child.geometry.type === "SphereGeometry") bell = child.material as THREE.Material;
      if (child.geometry.type === "PlaneGeometry") tentacle = child.material as THREE.Material;
    }
    if (bell && tentacle) return { bell, tentacle };
  }
  throw new Error("no jelly with a bell and a tentacle found in the scene");
}

test("bell and tentacle materials get distinct program cache keys (they compile different GLSL)", () => {
  const scene = new THREE.Scene();
  new Jellies(scene, 1);
  const { bell, tentacle } = findJellyMaterials(scene);
  expect(bell.customProgramCacheKey).toBeDefined();
  expect(tentacle.customProgramCacheKey).toBeDefined();
  expect(bell.customProgramCacheKey!()).not.toBe(tentacle.customProgramCacheKey!());
});

test("the injected pulse GLSL mirrors motion.ts's PULSE_SKEW and jellies.ts's PULSE_FREQ", () => {
  const scene = new THREE.Scene();
  new Jellies(scene, 1);
  const { bell, tentacle } = findJellyMaterials(scene);
  for (const material of [bell, tentacle]) {
    const fake = { uniforms: {} as Record<string, unknown>, vertexShader: "#include <begin_vertex>" };
    material.onBeforeCompile!(fake as never, null as never);
    expect(fake.vertexShader).toContain("0.6500");
    expect(fake.vertexShader).toContain("2.2000");
  }
});

test("a jelly pulses vertically around its band depth", () => {
  const jellies = new Jellies(new THREE.Scene(), 2);
  jellies.plant(nft(id(1), lid(1)), 0);
  const camera = new THREE.PerspectiveCamera();
  const ys = new Set<number>();
  for (let t = 0; t < 8; t += 0.25) {
    jellies.update(camera, t, 0);
    ys.add(Math.round(jellies.pickables()[0].parent!.position.y * 100));
  }
  expect(ys.size).toBeGreaterThan(3);
});
