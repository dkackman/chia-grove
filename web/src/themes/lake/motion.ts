import type { Seat } from "./layout.js";
import { BAND_RADIUS_MIN, BAND_RADIUS_MAX } from "./layout.js";

const WANDER_RADIUS = 0.9;
const WANDER_SWAY = 0.18;
const SWAY_RATE = 0.63; // sway runs slower than the radial wander so paths never loop

/**
 * Skew of the jelly pulse wave. The GLSL in jellies.ts repeats this constant —
 * keep the two identical or the bell contraction and the vertical coast drift
 * out of sync.
 */
export const PULSE_SKEW = 0.65;

/** Circuit radius with a slow deterministic breathing, clamped to the column. */
export function wanderedRadius(seat: Seat, t: number): number {
  const r = seat.radius + Math.sin(t * seat.wanderRate + seat.wanderPhase) * WANDER_RADIUS;
  return Math.max(BAND_RADIUS_MIN - 2, Math.min(BAND_RADIUS_MAX + 2, r));
}

/** Circuit angle: steady advance plus a heading sway. */
export function wanderedAngle(seat: Seat, t: number): number {
  return (
    seat.angle +
    t * seat.speed +
    Math.sin(t * seat.wanderRate * SWAY_RATE + seat.wanderPhase * 1.7) * WANDER_SWAY
  );
}

/**
 * Roll into the turn, proportional to how fast the heading is changing —
 * the analytic d/dt of wanderedAngle, so it needs no per-frame state.
 */
export function bankRoll(seat: Seat, t: number): number {
  const swayRate = seat.wanderRate * SWAY_RATE;
  const headingRate =
    seat.speed + Math.cos(t * swayRate + seat.wanderPhase * 1.7) * WANDER_SWAY * swayRate;
  return Math.max(-0.5, Math.min(0.5, headingRate * 3.5));
}

export interface Stroke {
  /** flipper sweep angle (radians), symmetric around the rest pose */
  sweep: number;
  /** speed multiplier: >1 during the power stroke, <1 while gliding; never 0 */
  surge: number;
  /** body pitch (radians): slight nose-up during the glide */
  pitch: number;
}

/** One paddle cycle: power stroke → surge, recovery → glide. p in radians. */
export function turtleStroke(p: number): Stroke {
  const push = Math.max(0, Math.sin(p - 0.7)); // thrust trails the sweep slightly
  return {
    sweep: Math.sin(p) * 0.9,
    surge: 0.35 + 1.5 * push * push,
    pitch: 0.08 - 0.12 * push,
  };
}

/**
 * Asymmetric pulse: sin(p + k·sin(p)) rises steeply and relaxes slowly — the
 * medusa beat. `lift` drives the vertical coast (rise on contraction, slow
 * sink after); `squeeze` is the 0..1 contraction envelope for the bell.
 */
export function jellyPulse(p: number): { squeeze: number; lift: number } {
  const w = Math.sin(p + PULSE_SKEW * Math.sin(p));
  return { squeeze: Math.max(0, w), lift: w };
}
