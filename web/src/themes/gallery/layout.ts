import { mulberry32 } from "../shared/util.js";

export const WALL = {
  rows: 3, // pieces stack into columns of this many, then a new column to the right
  colStep: 3.0, // x distance between columns
  rowGap: 2.5, // y distance between rows
  rowBase: 1.7, // y center of the bottom row
  z: -3, // wall plane z (pieces face +z toward the camera)
  xJitter: 0.35, // per-piece horizontal wobble (kept < gaps so frames don't collide)
  yJitter: 0.3, // per-piece vertical wobble
  baseLong: 1.9, // base length of a frame's long edge
  longJitter: 0.5, // +/- variation on the long edge
  minW: 1.1,
  maxW: 2.3,
};

export interface Slot {
  x: number;
  y: number;
  z: number;
}

/**
 * Deterministic salon-grid position for the piece at `index`: pieces fill a
 * column top-to-bottom (WALL.rows tall), then start a new column to the right.
 */
export function hangSlot(index: number): Slot {
  const rng = mulberry32((index * 2654435761) >>> 0);
  const col = Math.floor(index / WALL.rows);
  const row = index % WALL.rows;
  return {
    x: col * WALL.colStep + (rng() - 0.5) * WALL.xJitter,
    y: WALL.rowBase + row * WALL.rowGap + (rng() - 0.5) * WALL.yJitter,
    z: WALL.z,
  };
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
