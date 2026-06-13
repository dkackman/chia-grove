/** Horizontal-flick thresholds separating a discrete "browse" swipe from a slow pan. */
export const SWIPE_DIST = 35; // px of horizontal travel required
export const SWIPE_TIME = 0.4; // seconds; longer than this is a deliberate pan, not a flick

/**
 * Classify a finished pointer gesture into a discrete column-jump direction.
 * Returns -1 (swipe right → older pieces), +1 (swipe left → newer pieces),
 * or 0 (not a swipe — caller keeps the existing freeform-pan result).
 *
 * The sign matches the arrow keys (ArrowLeft = -1) and the drag grab metaphor:
 * pulling the wall to the right reveals older pieces.
 */
export function classifySwipe(dx: number, dy: number, dt: number): -1 | 0 | 1 {
  if (Math.abs(dx) < SWIPE_DIST) return 0;
  if (Math.abs(dx) <= Math.abs(dy)) return 0; // must be horizontal-dominant
  if (dt > SWIPE_TIME) return 0;
  return dx > 0 ? -1 : 1;
}
