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
import { hillHeight } from "../src/themes/farm/terrain.js";
import { nearLane } from "../src/themes/farm/landscape.js";

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

// FIX 1: the hills (terrain.ts) are opaque, front-face-culled domes — 46 of the
// 220 scattered props used to land inside one and never render. hillHeight is
// exactly 0 everywhere outside every dome's footprint, so this is a hard boundary,
// not a "close to a hill" heuristic.
test("no scattered prop stands where hillHeight(x, z) > 0", () => {
  for (const p of propPlacements()) {
    expect(hillHeight(p.x, p.z), `${p.kind} at (${p.x}, ${p.z})`).toBe(0);
  }
});

// FIX 5: a boulder at (46.1, -23.8) — 1.10 units from the lane's centreline —
// used to land in the dirt lane, undoing the gate gaps the hedgerows leave for it.
test("no scattered prop stands within 1.6 units of the dirt lane's centreline", () => {
  for (const p of propPlacements()) {
    expect(nearLane(p.x, p.z, 1.6), `${p.kind} at (${p.x}, ${p.z})`).toBe(false);
  }
});

// FIX 4: the crate stack used to sit dead centre of the chicken yard (x ∈
// [-17.5, -10.5], z ∈ [-26.5, -19.5]), and the upper crate overhung the lower
// one by nearly half its base. clutterGeometry() merges every barnyard object
// into one geometry; x > -8 isolates the crates from everything else in it —
// the ladder immediately to their west tops out at x = -8.195, and the
// woodpile/trough/silo are all much further west still.
test("the crate stack clears the chicken yard, the ladder, the doors and the barn wall", () => {
  const pos = clutterGeometry().getAttribute("position");
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let crateVerts = 0;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const y = pos.getY(i);
    if (x <= -8) continue; // not part of the crate stack
    crateVerts++;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  expect(crateVerts).toBeGreaterThan(0); // the filter actually found the crates

  expect(minX).toBeGreaterThan(-10.5); // clear of the chicken yard (x <= -10.5)
  expect(minX).toBeGreaterThan(-9.08); // clear of the sliding doors (x <= -9.08)
  expect(minX).toBeGreaterThan(-9.04); // clear of the door frame
  expect(minX).toBeGreaterThan(-8.195); // clear of the ladder (rails/rungs east edge)
  expect(maxX).toBeLessThan(-6.63); // clear of the east corner board (spans [-6.63, -6.47])
  expect(minZ).toBeGreaterThan(-23.675); // clear of the barn's front wall
  // stands in front of the east window (x in [-7.92, -7.08]) but never reaches
  // its sill (y = 1.23), so it cannot intersect the window
  expect(maxY).toBeLessThan(1.23);
  expect(minY).toBeCloseTo(0, 6); // the lower crate rests on the ground
});
