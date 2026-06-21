// web/test/board-flapgrid.test.ts
import * as THREE from "three";
import { expect, test } from "vitest";
import { FlapGrid } from "../src/themes/board/flapgrid.js";
import { buildGlyphAtlasStub } from "./helpers/atlas-stub.js";

function grid(rows = 3, cols = 6) {
  const scene = new THREE.Scene();
  return new FlapGrid(scene, buildGlyphAtlasStub(), rows, cols);
}

test("mesh allocates one instance per cell", () => {
  const g = grid(3, 6);
  expect(g.mesh.count).toBe(18);
  expect(g.rows).toBe(3);
  expect(g.cols).toBe(6);
});

test("rowOf maps an instance id to its row", () => {
  const g = grid(3, 6);
  expect(g.rowOf(0)).toBe(0);
  expect(g.rowOf(6)).toBe(1);
  expect(g.rowOf(13)).toBe(2);
});

test("instant setRow lands the target glyph immediately and reports idle", () => {
  const g = grid(1, 6);
  g.setRow(0, "ABC", true);
  g.update(0.016);
  expect(g.idle()).toBe(true); // nothing animating after an instant set
});

test("animated setRow is not idle until it has riffled to target", () => {
  const g = grid(1, 6);
  g.setRow(0, "Z", false); // cell 0 must riffle from space to Z
  expect(g.idle()).toBe(false);
  for (let i = 0; i < 500; i++) g.update(0.05); // run the riffle to completion
  expect(g.idle()).toBe(true);
});

test("riffles to completion even at the caller's max dt (0.1)", () => {
  const g = grid(1, 6);
  g.setRow(0, "ZZZZZZ", false);
  for (let i = 0; i < 4000; i++) g.update(0.1);
  expect(g.idle()).toBe(true);
});
