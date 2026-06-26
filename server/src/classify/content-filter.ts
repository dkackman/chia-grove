export type Disposition = "blocked" | "sensitive" | "ok";

const asRecord = (v: unknown): Record<string, unknown> =>
  typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};

/** sensitive_content per CHIP-0007 may be boolean, the string "true", or a non-empty list. */
const isSensitiveFlag = (v: unknown): boolean =>
  v === true || v === "true" || (Array.isArray(v) && v.length > 0);

/**
 * Collapse a MintGarden GET /nfts/:id response object into one disposition.
 * Blocked (hard takedown) wins over sensitive (NSFW). Anything unrecognized or
 * malformed maps to "ok" (permissive) — the filter only acts on positive flags.
 */
export function mapMintgarden(json: unknown): Disposition {
  const nft = asRecord(json);
  const collection = asRecord(nft.collection);
  const creator = asRecord(nft.creator);
  const metadata = asRecord(asRecord(nft.data).metadata_json);

  if (
    nft.is_blocked === true ||
    collection.blocked_content === true ||
    creator.verification_state === 2
  ) {
    return "blocked";
  }
  if (isSensitiveFlag(collection.sensitive_content) || isSensitiveFlag(metadata.sensitive_content)) {
    return "sensitive";
  }
  return "ok";
}
