/** Reads the `block` height from a URL search string, or null if absent/invalid. Pure. */
export function readBlockParam(search: string): number | null {
  const raw = new URLSearchParams(search).get("block");
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

/** Reflects (or clears) the detail-mode block height in the URL, preserving other params. */
export function writeBlockParam(height: number | null): void {
  const url = new URL(location.href);
  if (height === null) url.searchParams.delete("block");
  else url.searchParams.set("block", String(height));
  history.pushState(null, "", url.toString());
}
