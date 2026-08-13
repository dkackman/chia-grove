import * as THREE from "three";
import { expect, test } from "vitest";
import { createLakeWater } from "../src/themes/lake/water.js";

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
