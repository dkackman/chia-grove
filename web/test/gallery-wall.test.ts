import * as THREE from "three";
import { Reflector } from "three/examples/jsm/objects/Reflector.js";
import { expect, test } from "vitest";
import { createWall } from "../src/themes/gallery/wall.js";

test("createWall installs a reflective floor (Reflector) in the scene", () => {
  const scene = new THREE.Scene();
  createWall(scene);
  const reflectors = scene.children.filter((o) => o instanceof Reflector);
  expect(reflectors).toHaveLength(1);
});

test("the reflective floor lies flat at y=0", () => {
  const scene = new THREE.Scene();
  createWall(scene);
  const floor = scene.children.find((o) => o instanceof Reflector) as Reflector;
  expect(floor.rotation.x).toBeCloseTo(-Math.PI / 2);
  expect(floor.position.y).toBe(0);
});
