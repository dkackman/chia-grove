import { fitDistance } from "../shared/fit.js";
import { MAX_BANDS, RIM_RADIUS, PENDING_Y_MAX, bandDepth } from "./layout.js";

/**
 * Narrower than the 84° the lake shipped with. The wide FOV existed so a camera
 * parked at the column midpoint caught both the surface and the bed at once;
 * with eighteen thicker bands and adaptive framing it no longer has to, and 84°
 * was costing heavy edge distortion on every creature.
 */
export const LAKE_FOV = 55;

/** Slower than the 0.02 rad/s the lake shipped with: ~8.7 min per revolution. */
export const ORBIT_RATE = 0.012;

/** Never inside the rim rings — the camera would clip straight through them. */
const MIN_DISTANCE = RIM_RADIUS + 8;

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
  const filled = Number.isFinite(bandCount)
    ? Math.max(0, Math.min(MAX_BANDS, Math.floor(bandCount)))
    : 0;
  const top = PENDING_Y_MAX;
  const bottom = bandDepth(filled);
  const contentH = top - bottom;
  const contentW = RIM_RADIUS * 2;
  const distance = Math.max(MIN_DISTANCE, fitDistance(contentW, contentH, vFovDeg, aspect));
  return { distance, centerY: (top + bottom) / 2 };
}
