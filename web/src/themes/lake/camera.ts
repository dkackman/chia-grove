import { fitDistance } from "../shared/fit.js";
import { RIM_RADIUS, PENDING_Y_MAX, bandDepth } from "./layout.js";
import { FADE_END_BANDS } from "./entry.js";

/**
 * Narrower than the 84° the lake shipped with. The wide FOV existed so a camera
 * parked at the column midpoint caught both the surface and the column floor
 * at once; with eighteen thicker bands and adaptive framing it no longer has to, and 84°
 * was costing heavy edge distortion on every creature.
 */
export const LAKE_FOV = 55;

/** Slower than the 0.02 rad/s the lake shipped with: ~8.7 min per revolution. */
export const ORBIT_RATE = 0.012;

/** Never inside the rim rings — the camera would clip straight through them. */
const MIN_DISTANCE = RIM_RADIUS + 8;

/**
 * Hard ceiling on the framing distance. Fitting the full column at 16:9 needs
 * ~86, so the cap never binds on a landscape viewport; it exists for narrow
 * portrait aspects, where the width fit would otherwise push the camera
 * arbitrarily far and the column's edges may as well crop instead. It is also
 * the bound `water.ts` parks the god-ray cones beyond, so nothing can drift
 * between the camera and the column — `lake-layout.test.ts` pins that
 * relation.
 */
export const MAX_FRAME_DISTANCE = 92;

/**
 * Where the camera should stand to frame everything that currently exists:
 * the churn layer at the top down to the deepest occupied band. An empty lake
 * frames the shallows; a full one pulls back to the whole column. This is the
 * lever `mine.ts` pulls when it eases `camDist` toward the spiral's extent.
 *
 * Pure, and deliberately takes no clock. The theme communicates through
 * vertical position — the whole lake glides down one band per block — so a
 * camera that also moved vertically over time would cancel the one cue the
 * theme is built on. The shipped camera did exactly that with a ±2.2-unit,
 * 125-second sine; it is gone, and this signature is what keeps it gone.
 */
export function frameTarget(
  bandCount: number,
  vFovDeg: number,
  aspect: number
): { distance: number; centerY: number } {
  // Frame the depth things are still VISIBLE at, not the depth they stop
  // sinking at. `depthFade` shrinks creatures away by FADE_END_BANDS, so the
  // bands below that hold nothing worth keeping in shot — framing them anyway
  // just pushes the camera back and makes everything smaller for no gain.
  const filled = Number.isFinite(bandCount)
    ? Math.max(0, Math.min(FADE_END_BANDS, Math.floor(bandCount)))
    : 0;
  const top = PENDING_Y_MAX;
  const bottom = bandDepth(filled);
  const contentH = top - bottom;
  const contentW = RIM_RADIUS * 2;
  // fitDistance frames a centered flat plane, but the lake is a cylinder of
  // radius RIM_RADIUS: the fit answers for the column's NEAR face, while the
  // camera orbits the axis one radius further back. Without the added radius
  // the nearest ring arc ends up just a few units from the lens and the scene
  // reads as standing inside a barrel of hoops.
  // margin 1.0 rather than fitDistance's default 1.06: the column's bottom
  // dissolves into fog rather than ending on an edge, so there is nothing down
  // there that needs breathing room around it.
  const fit = fitDistance(contentW, contentH, vFovDeg, aspect, 1.0) + RIM_RADIUS;
  const distance = Math.min(MAX_FRAME_DISTANCE, Math.max(MIN_DISTANCE, fit));
  return { distance, centerY: (top + bottom) / 2 };
}
