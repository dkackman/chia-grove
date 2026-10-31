import * as THREE from "three";
import { expect, test } from "vitest";
import { Vfx, torchRingPosition, cursorOpacity } from "../src/themes/mine/vfx.js";
import { torchRadius } from "../src/themes/mine/layout.js";

const sky = { daylight: 1 };

test("torches are one instanced draw whose count tracks the mempool", () => {
  const v = new Vfx(new THREE.Scene(), sky);
  expect(v.torches).toBeInstanceOf(THREE.InstancedMesh);
  v.setMempool(40);
  expect(v.torches.count).toBe(10);
  v.setMempool(10_000);
  expect(v.torches.count).toBe(60);
});

test("flame sprites are hidden in daylight and when unlit", () => {
  const scene = new THREE.Scene();
  const s = { daylight: 1 };
  const v = new Vfx(scene, s);
  v.setMempool(40); // 10 lit
  const flames = () => scene.children.filter((c) => c instanceof THREE.Sprite);
  v.update(0.016, 1);
  expect(flames().filter((f) => f.visible).length).toBe(0);
  s.daylight = 0.2;
  v.update(0.016, 2);
  expect(flames().filter((f) => f.visible).length).toBe(10);
});

test("the torch ring follows the island radius", () => {
  const v = new Vfx(new THREE.Scene(), sky);
  expect(v.torchRingRadius).toBeCloseTo(torchRadius(1), 5);
  v.setIslandRadius(torchRadius(120));
  expect(v.torchRingRadius).toBeCloseTo(torchRadius(120), 5);
  const m = new THREE.Matrix4();
  v.torches.getMatrixAt(0, m);
  const p = new THREE.Vector3().setFromMatrixPosition(m);
  expect(Math.hypot(p.x, p.z)).toBeCloseTo(torchRadius(120), 5);
  const q = torchRingPosition(15, 10);
  expect(Math.hypot(q.x, q.z)).toBeCloseTo(10, 5);
});

test("the build cursor flashes on a spend and settles back to rest", () => {
  expect(cursorOpacity(0)).toBeGreaterThan(cursorOpacity(1));
  expect(cursorOpacity(10)).toBeCloseTo(cursorOpacity(Infinity), 3);
  expect(cursorOpacity(Infinity)).toBeGreaterThan(0); // the cursor stays faintly visible
});
