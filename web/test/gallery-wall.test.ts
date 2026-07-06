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

test("the floor uses the custom blur shader (soft wet-sheen, not a crisp mirror)", () => {
  const scene = new THREE.Scene();
  createWall(scene);
  const floor = scene.children.find((o) => o instanceof Reflector) as Reflector;
  const material = floor.material as THREE.ShaderMaterial;
  expect(material.uniforms.blurSize.value).toBeGreaterThan(0);
  expect(material.uniforms.fresnelPower.value).toBeGreaterThan(0);
});

// The backdrop is a fixed-width plane; a long session (or a mint burst) can
// push the camera's x well past its original span, which would otherwise
// leave pieces hanging in front of nothing. follow() recenters it around the
// camera so that can never happen, regardless of how far a session runs.

test("follow() leaves the backdrop alone while the camera is still well within its span", () => {
  const scene = new THREE.Scene();
  const wall = createWall(scene);
  const floor = scene.children.find((o) => o instanceof Reflector) as Reflector;
  const startX = floor.position.x;
  wall.follow(startX + 50); // small drift, nowhere near the edge
  expect(floor.position.x).toBe(startX);
});

test("follow() recenters the backdrop once the camera drifts near its edge", () => {
  const scene = new THREE.Scene();
  const wall = createWall(scene);
  const floor = scene.children.find((o) => o instanceof Reflector) as Reflector;
  const startX = floor.position.x;
  const farX = startX + 10_000; // many mints later, far past the original span
  wall.follow(farX);
  expect(floor.position.x).toBe(farX);
});

test("follow() moves the wall and its glow plane in lockstep with the floor", () => {
  const scene = new THREE.Scene();
  const wall = createWall(scene);
  const planes = scene.children.filter(
    (o) => o instanceof THREE.Mesh && o.geometry instanceof THREE.PlaneGeometry
  ) as THREE.Mesh[];
  expect(planes.length).toBeGreaterThanOrEqual(2); // the wall + its top-glow plane
  const farX = planes[0].position.x + 10_000;
  wall.follow(farX);
  for (const plane of planes) expect(plane.position.x).toBe(farX);
});
