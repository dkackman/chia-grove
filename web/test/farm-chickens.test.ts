import * as THREE from "three";
import { expect, test } from "vitest";
import { chaseCount, Chickens, followTarget } from "../src/themes/farm/chickens.js";

test("one hen chases per included mempool item, capped by the flock that is out", () => {
  expect(chaseCount(3, 20)).toBe(3);
  expect(chaseCount(0, 20)).toBe(0);
  expect(chaseCount(500, 20)).toBe(20);
  // historical blocks carry no mempool figures: a share of the flock
  expect(chaseCount(undefined, 20)).toBe(8);
});

test("chasing hens trail behind the plow, whichever way it is heading", () => {
  expect(followTarget(10, 1, 2)).toBe(8);
  expect(followTarget(10, -1, 2)).toBe(12);
});

test("only visible hens chase, and only as many as asked", () => {
  const scene = new THREE.Scene();
  const chickens = new Chickens(scene, 120);
  chickens.setMempool(40); // 18 out
  expect(chickens.visibleCount()).toBe(18);
  chickens.chase(0, 20, 5);
  expect(chickens.chasingCount(1)).toBe(5);
  chickens.chase(0, 20, 999);
  expect(chickens.chasingCount(1)).toBe(18);
  // the instanced mesh draws only the hens that are out
  const mesh = scene.children.find((o) => o instanceof THREE.InstancedMesh) as THREE.InstancedMesh;
  expect(mesh.count).toBe(18);
  chickens.update(1, 0.016, { x: 0, direction: 1 });
  expect(chickens.chasingCount(25)).toBe(0);
});
