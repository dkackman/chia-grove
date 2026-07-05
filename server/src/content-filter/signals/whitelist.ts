/** One curated allow-list entry. Identify a known-safe collection by its
 *  collection id, its creator DID, or both — a match on *either* is enough.
 *  (MintGarden collection ids are globally unique — hashed from the creator
 *  DID — so a bare collection id is unambiguous; the creator DID form lets a
 *  trusted minter be cleared across all of its collections at once.) */
export interface WhitelistEntry {
  creatorDid?: string;
  collectionId?: string;
  note?: string;
}

/**
 * Curated allow-list of known-safe collections/creators. A match never
 * overrides a negative cheap-signal result (lexicon, denylist,
 * sensitive_content, MintGarden moderation) — see mapMintgardenSignals. Its
 * only effect is to skip the Google Vision SafeSearch check for an NFT whose
 * cheap verdict is already "ok", saving Vision calls on large, well-known,
 * unambiguously safe mints.
 */
export const WHITELIST: WhitelistEntry[] = [
  { collectionId: "col1s8fwfqdl3x77h7rn40m0mzhkgp7kajdwu56me36glv0ez8w79heqst90mh" },
  { collectionId: "col1apvkk4tz48l9qfj5znygzrugfhzjmfu8lykalvzeqn6au38g7mcs4gwxx6" },
  { collectionId: "col1ufu33cchmfgge9hm9ehupy3thux66ehaum9gglqewldzkus4s3mq9yc289" },
];

/** Index entries into a Set of raw identifiers (creator DIDs and collection ids
 *  mixed — their prefixes, `did:` vs `col1`, guarantee they never collide) for
 *  O(1) OR lookup. */
export function buildWhitelistSet(entries: WhitelistEntry[]): Set<string> {
  const set = new Set<string>();
  for (const entry of entries) {
    if (entry.creatorDid !== undefined) set.add(entry.creatorDid);
    if (entry.collectionId !== undefined) set.add(entry.collectionId);
  }
  return set;
}

export const WHITELIST_SET: Set<string> = buildWhitelistSet(WHITELIST);

/** True when the NFT's creator DID or its collection id is on the allow-list.
 *  Either alone suffices; a missing field simply can't match. */
export function isWhitelisted(
  set: Set<string>,
  creatorDid: string | undefined,
  collectionId: string | undefined
): boolean {
  if (creatorDid !== undefined && set.has(creatorDid)) return true;
  if (collectionId !== undefined && set.has(collectionId)) return true;
  return false;
}
