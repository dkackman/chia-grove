import type { Disposition } from "./content-filter.js";

/** One curated denylist entry, keyed by MintGarden collection id. */
export interface DenylistEntry {
  collectionId: string;
  disposition: "blocked" | "sensitive";
  note?: string;
}

/**
 * Curated collection denylist. Ships empty; populated via PR. Each entry carries
 * its own disposition so a takedown-worthy collection can be `blocked` while a
 * merely-NSFW one is `sensitive` (blur).
 */
export const DENYLIST: DenylistEntry[] = [];

/** Index entries by collection id for O(1) lookup. Later entries win on dup ids. */
export function buildDenylistMap(entries: DenylistEntry[]): Map<string, Disposition> {
  const map = new Map<string, Disposition>();
  for (const entry of entries) map.set(entry.collectionId, entry.disposition);
  return map;
}

export const DENYLIST_MAP: Map<string, Disposition> = buildDenylistMap(DENYLIST);

/** Disposition for a collection id, or undefined if absent / id missing. */
export function dispositionForCollection(
  map: Map<string, Disposition>,
  collectionId: string | undefined
): Disposition | undefined {
  return collectionId === undefined ? undefined : map.get(collectionId);
}
