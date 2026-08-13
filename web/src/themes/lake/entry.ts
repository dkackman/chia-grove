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
