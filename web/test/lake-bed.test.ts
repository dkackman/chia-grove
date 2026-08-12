import * as THREE from "three";
import { expect, test } from "vitest";
import { createBed } from "../src/themes/lake/bed.js";
import { BED_Y } from "../src/themes/lake/layout.js";

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
