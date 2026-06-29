# Archive Ingestion Check for SafeSearch

**Date:** 2026-06-29
**Branch:** feat/safesearch-content-filter (or follow-on)
**Status:** Approved

## Problem

When a new NFT mint is processed, `ContentFilter.apply()` upgrades the `MediaIndex` entry to `archive.mintgarden.io/content/{hash}`. But the Archive's crawler may not have fetched the content yet — a race condition between our ingestion pipeline and theirs. If `SafeSearchWorker` passes the Archive CDN URL to Google Vision before the Archive has ingested the content, Vision gets a 404 and the lookup fails, triggering `failedUntil` suppression.

The Archive's `GET /nfts/{launcher_id}` endpoint explicitly reports ingestion status via `assets[role="data"].fetch_succeeded`. Polling this endpoint before calling Vision eliminates the race.

## Goal

Add a pre-check in `SafeSearchWorker.run()` that polls the Archive until the content is confirmed ingested (or retries are exhausted), before passing the URL to Google Vision.

## Data Flow

```
SafeSearchWorker.run(launcherId, imageUri)
  → if imageUri starts with archiveBaseUrl:
      waitForArchive(launcherId)
        poll GET {archiveBaseUrl}/nfts/{launcherId}
          find assets[role="data"].fetch_succeeded === true → ready
          404 or fetch_succeeded false → not ready yet
        retry up to archiveCheckAttempts times, archiveCheckDelayMs apart
        exhausted → throw → existing catch → failedUntil suppression
  → querySafeSearch(imageUri, ...)   ← only reached when Archive confirmed ready
```

If `imageUri` does not start with `archiveBaseUrl` (e.g. still an IPFS URL for NFTs that returned 404 from `api.mintgarden.io`), the Archive check is skipped entirely and Vision is called directly — preserving today's behaviour for that path.

## Component Changes

All changes are within `server/src/content-filter/safesearch-worker.ts`. Nothing else changes.

### New options on `SafeSearchWorkerOpts`

```ts
/** Base URL for the MintGarden Archive API; used for ingestion pre-check. */
archiveBaseUrl?: string;          // default "https://archive.mintgarden.io"
/** Max attempts to poll the Archive before giving up (each separated by archiveCheckDelayMs). */
archiveCheckAttempts?: number;    // default 3
/** Milliseconds to wait between Archive poll attempts. */
archiveCheckDelayMs?: number;     // default 2000
```

### New private method `waitForArchive(launcherId)`

Polls `GET {archiveBaseUrl}/nfts/{launcherId}`. Finds the asset with `role === "data"` in the `assets` array and checks `fetch_succeeded === true`. Returns normally if confirmed; throws `Error("archive not ready")` after all attempts are exhausted. Any non-200 response is treated as "not ready" (same failure path).

Uses the existing `fetchImpl` injection — no new dependencies.

### Updated `run()`

Before calling `querySafeSearch`, checks whether `imageUri.startsWith(this.archiveBaseUrl)`. If so, calls `waitForArchive(launcherId)`. On throw, the existing `catch` block sets `failedUntil` and returns — identical behaviour to a Vision network error. `failedUntil` is suppressed for `failTtlMs` (default 5 min), so the retry happens naturally on the next block.

## Error Handling

| Case                                                                      | Behaviour                                                                   |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `fetch_succeeded: true` on first attempt                                  | Proceed to Vision immediately                                               |
| `fetch_succeeded: false` (Archive has NFT but hasn't fetched content yet) | Retry after `archiveCheckDelayMs`                                           |
| 404 (Archive doesn't know NFT yet)                                        | Retry after `archiveCheckDelayMs`                                           |
| Non-200 / network error during poll                                       | Retry after `archiveCheckDelayMs`                                           |
| All attempts exhausted                                                    | Throw → `catch` → `failedUntil` set → SafeSearch deferred until TTL elapses |
| `imageUri` not an Archive URL                                             | Skip check entirely, call Vision directly                                   |

## Testing

All tests in `server/test/content-filter.test.ts`.

- **Ready on first attempt:** mock returns `fetch_succeeded: true` immediately; assert Vision is called once with the Archive URL.
- **Ready after retries:** mock returns `fetch_succeeded: false` twice then `true`; assert Vision called once after the third poll; `archiveCheckDelayMs: 0` for test speed.
- **Exhausted — failedUntil set:** mock always returns `fetch_succeeded: false`; assert Vision never called; assert `failedUntil` is set for the launcherId.
- **Non-Archive URL skips check:** imageUri is `https://ipfs.mintgarden.io/...`; assert Archive endpoint never called, Vision called directly.
- **Archive network error counts as not-ready:** mock throws on Archive poll; assert retries happen, Vision not called on exhaustion.

`archiveCheckDelayMs: 0` is passed in all tests to avoid real sleeps.

## SafeSearch Scope: Mints and Re-spends

`SafeSearchWorker.maybeEnqueue` now queues any image NFT spend whose cheap verdict was `ok` and that hasn't been SafeSearch-checked yet — not just mints. This means the mint-only guard (`event.mint !== true`) is removed from the `maybeEnqueue` guard.

**Rationale:** An NFT can arrive as a re-spend (transfer) on a node that first sees it after a restart, before its mint event was processed. Restricting to mints leaves these NFTs permanently unchecked when the SQLite store has no record of them. The `safesearchChecked` flag in the store already ensures each launcherId is checked at most once regardless of how many events arrive.

## Out of Scope

- Changing the retry/suppression TTL (`failTtlMs`) — Archive-not-ready exhaustion and Vision errors both use it.
- Persisting the Archive ingestion status — it's transient; the Archive catches up quickly.
- Any changes to `ContentFilter`, `MediaIndex`, or `ContentStore`.
