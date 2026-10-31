/**
 * `?height=` deep link: the URL mirrors the block the view is pinned to, and a
 * link opened later travels to that block once the replay delivers it (only
 * the ~MAX_BLOCKS most recent blocks are retained, so an older link is
 * dropped).
 */

/** Reads the `height` param from a URL search string, or null if absent/invalid. Pure. */
export function readHeightParam(search: string): number | null {
  const raw = new URLSearchParams(search).get("height");
  if (raw === null || raw === "") return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

/** `href` with `height` set (or removed for null), other params preserved. Pure. */
export function withHeightParam(href: string, height: number | null): string {
  const url = new URL(href);
  if (height === null) url.searchParams.delete("height");
  else url.searchParams.set("height", String(height));
  return url.toString();
}

/**
 * Reflects the pinned height in the URL with `history.replaceState` (so
 * scrubbing never floods the back stack), throttled because browsers rate-limit
 * replaceState; the latest value always lands on a later call.
 */
export class HeightUrl {
  private written: number | null;
  private lastWrite = -Infinity;

  constructor(initial: number | null) {
    this.written = initial;
  }

  update(height: number | null, nowMs: number): void {
    if (height === this.written || nowMs - this.lastWrite < 300) return;
    this.written = height;
    this.lastWrite = nowMs;
    history.replaceState(history.state, "", withHeightParam(location.href, height));
  }
}
