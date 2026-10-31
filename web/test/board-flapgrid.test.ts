// web/test/board-flapgrid.test.ts
import * as THREE from "three";
import { expect, test } from "vitest";
import { FlapGrid } from "../src/themes/board/flapgrid.js";
import { charToGlyph } from "../src/themes/board/glyphs.js";
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

/** The (from, to, phase) the shader composites for one cell. */
function flapOf(g: FlapGrid, cell: number): [number, number, number] {
  const a = g.mesh.geometry.getAttribute("aFlap");
  return [a.getX(cell), a.getY(cell), a.getZ(cell)];
}

test("a mid-flip cell shows the old card hinging over toward the next one", () => {
  const g = grid(1, 1);
  g.setRow(0, "B", false); // blank → A → B
  g.update(0.03); // half of FLIP_TIME: the upper leaf is edge-on
  const [from, to, phase] = flapOf(g, 0);
  expect(from).toBe(charToGlyph(" "));
  expect(to).toBe(charToGlyph("A"));
  expect(phase).toBeCloseTo(0.5);
});

test("an instant set settles a cell caught mid-flip", () => {
  const g = grid(1, 2);
  g.setRow(0, "AB", false); // start a riffle
  g.update(0.03); // cell 0 sits mid-flip
  expect(flapOf(g, 0)[2]).toBeGreaterThan(0);

  // snapping the row instantly (the flooding / scroll / reorg path) must not
  // leave a leaf hanging — the cell shows the new glyph, flat
  g.setRow(0, "CD", true);
  expect(flapOf(g, 0)).toEqual([charToGlyph("C"), charToGlyph("C"), 0]);
  expect(g.idle()).toBe(true);
});

test("a cell past its midpoint still lands when the frame rate drops below 16 fps", () => {
  // regression: dt clamped to FLIP_TIME added exactly 1.0 per step, so a cell
  // whose phase sat ≥ 0.5 never re-crossed the midpoint and riffled forever
  const g = grid(1, 1);
  g.setRow(0, "Z", false);
  g.update(0.04); // phase ≈ 0.67 — past the old midpoint swap
  for (let i = 0; i < 200; i++) g.update(0.1);
  expect(g.idle()).toBe(true);
  expect(flapOf(g, 0)).toEqual([charToGlyph("Z"), charToGlyph("Z"), 0]);
});

test("a digit change on a settled cell takes one flip", () => {
  const g = grid(1, 1);
  g.setRow(0, "9", true);
  g.setRow(0, "0", false);
  g.update(0.06);
  expect(g.idle()).toBe(true);
});
