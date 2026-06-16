export interface FrameLimiter {
  /** True when enough wall-clock time has passed to draw this tick. */
  shouldRender(nowMs: number): boolean;
}

/**
 * Caps a requestAnimationFrame loop to a target rate. On high-refresh displays
 * (120 Hz ProMotion) the browser fires rAF far more often than an ambient scene
 * needs; gating to 60 halves the draw + bloom passes without touching visuals.
 *
 * It carries the sub-interval remainder so the long-run average lands on the
 * target on displays where the refresh isn't an integer multiple of it (a naive
 * `last = now` drifts low), and resyncs after a long pause (backgrounded tab)
 * instead of bursting catch-up frames.
 */
export function createFrameLimiter(fps = 60): FrameLimiter {
  const interval = 1000 / fps;
  let last: number | null = null;
  return {
    shouldRender(nowMs: number): boolean {
      if (last === null) {
        last = nowMs;
        return true;
      }
      if (nowMs - last >= interval) {
        last += interval;
        if (nowMs - last >= interval) last = nowMs; // fell >1 frame behind → resync
        return true;
      }
      return false;
    },
  };
}
