import * as THREE from "three";
import { expect, test } from "vitest";
import { surfaceGeometry } from "../src/themes/lake/water.js";
import { weedGeometry } from "../src/themes/lake/bed.js";
import { fishGeometry } from "../src/themes/lake/bodies.js";
import { shellGeometry } from "../src/themes/lake/turtles.js";

test("surface geometry is a valid renderable plane", () => {
  const g = surfaceGeometry();
  expect(g).toBeInstanceOf(THREE.BufferGeometry);
  expect(g.getAttribute("position").count).toBeGreaterThan(0);
});

test("weed geometry is a valid renderable blade", () => {
  const g = weedGeometry();
  expect(g).toBeInstanceOf(THREE.BufferGeometry);
  expect(g.getAttribute("position").count).toBeGreaterThan(0);
});

test("fish geometry is valid and renderable", () => {
  const g = fishGeometry();
  expect(g.getAttribute("position").count).toBeGreaterThan(0);
  expect(g.getAttribute("normal")).toBeDefined();
});

test("shell geometry is valid and renderable", () => {
  expect(shellGeometry().getAttribute("position").count).toBeGreaterThan(0);
});
