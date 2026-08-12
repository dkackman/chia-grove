import { mulberry32 } from "../shared/util.js";

/**
 * Depth strata. One band per block: the newest sits just under the surface and
 * every older band is one step deeper, so history reads as depth.
 *
 * MAX_BANDS is 40 rather than the 200 block slots `mine` uses because this is a
 * clamp depth, not a slot ring — it has to be a column a submerged camera can
 * actually frame. At 1.5 units a band, 40 bands is a 60-unit descent (~12
 * minutes of chain at 18.75 s blocks); 200 would be a 300-unit shaft with most
 * of its history out of sight.
 */
export const MAX_BANDS = 40;
export const BAND_STEP = 1.5;
export const TOP_BAND_Y = -3;
export const BED_Y = TOP_BAND_Y - MAX_BANDS * BAND_STEP;

export const BAND_RADIUS_MIN = 6;
export const BAND_RADIUS_MAX = 26;

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
