import type { Disposition, Verdict } from "../types.js";
import { combine } from "../verdict.js";
import { LEXICON, matchesLexicon } from "./lexicon.js";
import { DENYLIST_MAP, dispositionForCollection } from "./denylist.js";
import { WHITELIST_SET, isWhitelisted } from "./whitelist.js";

const asRecord = (v: unknown): Record<string, unknown> =>
  typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};

/**
 * MintGarden's creator.verification_state value for a creator flagged by their
 * moderation (verified=1, flagged=2). Matched strictly: only the exact number
 * blocks, so a malformed value can never escalate to a takedown.
 */
export const CREATOR_VERIFICATION_FLAGGED = 2;

/**
 * sensitive_content per CHIP-0007 may be boolean, a string, or a non-empty list.
 * A bare descriptive string (e.g. "nudity") flags as sensitive too; only the
 * explicit negatives ("" / "false") and a literal `false` are treated as clear.
 */
const isSensitiveFlag = (v: unknown): boolean => {
  if (v === true) return true;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    return s !== "" && s !== "false";
  }
  return Array.isArray(v) && v.length > 0;
};

export interface MapMintgardenOpts {
  /** Override the adult-term lexicon (test injection). Defaults to LEXICON. */
  lexicon?: string[];
  /** Override the collection denylist map (test injection). Defaults to DENYLIST_MAP. */
  denylist?: Map<string, Disposition>;
  /** Override the collection allow-list (test injection). Defaults to WHITELIST_SET. */
  whitelist?: Set<string>;
}

/**
 * Collapse a MintGarden GET /nfts/:id response into a Verdict, reporting which
 * of the cheap signals fired. Blocked (hard takedown) wins over sensitive (NSFW).
 * Anything unrecognized or malformed contributes nothing (permissive). A curated
 * allow-list (creator DID or collection id) is consulted last and can stamp
 * `whitelisted: true` on an otherwise-ok verdict, but it never overrides a
 * blocked/sensitive result.
 */
export function mapMintgardenSignals(json: unknown, opts: MapMintgardenOpts = {}): Verdict {
  const lexicon = opts.lexicon ?? LEXICON;
  const denylist = opts.denylist ?? DENYLIST_MAP;
  const whitelist = opts.whitelist ?? WHITELIST_SET;

  const nft = asRecord(json);
  const collection = asRecord(nft.collection);
  const creator = asRecord(nft.creator);
  const metadata = asRecord(asRecord(nft.data).metadata_json);

  const parts: Array<{ disposition: Disposition; signal: string }> = [];

  // creator verification → hard block
  if (creator.verification_state === CREATOR_VERIFICATION_FLAGGED) {
    parts.push({ disposition: "blocked", signal: "creator-verification" });
  }

  // MintGarden collection-level flags
  if (nft.is_blocked === true || collection.blocked_content === true) {
    parts.push({ disposition: "blocked", signal: "collection-blocked" });
  } else if (isSensitiveFlag(collection.sensitive_content)) {
    parts.push({ disposition: "sensitive", signal: "collection-sensitive" });
  }

  // CHIP-0007 off-chain metadata sensitive_content
  if (isSensitiveFlag(metadata.sensitive_content)) {
    parts.push({ disposition: "sensitive", signal: "metadata-sensitive-content" });
  }

  // curated collection denylist
  const collectionId = typeof collection.id === "string" ? collection.id : undefined;
  const deny = dispositionForCollection(denylist, collectionId);
  if (deny) parts.push({ disposition: deny, signal: "denylist" });

  // text-keyword heuristic over name / collection name / description
  const text = [nft.name, metadata.name, collection.name, metadata.description]
    .filter((s): s is string => typeof s === "string")
    .join(" ");
  if (matchesLexicon(text, lexicon)) parts.push({ disposition: "sensitive", signal: "lexicon" });

  const verdict = combine(parts);

  // Curated allow-list: consulted last, only once every other signal has
  // already resolved to "ok". Never overrides a blocked/sensitive result —
  // it exists purely to skip the Vision SafeSearch check for known-safe
  // collections (see whitelist.ts).
  if (verdict.disposition === "ok") {
    const creatorDid = typeof creator.encoded_id === "string" ? creator.encoded_id : undefined;
    if (isWhitelisted(whitelist, creatorDid, collectionId)) {
      return { disposition: "ok", whitelisted: true, signal: "whitelist" };
    }
  }

  return verdict;
}

/** Disposition-only convenience (back-compat with existing call sites/tests). */
export function mapMintgarden(json: unknown, opts: MapMintgardenOpts = {}): Disposition {
  return mapMintgardenSignals(json, opts).disposition;
}

/**
 * Extract the SHA-256 content hash from an api.mintgarden.io /nfts/{id} response.
 * Returns undefined for any missing, null, or malformed value so callers can
 * skip gracefully without guarding.
 */
export function extractContentHash(json: unknown): string | undefined {
  const hash = asRecord(asRecord(json).data).data_hash;
  return typeof hash === "string" && /^[0-9a-f]{64}$/i.test(hash) ? hash.toLowerCase() : undefined;
}
