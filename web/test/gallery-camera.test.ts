import * as THREE from "three";
import { expect, test } from "vitest";
import { framePiece, panEye } from "../src/themes/gallery/camera.js";

test("framing stands in front of the piece, looking at its center", () => {
  const center = new THREE.Vector3(8, 2.5, -3);
  const f = framePiece(center, 2.4, 45);
  expect(f.target.equals(center)).toBe(true);
  expect(f.eye.z).toBeGreaterThan(center.z); // camera is in front of the wall
  expect(f.eye.x).toBeCloseTo(center.x);
  expect(f.eye.y).toBeCloseTo(center.y);
});

test("taller pieces are framed from farther away", () => {
  const c = new THREE.Vector3(0, 2.5, -3);
  expect(framePiece(c, 3.2, 45).eye.z).toBeGreaterThan(framePiece(c, 1.6, 45).eye.z);
});

test("pan eye tracks the newest piece x at the resting standoff", () => {
  const e = panEye(40, 2.6, 9);
  expect(e.x).toBe(40);
  expect(e.y).toBe(2.6);
  expect(e.z).toBe(9);
});
