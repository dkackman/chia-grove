import { mulberry32, type XZ } from "../shared/util.js";

export const FIELD = {
  rows: 48,
  rowLength: 44, // x extent
  rowSpacing: 0.85, // z gap between rows
  plantSpacing: 0.38,
} as const;

export const ROW_CAPACITY = Math.floor(FIELD.rowLength / FIELD.plantSpacing);

/** Width of a soil strip across the row. Nearly the full row pitch, so plowed
 *  rows read as one worked field with a dark furrow between beds. */
export const STRIP_WIDTH = FIELD.rowSpacing * 0.94;

/** Cross-row offset (fraction of STRIP_WIDTH) for each lap of an overflowing
 *  row: the first lap runs down the bed's centre line, later laps alternate
 *  either side of it so a busy block fills the bed instead of stacking. */
const LAP_Z = [0, 0.25, -0.25, 0.125, -0.125, 0.3, -0.3] as const;

/** Where the `lap`-th pass along an overflowing row sits: a z offset across
 *  the bed and a half-spacing x stagger on odd laps. Exported for testing. */
export function lapOffset(lap: number): { dx: number; dz: number } {
  return {
    dx: lap % 2 === 1 ? FIELD.plantSpacing / 2 : 0,
    dz: LAP_Z[lap % LAP_Z.length] * STRIP_WIDTH,
  };
}

/** Rows centered on z=0; row 0 nearest the camera (+z), later rows toward the barn (−z). */
export function rowZ(row: number): number {
  return ((FIELD.rows - 1) / 2) * FIELD.rowSpacing - row * FIELD.rowSpacing;
}

/** Serpentine: even rows plant left→right (+1), odd rows right→left (−1). */
export function rowDirection(row: number): 1 | -1 {
  return row % 2 === 0 ? 1 : -1;
}

/**
 * Where the i-th spend of a block lands. Busy blocks overflow the row and
 * wrap back along it in further laps, each offset across the bed (crowded rows
 * read as dense blocks, without crops stacking on one another). Jitter is seeded
 * from the coin id so replayed snapshots place crops identically.
 */
export function plantPosition(row: number, indexInRow: number, coinIdHex: string): XZ {
  const rand = mulberry32(parseInt(coinIdHex.slice(0, 8), 16));
  const lap = lapOffset(Math.floor(indexInRow / ROW_CAPACITY));
  const along = (indexInRow % ROW_CAPACITY) * FIELD.plantSpacing + lap.dx;
  const x = rowDirection(row) * (-FIELD.rowLength / 2 + along) + (rand() - 0.5) * 0.22;
  const z = rowZ(row) + lap.dz + (rand() - 0.5) * 0.3;
  return { x, z };
}

/** Radius of the turf disc. Past this, a prop floats over open sky. It lives here
 *  rather than in terrain.ts so that terrain.ts and landscape.ts — which both need
 *  it — do not have to import each other. */
export const TURF_RADIUS = 140;
