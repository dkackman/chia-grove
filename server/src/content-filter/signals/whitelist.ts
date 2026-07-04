/** One curated allow-list entry, keyed by (creator DID, collection id). */
export interface WhitelistEntry {
  creatorDid: string;
  collectionId: string;
  note?: string;
}

/**
 * Curated allow-list of known-safe collections. Ships empty; populated via PR.
 * A match never overrides a negative cheap-signal result (lexicon, denylist,
 * sensitive_content, MintGarden moderation) — see mapMintgardenSignals. Its
 * only effect is to skip the Google Vision SafeSearch check for a collection
 * whose cheap verdict is already "ok", saving Vision calls on large,
 * well-known, unambiguously safe mints.
 */
export const WHITELIST: WhitelistEntry[] = [];

/** Composite key: collection ids are unique on MintGarden, but keying on the
 *  creator DID too guards against acting on a bare collection id alone. */
function key(creatorDid: string, collectionId: string): string {
  return `${creatorDid}::${collectionId}`;
}

/** Index entries into a Set of composite keys for O(1) lookup. */
export function buildWhitelistSet(entries: WhitelistEntry[]): Set<string> {
  const set = new Set<string>();
  for (const entry of entries) set.add(key(entry.creatorDid, entry.collectionId));
  return set;
}

export const WHITELIST_SET: Set<string> = buildWhitelistSet(WHITELIST);

/** True when both the creator DID and collection id are present and match a
 *  whitelist entry together. */
export function isWhitelisted(
  set: Set<string>,
  creatorDid: string | undefined,
  collectionId: string | undefined
): boolean {
  if (creatorDid === undefined || collectionId === undefined) return false;
  return set.has(key(creatorDid, collectionId));
}
