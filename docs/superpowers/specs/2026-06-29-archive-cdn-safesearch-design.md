# Archive CDN URL for SafeSearch

**Date:** 2026-06-29
**Branch:** feat/safesearch-content-filter (or follow-on branch)
**Status:** Approved

## Problem

`SafeSearchWorker` passes the raw on-chain IPFS URL (e.g. `ipfs.mintgarden.io/ipfs/...`) to Google Vision. Google Vision fetches that URL directly. MintGarden's own IPFS gateway is unreliable from Google's IP ranges, producing nearly universal Vision failures (observed: 18 API calls → 1 successful classification).

The MintGarden Archive (`archive.mintgarden.io`) mirrors all NFT content to a Cloudflare-backed CDN at `files.mintgarden.io`. Its `/content/{sha256-hash}` endpoint returns a 301 redirect to an immutable CDN URL that Google Vision can fetch reliably.

## Goal

Replace the IPFS URL passed to Google Vision with the Archive CDN URL, using zero new API calls by extracting the content hash (`data.data_hash`) already present in the `api.mintgarden.io/nfts/{id}` response that `ContentFilter` already fetches.

## Data Flow

**Before:**

```
classifyBlock → MediaIndex[launcherId] = { url: ipfs://..., kind }
ContentFilter.enrich() → api.mintgarden.io → Verdict (signals only)
SafeSearchWorker → querySafeSearch(ipfs://...) → Vision unreliable
```

**After:**

```
classifyBlock → MediaIndex[launcherId] = { url: ipfs://..., kind }   (unchanged)
ContentFilter.enrich() → api.mintgarden.io → Verdict + data_hash
  → if hash present: MediaIndex[launcherId] = { url: archive.mintgarden.io/content/{hash}, kind }
SafeSearchWorker → querySafeSearch(archive.mintgarden.io/content/{hash}) → Vision succeeds
```

`SafeSearchWorker` is unchanged — it reads from `MediaIndex` as it does today. The URL it receives is upgraded by the time it runs because SafeSearch is async/out-of-band and always executes after `enrich()` completes.

The Archive `/content/{hash}` URL is a 301 redirect to `files.mintgarden.io/originals/...` (Cloudflare CDN, `cache-control: public, max-age=31536000, immutable`). Google Vision follows the redirect. This is separate from MintGarden's IPFS infrastructure and is reliably reachable.

## Component Changes

All changes are within `server/src/content-filter/`. Nothing outside this module changes.

### `signals/mintgarden.ts` — add `extractContentHash()`

New exported function alongside `mapMintgardenSignals()`:

```ts
export function extractContentHash(json: unknown): string | undefined {
  const hash = asRecord(asRecord(json).data).data_hash;
  return typeof hash === "string" && /^[0-9a-f]{64}$/i.test(hash) ? hash.toLowerCase() : undefined;
}
```

Validates the value is a 64-character lowercase hex string (SHA-256). Returns `undefined` for any missing, null, or malformed value.

### `index.ts` — thread hash through fetch → apply

**New internal type:**

```ts
interface FetchResult {
  verdict: Verdict;
  contentHash?: string;
}
```

**`fetchVerdict(nftId)`** return type changes from `Promise<Verdict>` to `Promise<FetchResult>`. After parsing JSON, calls both `mapMintgardenSignals(json)` and `extractContentHash(json)` on the same object. The 404 path (no JSON, returns `{ verdict: OK }`) produces no hash.

**`resolve(nftId)`** return type changes from `Promise<Verdict>` to `Promise<FetchResult>`. The inflight map changes from `Map<string, Promise<Verdict>>` to `Map<string, Promise<FetchResult>>`. The verdict cache (`this.cache: Map<string, Verdict>`) is unchanged — only the verdict is memoized across restarts; the hash is only needed on the first fetch.

