# NFT collection whitelist

## Problem

`ContentFilter`'s cheap-signals tier (`mapMintgardenSignals`) resolves a disposition (`blocked` / `sensitive` / `ok`) for every NFT spend from lexicon matches, CHIP-0007 `sensitive_content` flags, MintGarden's own collection/creator moderation state, and a curated denylist. Any NFT whose cheap verdict is `ok` gets queued for an out-of-band Google Vision SafeSearch check (`SafeSearchWorker`), deduped by content hash/URI but still one Vision call per unique image.

Large, well-known, unambiguously safe collections (e.g. official first-party mints) pay this Vision cost NFT-by-NFT for no benefit — nothing in the collection is ever going to resolve to anything but `ok`. We want a curated allow-list, keyed by (creator DID, collection id), that skips the Vision call entirely for these collections without weakening any existing safety signal.

## Non-goals

- The allow-list must never suppress or override a `blocked`/`sensitive` result from any existing signal (MintGarden moderation, `sensitive_content` flags, denylist, lexicon). It is strictly an optimization, not a safety override.
- No new network calls: the allow-list check reuses fields already present in the MintGarden `GET /nfts/:id` response that `mapMintgardenSignals` already fetches.

## Data model

New file `server/src/content-filter/signals/whitelist.ts`, mirroring `denylist.ts`:

```ts
export interface WhitelistEntry {
  creatorDid: string; // e.g. "did:chia:19qf3g9876t0rkq7tfdkc28cxfy424yzanea29rkzylq89kped9hq3q7wd2"
  collectionId: string; // MintGarden collection id, e.g. "col1z0ef7w5n4vq9qkue67y8jnwumd9799sm50t8fyle73c70ly4z0ws0p2rhl"
  note?: string;
}

export const WHITELIST: WhitelistEntry[] = []; // ships empty; populated via PR, like DENYLIST

export function buildWhitelistSet(entries: WhitelistEntry[]): Set<string>;
export const WHITELIST_SET: Set<string>;
export function isWhitelisted(
  set: Set<string>,
  creatorDid: string | undefined,
  collectionId: string | undefined
): boolean;
```

A match requires **both** the creator DID and the collection id (composite key), matching a specific creator's specific collection rather than either field alone.

Confirmed against the live MintGarden API: `GET /nfts/:id` returns `creator.encoded_id` (the DID, e.g. `"did:chia:..."`) and `collection.id` (e.g. `"col1..."`) — the same object `mapMintgardenSignals` already reads for the creator-verification and denylist checks.

## Precedence (in `mapMintgardenSignals`)

The allow-list is evaluated **last**, and only changes behavior when every other signal already resolved to `ok`:

1. **MintGarden authoritative signals** — creator `verification_state === 2` (fraud), `is_blocked` / `collection.blocked_content` — computed first, as today. Always wins.
2. **Heuristic / curated signals** — `collection.sensitive_content`, CHIP-0007 `metadata.sensitive_content`, curated denylist, lexicon match — computed next, as today, combined via the existing `strongest()` max-disposition logic.
3. **Allow-list** — only consulted if the combined disposition from (1)+(2) is `ok`. A match on (creatorDid, collectionId) doesn't change the disposition (it's already `ok`) — it stamps `whitelisted: true` on the `Verdict`, which is used purely to skip the Vision check.

A whitelisted collection that somehow trips the lexicon or a denylist entry still comes out `sensitive`/`blocked` — the allow-list can never mask a negative signal.

`Verdict` (types.ts) gains an optional field:

```ts
export interface Verdict {
  disposition: Disposition;
  whitelisted?: boolean;
}
```

## Skipping SafeSearch

`ContentFilter.apply()` already persists the cheap verdict via `store.putCheap(launcherId, nftId, verdict, contentHash)` the first time a launcherId is seen. This is extended with the `whitelisted` flag:

```ts
this.store?.putCheap(launcherId, event.nftId, verdict, contentHash, verdict.whitelisted);
```

`ContentStore.putCheap` gains a `skipSafesearch?: boolean` parameter. When true, it stamps `safesearch_checked_at` at insert time (as if a Vision check already ran), via:

```sql
INSERT INTO nft (..., safesearch_checked_at)
VALUES (..., ?)
ON CONFLICT(launcher_id) DO UPDATE SET
  ...,
  safesearch_checked_at = COALESCE(nft.safesearch_checked_at, excluded.safesearch_checked_at)
```

The `COALESCE` means a prior real Vision check is never clobbered, and re-spends of an already-whitelisted launcherId stay stamped.

No change is needed at the `SafeSearchWorker` enqueue call site: `tryEnqueue()` already reads `stored.safesearchChecked` fresh from the store and bails if it's `true` — this guard already covers the initial spend, every future re-spend, and the periodic sweep. Stamping the flag at cheap-signal time is sufficient to permanently exclude a whitelisted NFT from Vision, with zero new branching in the worker.

Note: this only affects new spends going forward. An NFT already persisted (checked or not) before a whitelist entry is added keeps its existing row — consistent with the existing "verdict is sticky per NFT" invariant elsewhere in `ContentFilter`.

## Testing

- `server/test/whitelist.test.ts` (mirrors `denylist.test.ts`): `WHITELIST` ships empty, `buildWhitelistSet` builds a composite key set, `isWhitelisted` matches only on the exact (did, collectionId) pair and returns `false` for a partial match or missing fields.
- `server/test/content-filter.test.ts` (`mapMintgardenSignals` unit tests): allow-list match on an otherwise-clean NFT → `{ disposition: "ok", whitelisted: true }`; allow-list match does NOT suppress a lexicon hit, a denylist entry, a `sensitive_content` flag, or MintGarden authoritative signals — those dispositions win and `whitelisted` is not set.
- `server/test/content-store.test.ts`: `putCheap` with `skipSafesearch: true` sets `safesearchChecked` on the stored row immediately; a subsequent `putCheap` call without the flag doesn't clear an already-set `safesearch_checked_at`.
- `server/test/content-filter.test.ts` (integration, via `ContentFilter.enrich`): a whitelisted NFT, spent through a `ContentFilter` configured with `store` + `googleApiKey` + `onFlag`, never triggers a Vision fetch (assert on call count/URLs seen by the injected `fetchImpl`) and `onFlag` is never called.
