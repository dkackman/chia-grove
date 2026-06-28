import type { Disposition, SignalName, Verdict } from "./types.js";

const RANK: Record<Disposition, number> = { ok: 0, sensitive: 1, blocked: 2 };

/** Strongest disposition under `blocked > sensitive > ok`. */
export const strongest = (...ds: Disposition[]): Disposition =>
  ds.reduce((a, b) => (RANK[b] > RANK[a] ? b : a), "ok");

/** Collapse per-signal dispositions into a combined verdict + the names that fired. */
export function combine(parts: Array<{ disposition: Disposition; signal: SignalName }>): Verdict {
  const disposition = strongest(...parts.map((p) => p.disposition));
  const signals = parts.filter((p) => p.disposition !== "ok").map((p) => p.signal);
  return { disposition, signals };
}
