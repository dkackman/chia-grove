import type { Disposition, Verdict } from "./types.js";

const RANK: Record<Disposition, number> = { ok: 0, sensitive: 1, blocked: 2 };

/** Strongest disposition under `blocked > sensitive > ok`. */
export const strongest = (...ds: Disposition[]): Disposition =>
  ds.reduce((a, b) => (RANK[b] > RANK[a] ? b : a), "ok");

/** Collapse per-signal dispositions into a combined verdict, keeping the name
 *  of whichever signal produced the winning disposition (first contributor
 *  wins a tie, i.e. the signal order in mapMintgardenSignals is priority order). */
export function combine(parts: Array<{ disposition: Disposition; signal?: string }>): Verdict {
  const disposition = strongest(...parts.map((p) => p.disposition));
  const signal = parts.find((p) => p.disposition === disposition)?.signal;
  return signal === undefined ? { disposition } : { disposition, signal };
}
