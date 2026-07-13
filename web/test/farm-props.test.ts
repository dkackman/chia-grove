import { expect, test } from "vitest";
import {
  baleGeometry,
  clutterGeometry,
  propPlacements,
  rockGeometry,
  scrubGeometry,
  tuftGeometry,
} from "../src/themes/farm/props.js";
import { FIELD, rowZ, TURF_RADIUS } from "../src/themes/farm/layout.js";

// mergeGeometries returns null when its inputs mix indexed and non-indexed
// geometry; a null geometry crashes the renderer on the first frame. Cones,
// cylinders and boxes are indexed; icosahedra are not.
test.each([
  ["rock", rockGeometry],
  ["tuft", tuftGeometry],
  ["scrub", scrubGeometry],
  ["bale", baleGeometry],
  ["clutter", clutterGeometry],
])("the %s geometry is valid and renderable", (_name, factory) => {
  const geometry = factory();
  expect(geometry).not.toBeNull();
  expect(geometry.getAttribute("position").count).toBeGreaterThan(0);
});

// A snapshot replay must not reshuffle the countryside.
test("the scatter is deterministic", () => {
  expect(propPlacements()).toEqual(propPlacements());
});

// A boulder in the crop rows gets planted through; one on the headland gets
// driven through. The tractor turns at x = ±24 and the rows span
// z ∈ [rowZ(47), rowZ(0)].
test("no prop stands where the tractor drives or the crops grow", () => {
  const near = rowZ(0) + 1.6; // the rows, plus the crops' z-jitter
  const far = rowZ(FIELD.rows - 1) - 1.6;
  for (const p of propPlacements()) {
    const inField = Math.abs(p.x) <= 25.5 && p.z <= near && p.z >= far;
    expect(inField, `${p.kind} at (${p.x}, ${p.z}) is in the field`).toBe(false);
  }
});

// The barnyard (x ∈ [−21.5, −5.5], z ∈ [−29, −21]) — which contains the barn,
// the woodpile, the trough, the ladder and the crates — and the silo (x ≈
// −4.6, z ≈ −26, r ≈ 1.5) are solid: a bale inside one is a bale inside a wall.
test("no scattered prop stands inside the barnyard or the silo", () => {
  for (const p of propPlacements()) {
    const inYard = p.x >= -21.5 && p.x <= -5.5 && p.z >= -29 && p.z <= -21;
    const inSilo = Math.hypot(p.x + 4.6, p.z + 26) < 2.4;
    expect(inYard || inSilo, `${p.kind} at (${p.x}, ${p.z})`).toBe(false);
  }
});

// The camera drifts at z ≈ 34, eleven units up, looking across the fence at the
// field. A boulder or a bale dropped into that corridor fills the frame. Tufts
// are exempt — they are ankle-high, and at the fence's foot they are exactly
// where they should be.
test("nothing but a tuft stands in the camera's foreground", () => {
  for (const p of propPlacements()) {
    if (p.kind === "tuft") continue;
    const inForeground = p.z > 20 && Math.abs(p.x) < 32;
    expect(inForeground, `${p.kind} at (${p.x}, ${p.z})`).toBe(false);
  }
});

test("every prop stands on the turf", () => {
  for (const p of propPlacements()) {
    expect(Math.hypot(p.x, p.z)).toBeLessThan(TURF_RADIUS);
  }
});