Cache-hit and negative-cache paths return `{ verdict: cached }` / `{ verdict: OK }` with no `contentHash` — the MediaIndex was already upgraded on the first fetch, so the absence of a hash on cache hits is correct.

**`apply(event)`** — after `resolve()` returns, reads `result.contentHash`. If present and `media.get(launcherId)` exists, calls `media.set(launcherId, { url: \`${this.archiveBaseUrl}/content/${result.contentHash}\`, kind: existing.kind })`. This overwrites the IPFS URL with the Archive URL in-place (preserving `kind`). Blocked NFTs still call `media.delete()` as today — overwrite is skipped.

**New option on `ContentFilterOptions`:**

```ts
archiveBaseUrl?: string  // default "https://archive.mintgarden.io"
```

### `SafeSearchWorker`, `MediaIndex`, `signals/safesearch.ts`

No changes.

## Error Handling & Edge Cases

| Case                                  | Behavior                                                                                                                                                                                                                |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `data.data_hash` missing or malformed | `extractContentHash` returns `undefined`; MediaIndex unchanged; SafeSearch uses IPFS URL                                                                                                                                |
| NFT not yet in MintGarden (404)       | No JSON parsed; no hash; SafeSearch uses IPFS URL (same as today)                                                                                                                                                       |
| `launcherId` absent from MediaIndex   | `media.get()` returns `undefined`; skip silently (classifyBlock always sets it first, so this is defensive only)                                                                                                        |
| NFT is blocked                        | `media.delete()` runs (existing); overwrite skipped (no entry to overwrite)                                                                                                                                             |
| `mediaKind !== "image"`               | MediaIndex still gets the Archive URL (harmless); SafeSearch skips non-images via existing `maybeEnqueue` guard                                                                                                         |
| Inflight dedup                        | Multiple `apply()` calls awaiting the same inflight promise all get the same `FetchResult`; first caller to resolve updates MediaIndex, subsequent cache hits skip the overwrite (no `contentHash` in cached `Verdict`) |
| Archive base URL unreachable          | SafeSearch attempts the Archive URL; Vision failure is handled by existing `SafeSearchWorker` error path (suppresses for `failTtlMs`, NFT stays permissive)                                                             |

## Testing

All test additions go into the existing `server/test/content-filter.test.ts`.

**`extractContentHash`:**

- Valid 64-char lowercase hex → returns it
- Valid 64-char uppercase hex → returns lowercased
- 63 chars → `undefined`
- Non-hex characters → `undefined`
- `data_hash` is `null` → `undefined`
- `data` key absent from response → `undefined`
- Entire response is `null` → `undefined`

**`ContentFilter.apply()` with hash present:**

- Mock `fetchImpl` returns response with valid `data_hash`
- After `enrich()`, assert `media.get(launcherId).url === "https://archive.mintgarden.io/content/{hash}"`
- Assert `kind` is preserved from the original entry

**`ContentFilter.apply()` without hash:**

- Mock returns response with no `data.data_hash`
- Assert MediaIndex URL is unchanged (still the original IPFS URL)

**`ContentFilter.apply()` blocked NFT with hash:**

- `is_blocked: true` + valid `data_hash`
- Assert MediaIndex entry is deleted (not overwritten)

**`archiveBaseUrl` option injection:**

- Pass `archiveBaseUrl: "https://test-archive.example"` in options
- Assert MediaIndex URL starts with the injected base

**SafeSearch integration:**

- Assert `SafeSearchWorker.maybeEnqueue()` sees the Archive URL in MediaIndex when hash was present (reads from MediaIndex after `enrich()`)

## Out of Scope

- `/img` proxy — it also benefits from the MediaIndex URL upgrade as a side effect, but no proxy code changes.
- `api.mintgarden.io` → Archive API migration for moderation signals — Archive does not expose `is_blocked`, `collection.blocked_content`, or `creator.verification_state`, so `api.mintgarden.io` remains the source for cheap signals.
- New environment variables — no user-facing config changes needed.
