import { mulberry32, type XZ } from "../shared/util.js";

export const FIELD = {
  rows: 48,
  rowLength: 44, // x extent
  rowSpacing: 0.85, // z gap between rows
  plantSpacing: 0.38,
} as const;

export const ROW_CAPACITY = Math.floor(FIELD.rowLength / FIELD.plantSpacing);

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
 * wrap back along it (crowded rows read as dense blocks). Jitter is seeded
 * from the coin id so replayed snapshots place crops identically.
 */
export function plantPosition(row: number, indexInRow: number, coinIdHex: string): XZ {
  const rand = mulberry32(parseInt(coinIdHex.slice(0, 8), 16));
  const along = (indexInRow % ROW_CAPACITY) * FIELD.plantSpacing;
  const x = rowDirection(row) * (-FIELD.rowLength / 2 + along) + (rand() - 0.5) * 0.22;
  const z = rowZ(row) + (rand() - 0.5) * 0.3;
  return { x, z };
}
