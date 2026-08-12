/** A `▮`/`·` fill bar `width` chars wide. Pure. */
export function mempoolGauge(size: number, width: number, full = 5000): string {
  const raw = Math.round(Math.min(1, size / full) * width);
  const filled = Number.isFinite(raw) ? Math.max(0, Math.min(width, raw)) : 0;
  return "▮".repeat(filled) + "·".repeat(width - filled);
}

/** Pretty-print a netspace byte count (string) as e.g. "38.2 EIB". */
export function netspaceText(bytes: string): string {
  const units = ["B", "KIB", "MIB", "GIB", "TIB", "PIB", "EIB"];
  let v = Number(bytes);
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v.toFixed(1)} ${units[u]}`;
}
