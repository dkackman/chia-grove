import { expect, test } from "vitest";
import {
  farTreeLineGeometry,
  hedgeGeometry,
  hedgerowPlacements,
} from "../src/themes/farm/scenery.js";
import { groundHeight, hillHeight } from "../src/themes/farm/terrain.js";
import { TURF_RADIUS } from "../src/themes/farm/layout.js";

// mergeGeometries returns null when its inputs mix indexed and non-indexed
// geometry; a null geometry crashes the renderer on the first frame.
test.each([
  ["hedge shrub", hedgeGeometry],
  ["far tree line", farTreeLineGeometry],
])("the %s geometry is valid and renderable", (_name, factory) => {
  const geometry = factory();
  expect(geometry).not.toBeNull();
  expect(geometry.getAttribute("position").count).toBeGreaterThan(0);
});

// The far tree line is scenery on the horizon: off the turf disc it floats over
// open sky, and on the disc it must sit on the ground rather than through it.
test("the far tree line stands on the turf, on the ground", () => {
  const pos = farTreeLineGeometry().getAttribute("position");
  let lowest = Infinity;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    expect(Math.hypot(x, z)).toBeLessThan(TURF_RADIUS);
    lowest = Math.min(lowest, pos.getY(i) - groundHeight(x, z));
  }
  // the lowest vertex of the whole line rests on, not below, the ground under it
  expect(lowest).toBeGreaterThanOrEqual(-0.01);
});

/**
 * FIX 1: the hills (terrain.ts) are opaque, front-face-culled domes; a vertex
 * with y below hillHeight(x, z) at its own (x, z) is inside one and will never
 * render. hillHeight is exactly 0 everywhere outside every dome's footprint —
 * not "close to 0" — so a real bury shows up as many centimetres to metres of
 * negative margin, never a sliver; BURY_TOLERANCE only absorbs the sub-
 * centimetre vertical noise some base geometries carry at their nominal scale
 * (e.g. a hedge shrub's blobs settle a hair below y = 0), mirroring the
 * production isBuried() check in scenery.ts.
 *
 * The previous version of this suite only had "the far tree line stands on
 * the turf, on the ground" above, which passed at 100% while 92% of the line
 * (69 of 75 crowns, all three bands sitting 15-27 units inside a hill's
 * footprint) was actually invisible — it checked the flat turf, never the
 * hills. These two are the regression test for that: they fail if a future
 * re-tune buries the line in a hill again, even though the ground check alone
 * would stay green.
 */
const BURY_TOLERANCE = 0.05;

/** The worst (most negative) margin by which any vertex of `geo` dips below a
 *  hill's dome surface at that vertex's own (x, z); 0 if nothing is even
 *  inside a footprint. Positive/zero means nothing is buried. */
function worstBuryMargin(geo: ReturnType<typeof farTreeLineGeometry>): number {
  const pos = geo.getAttribute("position");
  let worst = 0;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const hh = hillHeight(x, z);
    if (hh <= 0) continue; // outside every dome's footprint entirely
    worst = Math.min(worst, pos.getY(i) - hh);
  }
  return worst;
}

test("no far-tree crown stands inside a hill's opaque dome", () => {
  expect(worstBuryMargin(farTreeLineGeometry())).toBeGreaterThan(-BURY_TOLERANCE);
});

test("the far tree line still produces a substantial number of crowns", () => {
  // each IcosahedronGeometry(r, 0) crown merges to 60 non-indexed vertices
  // (20 faces * 3 verts); a filter (or a future re-tune) that silently guts
  // the whole feature — as the buried bands effectively did before this fix —
  // must fail loudly here, not just look sparse on screen.
  const crowns = farTreeLineGeometry().getAttribute("position").count / 60;
  expect(crowns).toBeGreaterThan(50);
});

test("no hedgerow shrub stands inside a hill's opaque dome", () => {
  const base = hedgeGeometry();
  const placements = hedgerowPlacements();
  expect(placements.length).toBeGreaterThan(200); // the filter didn't gut the hedgerows either
  for (const { x, z, s, sy, yaw } of placements) {
    const shrub = base.clone();
    shrub.scale(s, sy, s);
    shrub.rotateY(yaw);
    shrub.translate(x, groundHeight(x, z), z);
    expect(worstBuryMargin(shrub), `shrub at (${x}, ${z})`).toBeGreaterThan(-BURY_TOLERANCE);
  }
});

test("hedgerowPlacements is deterministic", () => {
  expect(hedgerowPlacements()).toEqual(hedgerowPlacements());
});
