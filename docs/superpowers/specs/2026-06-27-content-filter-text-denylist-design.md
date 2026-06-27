# Content filter: text-keyword + collection-denylist signals

**Date:** 2026-06-27
**Status:** Approved, ready for implementation plan

## Problem

NFT adult-content detection currently rests on a single signal: the MintGarden
API flags surfaced by `mapMintgarden` in
[`server/src/classify/content-filter.ts`](../../../server/src/classify/content-filter.ts)
(`is_blocked`, `blocked_content`, `verification_state`, and CHIP-0007
`sensitive_content` on collection/metadata). NFTs that are adult but not flagged
in MintGarden's structured fields slip through.

We want two additional low-cost signals that catch self-described content and
known-bad collections, without adding network calls or new infrastructure.

## Scope

In scope:

- **Text-keyword heuristic** over NFT/collection text already present in the
  MintGarden response.
- **Curated collection denylist** keyed by MintGarden collection ID.

Explicitly out of scope (deferred / declined):

- Direct on-chain CHIP-0007 metadata fetch (user is comfortable relying on
  MintGarden as the data source).
- Content-based / ML image scanning (a later tier).
- NFT-level (launcher/nft ID) denylist entries — collection-ID granularity only.
- Env/config overrides or hot-reload — both data sets are committed source,
  edited via PR.

## Key facts that shape the design

- The `SproutEvent` carries `launcherId`/`nftId` but **not** a collection ID; the
  collection ID is only known from the MintGarden response. Therefore the
  denylist is evaluated against the MintGarden JSON, not before the fetch.
- Consequently the entire feature lives inside the existing pure function
  `mapMintgarden(json)` plus two static data modules. The async `ContentFilter`
  class (caching, concurrency gate, enrich budget, negative cache, `/img`
  blocked-bytes deletion) is **unchanged** — it already acts on whatever
  `mapMintgarden` returns.

## Design

### Approach

Extend the existing `mapMintgarden(json): Disposition` pure function. It already
collapses the response into one disposition with `blocked > sensitive > ok`
precedence. Two new signals fold into that same precedence. New signals can only
**raise** sensitivity, never lower it; the empty/unknown case stays permissive
(`ok`), preserving current behavior exactly.

Rejected alternative: a separate post-fetch pass inside `ContentFilter` —
duplicates the precedence logic and splits the verdict across two sites.

### New data modules (in `server/src/classify/`)

**`lexicon.ts`** — exports a flat, committed array of adult terms (a small,
high-precision starter set; tuned later by PR). Matching is case-insensitive
with word boundaries (`\bterm\b`) to limit false positives. Matched against:

- `nft.name`
- `nft.collection.name`
- `nft.data.metadata_json.description`

Any hit → `sensitive`.

**`denylist.ts`** — exports `{ collectionId: string; disposition: "blocked" | "sensitive"; note?: string }[]`,
built once into a `Map<string, Disposition>`. **Ships empty.** Looked up by
`nft.collection.id`. Per-entry disposition.

### Verdict fold inside `mapMintgarden`

Compute the strongest of:

1. Existing MintGarden flag verdict (unchanged logic).
2. Denylist verdict, by `nft.collection.id`.
3. Text verdict (`sensitive` on any lexicon hit, else `ok`).

Combine with the existing precedence `blocked > sensitive > ok`. So a `blocked`
denylist entry beats a `sensitive` text hit beats `ok`.

### Field access

All fields read defensively via the existing `asRecord` helper. Field paths
(`nft.name`, `nft.collection.name`, `nft.collection.id`,
`nft.data.metadata_json.description`) are confirmed against a real MintGarden
`/nfts/:id` fixture during implementation. Missing/malformed fields contribute
nothing.

## Testing

Extend [`server/test/content-filter.test.ts`](../../../server/test/content-filter.test.ts):

- Text hit in `name`, `collection.name`, and `description` each → `sensitive`.
- Word-boundary: a benign substring containing a term as a fragment does **not**
  match.
- Denylisted collection → its declared disposition.
- Denylist `blocked` overrides a co-occurring text `sensitive`.
- Existing MintGarden `blocked` still wins over new `sensitive` signals.
- Empty/missing text fields and empty denylist → `ok` (permissive preserved).

Add a small sanity test that `lexicon` and `denylist` are well-formed
(non-empty/typed lexicon entries; denylist entries have valid dispositions).

## Risks

- **Lexicon false positives** — mitigated by word-boundary matching and `sensitive`
  (blur, reversible) rather than `blocked`. Starter list kept small/high-precision.
- **MintGarden field drift** — field paths verified against a fixture; defensive
  reads degrade to `ok` rather than throwing.
