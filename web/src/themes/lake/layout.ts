import { mulberry32 } from "../shared/util.js";

/**
 * Depth strata. One band per block: the newest sits below the churn layer and
 * every older band is one step deeper, so history reads as depth.
 *
 * MAX_BANDS is 18 rather than the 40 the theme shipped with. Forty 1.5-unit
 * bands were indistinguishable at any framing that fit the column, so the one
 * cue the theme is built on could not be seen. Eighteen 2.6-unit bands keep
 * roughly the same column height (46.8 units) while being countable, at the
 * cost of history depth: ~5.5 minutes of chain at 18.75 s blocks rather than
 * ~12. That trade is deliberate — see the legibility design spec.
 */
export const MAX_BANDS = 18;
export const BAND_STEP = 2.6;

/**
 * The top band hangs well below the surface (0) to leave y in
 * [PENDING_Y_MIN, PENDING_Y_MAX] for the mempool churn layer, so pending
 * silhouettes visibly cross into the newest band when a block confirms.
 */
export const TOP_BAND_Y = -12;
export const PENDING_Y_MIN = -9;
export const PENDING_Y_MAX = -2;

export const BED_Y = TOP_BAND_Y - MAX_BANDS * BAND_STEP;

export const BAND_RADIUS_MIN = 6;
export const BAND_RADIUS_MAX = 26;

/**
 * Where the per-band rim rings sit: outside the creature annulus so they never
 * intersect a fish, and inside the god-ray cones (parked at 42–66) so the
 * camera has somewhere to stand between the two.
 */
export const RIM_RADIUS = 28;

/**
 * Y of a band `age` blocks old, clamped at both ends. Objects older than
 * MAX_BANDS keep rendering at the bed until their pool slot is recycled.
 */
export function bandDepth(age: number): number {
  const clamped = Math.max(0, Math.min(MAX_BANDS, age));
  return TOP_BAND_Y - clamped * BAND_STEP;
}

/**
 * Exponential ease of the smooth block counter toward the integer target, so
 * the whole lake glides down a band on each block instead of snapping 1.5
 * units. Rate 2.2/s closes ~97% of a one-band step in ~1.6 s. Snaps exactly
 * onto the target below 1e-3 so a settled lake stops writing new depths.
 */
export function easeBlocks(current: number, target: number, dt: number): number {
  const next = current + (target - current) * (1 - Math.exp(-dt * 2.2));
  return Math.abs(target - next) < 1e-3 ? target : next;
}

/** A spend's swim circuit within its band: where it loops and how fast. */
export interface Seat {
  radius: number;
  angle: number;
  bob: number;
  speed: number;
  /** phase/rate of the slow path wander that keeps circuits from being perfect circles */
  wanderPhase: number;
  wanderRate: number;
}

/**
 * Deterministic circuit derived from the coin id, the same way
 * `grove/layout.ts` derives its scatter. Determinism matters because the
 * WebSocket snapshot replays on every theme switch and reconnect — a seeded
 * seat rebuilds the same lake instead of reshuffling it.
 *
 * sqrt on the radius draw spreads fish evenly over the annulus rather than
 * bunching them at the inner edge.
 */
export function seatOffset(coinIdHex: string): Seat {
  const rand = mulberry32(parseInt(coinIdHex.slice(0, 8), 16));
  return {
    radius: BAND_RADIUS_MIN + Math.sqrt(rand()) * (BAND_RADIUS_MAX - BAND_RADIUS_MIN),
    angle: rand() * Math.PI * 2,
    bob: rand() * Math.PI * 2,
    speed: 0.05 + rand() * 0.09,
    wanderPhase: rand() * Math.PI * 2,
    wanderRate: 0.1 + rand() * 0.25,
  };
}
