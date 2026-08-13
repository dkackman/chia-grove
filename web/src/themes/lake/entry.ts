/**
 * The arrival envelope. A confirmed spend resolves out of the descending
 * pending layer rather than blinking into existence at full size, so it grows
 * from nothing while settling down the last few units into its band.
 *
 * Both functions are pure functions of age in seconds, so replay is safe: a
 * snapshot plants hundreds of sprouts across a handful of frames and every one
 * of them animating in is correct — they genuinely are arriving.
 *
 * The envelope is scale-only. The spec's "fading in" was dropped deliberately:
 * per-instance opacity on an InstancedMesh means a custom attribute threaded
 * through every creature shader, and a creature growing from zero scale
 * already cannot pop — the fade would buy nothing visible for the cost.
 */
export const ENTRY_SECONDS = 0.8;
/** How far above its band a creature starts. */
const ENTRY_RISE = 2.4;

/** Age (seconds) → 0..1 size multiplier. Smoothstep, so there is no pop. */
export function entryScale(age: number): number {
  if (!(age > 0)) return 0;
  if (age >= ENTRY_SECONDS) return 1;
  const p = age / ENTRY_SECONDS;
  return p * p * (3 - 2 * p);
}

/** Age (seconds) → how far above its band the creature still is. */
export function entryDrop(age: number): number {
  if (!(age > 0)) return ENTRY_RISE;
  if (age >= ENTRY_SECONDS) return 0;
  return ENTRY_RISE * (1 - entryScale(age));
}

/**
 * The departure envelope, in blocks rather than seconds.
 *
 * `bandDepth` clamps at MAX_BANDS, so without this every creature older than
 * the column piles up at one Y and stays there. The lake used to hide that
 * behind a literal bed; with the bed gone the pile *is* the floor, and a floor
 * made of stacked fish is worse than the one made of silt. Fading them out
 * before the clamp is what lets the column dissolve into the dark instead of
 * ending on a shelf.
 *
 * Fading starts before the clamp on purpose: a creature that vanished exactly
 * at MAX_BANDS would blink out at a plane the eye can find. Spread over four
 * bands, individuals disappear at visibly different depths and the boundary
 * stops being a boundary.
 */
export const FADE_START_BANDS = 12;
export const FADE_END_BANDS = 16;

/** Band age → 0..1 size multiplier as a creature sinks out of sight. */
export function depthFade(age: number): number {
  if (!(age > FADE_START_BANDS)) return 1;
  if (age >= FADE_END_BANDS) return 0;
  const p = 1 - (age - FADE_START_BANDS) / (FADE_END_BANDS - FADE_START_BANDS);
  return p * p * (3 - 2 * p);
}
