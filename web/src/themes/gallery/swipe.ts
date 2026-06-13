const SMOOTHING = 0.4; // weight of the newest sample in the velocity EMA
const GLIDE_FACTOR = 0.18; // seconds of travel projected from the release velocity
const STALE_MS = 80; // a release this long after the last move carries no momentum

/**
 * Turns a drag's movement samples into a momentum "glide" offset on release.
 *
 * Feed it the per-move world-space displacement (same units as the pan target)
 * with the event timestamp; it keeps an exponentially-smoothed velocity. On
 * release it projects how far the pan should coast — the caller adds that offset
 * to the pan target and lets the camera's existing lerp decelerate into it.
 *
 * A gesture that ends with the finger held still (no recent sample) releases
 * zero, so a deliberate stop doesn't fling.
 */
export class FlingTracker {
  private velocity = 0; // world units per second
  private lastMs = 0;

  reset(nowMs: number): void {
    this.velocity = 0;
    this.lastMs = nowMs;
  }

  /** dx is the world-space displacement applied to the pan target this sample. */
  sample(dx: number, nowMs: number): void {
    const dt = nowMs - this.lastMs;
    this.lastMs = nowMs;
    if (dt <= 0) return;
    const instant = (dx / dt) * 1000; // world units per second
    this.velocity = this.velocity * (1 - SMOOTHING) + instant * SMOOTHING;
  }

  /** Glide offset to add to the pan target; 0 if the gesture stalled before lifting. */
  release(nowMs: number): number {
    if (nowMs - this.lastMs > STALE_MS) return 0;
    return this.velocity * GLIDE_FACTOR;
  }
}
