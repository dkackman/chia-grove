import { mulberry32 } from "../shared/util.js";

export const WALL = {
  step: 4.2, // x distance between consecutive pieces
  z: -3, // wall plane z (pieces face +z toward the camera)
  bandHigh: 3.6, // y center of the upper salon band
  bandLow: 1.7, // y center of the lower salon band
  yJitter: 0.45, // per-piece vertical wobble
  baseLong: 2.4, // base length of a frame's long edge
  longJitter: 0.7, // +/- variation on the long edge
  minW: 1.4,
  maxW: 3.4,
};

export interface Slot {
  x: number;
  y: number;
  z: number;
}

/** Deterministic salon position for the piece at `index` (advances rightward). */
export function hangSlot(index: number): Slot {
  const rng = mulberry32((index * 2654435761) >>> 0);
  const band = index % 2 === 0 ? WALL.bandHigh : WALL.bandLow;
  return { x: index * WALL.step, y: band + (rng() - 0.5) * WALL.yJitter, z: WALL.z };
}

/** Frame width/height for a piece, fitting `aspect` (= imageW/imageH) within bounds. */
export function frameSize(index: number, aspect: number): { w: number; h: number } {
  const rng = mulberry32((index * 40503 + 7) >>> 0);
  const long = Math.max(
    WALL.minW,
    Math.min(WALL.maxW, WALL.baseLong + (rng() - 0.5) * 2 * WALL.longJitter)
  );
  return aspect >= 1 ? { w: long, h: long / aspect } : { w: long * aspect, h: long };
}
