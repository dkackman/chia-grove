import * as THREE from "three";
import { expect, test } from "vitest";
import { surfaceGeometry, createLakeWater } from "../src/themes/lake/water.js";
import { weedGeometry, createBed } from "../src/themes/lake/bed.js";
import { BED_Y } from "../src/themes/lake/layout.js";
import { fishGeometry } from "../src/themes/lake/shoal.js";

test("surface geometry is a valid renderable plane", () => {
  const g = surfaceGeometry();
  expect(g).toBeInstanceOf(THREE.BufferGeometry);
  expect(g.getAttribute("position").count).toBeGreaterThan(0);
});

test("water installs depth fog on the scene", () => {
  const scene = new THREE.Scene();
  createLakeWater(scene);
  expect(scene.fog).toBeInstanceOf(THREE.FogExp2);
});

test("clearer water (more netspace) thins the fog", () => {
  const scene = new THREE.Scene();
  const water = createLakeWater(scene);
  const eib = (n: number) => String(Math.round(n * 1.152921504606847e18));

  water.setNetspace(eib(30));
  const clear = (scene.fog as THREE.FogExp2).density;
  water.setNetspace(eib(0.5));
  const murky = (scene.fog as THREE.FogExp2).density;

  expect(murky).toBeGreaterThan(clear);
});

test("update and ripple run without a renderer present", () => {
  const scene = new THREE.Scene();
  const water = createLakeWater(scene);
  expect(() => {
    water.update(1.5);
    water.ripple(1.5);
    water.update(2.0);
  }).not.toThrow();
});

test("weed geometry is a valid renderable blade", () => {
  const g = weedGeometry();
  expect(g).toBeInstanceOf(THREE.BufferGeometry);
  expect(g.getAttribute("position").count).toBeGreaterThan(0);
});

test("the bed adds a floor and a weed field at the bottom of the column", () => {
  const scene = new THREE.Scene();
  createBed(scene);
  const instanced = scene.children.find((c) => (c as THREE.InstancedMesh).isInstancedMesh);
  expect(instanced).toBeDefined();
  // every weed is planted, not left as a dead scale-0 slot
  expect((instanced as THREE.InstancedMesh).count).toBeGreaterThan(0);
  const floor = scene.children.find((c) => (c as THREE.Mesh).isMesh && c !== instanced);
  expect(floor).toBeDefined();
  expect((floor as THREE.Mesh).position.y).toBeCloseTo(BED_Y, 5);
});

test("bed update runs without a renderer present", () => {
  const bed = createBed(new THREE.Scene());
  expect(() => bed.update(3.0)).not.toThrow();
});

test("fish geometry is valid and renderable", () => {
  const g = fishGeometry();
  expect(g.getAttribute("position").count).toBeGreaterThan(0);
  expect(g.getAttribute("normal")).toBeDefined();
});
