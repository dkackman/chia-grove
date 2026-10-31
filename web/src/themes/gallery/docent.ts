/**
 * The quiet-gallery "docent" tour (DOM-free, unit-tested): after a few minutes
 * with no new pieces and no user input, the camera strolls slowly back along
 * the wall through the older pieces, lingers at the far end, then hands control
 * back to auto-follow, which eases home to the newest column.
 */
export const DOCENT_QUIET_S = 180; // quiet this long before a tour starts
export const DOCENT_SPEED = 0.5; // world units per second along the wall
export const DOCENT_MIN_S = 10; // shortest stroll, so a short wall isn't a lurch
export const DOCENT_DWELL_S = 8; // linger at the oldest piece before returning

export interface DocentTour {
  fromX: number;
  toX: number;
  startedAt: number;
}

/** Whether to start a tour: the room has been quiet long enough and there is wall to walk. */
export function shouldStartDocent(
  now: number,
  lastActivity: number,
  fromX: number,
  toX: number
): boolean {
  return now - lastActivity >= DOCENT_QUIET_S && fromX - toX > 1;
}

/**
 * The tour's camera x at `now`, or null once it is over (the caller then
 * releases manual control). An eased stroll from fromX to toX, then a dwell.
 */
export function docentX(tour: DocentTour, now: number): number | null {
  const elapsed = now - tour.startedAt;
  if (elapsed < 0) return tour.fromX;
  const travel = Math.max(DOCENT_MIN_S, Math.abs(tour.fromX - tour.toX) / DOCENT_SPEED);
  if (elapsed >= travel + DOCENT_DWELL_S) return null;
  const k = Math.min(1, elapsed / travel);
  const eased = k * k * (3 - 2 * k);
  return tour.fromX + (tour.toX - tour.fromX) * eased;
}
