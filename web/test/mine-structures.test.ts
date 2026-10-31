import * as THREE from "three";
import { expect, test } from "vitest";
import type { SproutEvent } from "@grove/shared";
import { Paintings, Villagers, angleDelta } from "../src/themes/mine/structures.js";

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

test("a stacked painting stands on its seat layer with a post reaching the ground", () => {
  const p = new Paintings(new THREE.Scene());
  p.plant(nft(id(1), lid(1)), chunk, { col: 0, row: 0, layer: 1 });
  p.plant(nft(id(2), lid(2)), chunk, { col: 0, row: 0, layer: 4 });
  const groups = p.pickables().map((o) => o.parent as THREE.Group);
  // three layers up → the easel is lifted by exactly three blocks, clear of
  // whatever is stacked beneath it (no shared space with cubes/villagers)
  expect(groups[1].position.y - groups[0].position.y).toBeCloseTo(3, 5);
  // ...and its post stretches down to the same ground line as the unstacked one
  const postBottom = (g: THREE.Group) => {
    const post = g.children[2];
    return g.position.y + post.position.y - post.scale.y;
  };
  expect(postBottom(groups[1])).toBeCloseTo(postBottom(groups[0]), 5);
});

test("recycling a slot disposes its loaded art (but never the shared placeholder)", () => {
  const p = new Paintings(new THREE.Scene(), 1);
  p.plant(nft(id(1), lid(1)), chunk, seat);
  const panel = p.pickables()[0] as THREE.Mesh;
  const mat = panel.material as THREE.MeshBasicMaterial;
  // simulate a completed load: hand the slot its own texture via the private path
  const tex = new THREE.Texture();
  let disposed = 0;
  tex.addEventListener("dispose", () => disposed++);
  const video = { paused: false, pause() {}, removeAttribute() {}, load() {} };
  let released = 0;
  video.load = () => released++;
  tex.image = video;
  const slot = (p as unknown as { pool: Array<{ ownsMap: boolean }> }).pool[0];
  mat.map = tex;
  slot.ownsMap = true;
  p.plant(nft(id(2), lid(2)), chunk, seat); // wraps slot 0
  expect(disposed).toBe(1);
  expect(released).toBe(1);
  expect(mat.map).toBe(null);
});

test("clearAbove and clearWhere dispose art on taken-down paintings", () => {
  const p = new Paintings(new THREE.Scene());
  p.plant(nft(id(1), lid(1), 10), chunk, seat);
  const mat = (p.pickables()[0] as THREE.Mesh).material as THREE.MeshBasicMaterial;
  const tex = new THREE.Texture();
  let disposed = 0;
  tex.addEventListener("dispose", () => disposed++);
  mat.map = tex;
  (p as unknown as { pool: Array<{ ownsMap: boolean }> }).pool[0].ownsMap = true;
  p.clearWhere((m) => m.coinId === id(1));
  expect(disposed).toBe(1);
  expect(p.pickables().length).toBe(0);
});

test("hover highlights a painting and clears on un-hover", () => {
  const p = new Paintings(new THREE.Scene());
  p.plant(nft(id(1), lid(1)), chunk, seat);
  const panel = p.pickables()[0] as THREE.Mesh;
  const mat = panel.material as THREE.MeshBasicMaterial;
  const base = mat.color.r;
  expect(p.setHighlight(panel, true)).toBe(true);
  expect(mat.color.r).toBeGreaterThan(base);
  p.setHighlight(panel, false);
  expect(mat.color.r).toBeCloseTo(base, 5);
  expect(p.setHighlight(new THREE.Mesh(), true)).toBe(false);
});

test("villagers are one instanced mesh, pickable and highlightable by instance", () => {
  const scene = new THREE.Scene();
  const v = new Villagers(scene);
  const did = { ...nft(id(7), lid(7), 5), kind: "did" as const, launcherId: undefined };
  v.plant(did, chunk, { col: 0, row: 0, layer: 1 }, 0);
  const [mesh] = v.pickables();
  expect(mesh).toBeInstanceOf(THREE.InstancedMesh);
  expect(v.metaFor(mesh, 0)).toBe(did);
  expect(v.setHighlight(mesh, 0, true)).toBe(true);
  v.clearAbove(5);
  expect(v.liveCount).toBe(0);
  expect(v.pickables().length).toBe(0);
});

test("villagers idle-bob only without reduced motion", () => {
  const v = new Villagers(new THREE.Scene());
  const did = { ...nft(id(8), lid(8)), kind: "did" as const, launcherId: undefined };
  v.plant(did, chunk, { col: 0, row: 0, layer: 1 }, 0);
  const cam = new THREE.PerspectiveCamera();
  cam.position.set(10, 5, 10);
  const ys = (reduced: boolean) => {
    const out = new Set<number>();
    const m = new THREE.Matrix4();
    for (let t = 1; t < 8; t += 0.05) {
      v.update(t, 0.05, cam, reduced);
      v.mesh.getMatrixAt(0, m);
      out.add(Math.round(m.elements[13] * 1000));
    }
    return out.size;
  };
  expect(ys(true)).toBe(1);
  expect(ys(false)).toBeGreaterThan(1);
});

test("angleDelta takes the short way round", () => {
  expect(angleDelta(0.1, -0.1)).toBeCloseTo(-0.2, 5);
  expect(angleDelta(3, -3)).toBeCloseTo(2 * Math.PI - 6, 5);
  expect(angleDelta(-3, 3)).toBeCloseTo(6 - 2 * Math.PI, 5);
});

test("each painting has a support post (easel) beneath the frame", () => {
  const p = new Paintings(new THREE.Scene());
  p.plant(nft(id(1), lid(1)), chunk, seat);
  const group = p.pickables()[0].parent as THREE.Group;
  const meshes = group.children.filter((c) => (c as THREE.Mesh).isMesh);
  expect(meshes.length).toBe(3); // frame, panel, post
});
