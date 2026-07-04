# Image-proxy media cache + single-flight coalescing

**Date:** 2026-07-03
**Branch:** `proxy-optimizations`
**Status:** Design approved, pending spec review

## Problem

The `/img` and `/thumbnail` proxy endpoints re-fetch from upstream on every cold
request. The `cache-control: public, max-age=86400` header they set only helps a
warm browser; the origin has no cache and there is no CDN (stock Caddy reverse-
proxies straight to Fastify on `:8080`). So:

- Every distinct viewer whose browser cache is cold pays the full upstream
  latency (measured at ~5–6 s for IPFS/gateway art) for art that another viewer
  already loaded seconds earlier.
- Every WebSocket snapshot replay (a new client replays up to 10 000 events)
  re-drives the proxy for the same NFTs.
- Concurrent viewers hitting the same brand-new NFT (the common case on a shared
  live board) each open an independent upstream fetch, each consuming one of the
  32 `MAX_INFLIGHT` slots for up to the 6 s timeout.

The board detail popup — the original complaint — loads image NFTs through
`/img?nft=<launcherId>` and video posters through `/thumbnail?nft=<launcherId>`.
Both are bounded (≤ 4 MB) and are the high-value cache target.

## Scope

**In scope (this branch):** an in-process response cache for bounded media plus
single-flight coalescing. These are one coupled feature — a cache wants
single-flight to avoid a thundering herd on cold entries, and coalescing needs
app-level state regardless.

**Out of scope (follow-up branch):** per-host negative cache, DNS caching in
`safeLookup`, tightening the sequential-candidate worst-case timeout, and
separate inflight budgets for `/img` vs `/thumbnail`.

**Explicitly not doing:** caching large video bodies, disk persistence, or an
edge/Caddy cache. Large videos keep streaming uncached exactly as today. An
edge cache remains a viable *future* layer that composes in front of this one;
it is not a one-way door.

## Approach

App-level in-memory byte-budgeted LRU, chosen over a Caddy reverse-proxy cache
because:

- It is the codebase idiom — another bounded LRU in the same shape as
  `MediaIndex`, and the proxy's existing `fetchUpstream`/`failures` injection
  seams extend naturally to it, so the whole path stays unit-testable offline.
- The single-flight half of the work requires app-level state (`Map<key,
  Promise>`) anyway; the cache rides alongside it nearly for free.
- The cache stores bytes that have already passed SSRF validation,
  `safeContentType`, and the byte cap — it can only ever hold sanitized image
  bodies.
- `launcherId → art bytes` is immutable, so invalidation is a non-problem
  (see below), whereas an edge cache would need app→proxy purge wiring.
- Zero infra change: no custom Caddy build, no new deploy step, no
  supply-chain surface.

Cost accepted: the cache lives in the Node process heap/RSS (bounded by a byte
budget), and it is cold after each restart (systemd `Restart=always`); it
re-warms quickly.

## Components

### New: `server/src/web/media-cache.ts`

A `MediaCache` class — a **pure byte-budgeted LRU store** of buffered small
responses. Storage only: no fetching, no single-flight, no clock (there is no
TTL — see "No TTL" below). This keeps it a trivially testable data structure,
in the same spirit as `MediaIndex`.

Stored entry shape:

```ts
interface CachedResponse {
  body: Buffer;
  contentType: string; // already run through safeContentType
}
```

Public surface (approximate — finalized during planning):

- `get(key: string): CachedResponse | undefined` — read; on hit, re-inserts the
  key so it becomes newest (LRU recency, mirroring the `delete`+`set` idiom in
  `MediaIndex`/`FailureCache`).
- `set(key: string, resp: CachedResponse): void` — insert; tracks a running total
  of stored bytes and evicts oldest entries until the total ≤ budget. An entry
  whose body alone exceeds the whole budget is never stored (and evicts nothing).

Byte budget and per-entry cap are constructor params. The per-entry cap is
enforced by the caller (the proxy collector) before `set` is reached, but `set`
independently refuses an over-budget body as a safety net.

### Single-flight (in the proxy, not the cache)

The single-flight coordination lives in the `registerImageProxy` closure as an
`inFlight = new Map<string, Promise<CachedResponse | null>>()`, alongside the
existing `inflight` counter and `limiter`. It is not part of `MediaCache`
because the leader produces the cached value *while streaming that same body to
its own client* through a tee (below) — an interleaving a generic
`load(key, fetchFn)` helper cannot encapsulate. A leader creates a deferred,
registers it under the key, resolves it from the collector's finalize step, and
clears the map entry in a `finally`. Coalescing is covered by the proxy's
integration tests rather than a standalone unit.

### Changed: `server/src/web/img-proxy.ts`

- Signature gains an injected cache:
  `registerImageProxy(app, media, failures?, cache?, fetchUpstream?)`,
  defaulting `cache` to a fresh `MediaCache(CACHE_BYTE_BUDGET, CACHE_ENTRY_MAX_BYTES)`,
  mirroring how `failures` is injected.
- New constants:
  - `CACHE_BYTE_BUDGET = 64 * 1024 * 1024` (total; tunable)
  - `CACHE_ENTRY_MAX_BYTES = 4 * 1024 * 1024` (per entry; matches
    `THUMB_MAX_BYTES`)
- Both `/img` and `/thumbnail` route their cache-eligible path through the cache
  using key prefixes `img:<launcherId>` and `thumb:<launcherId>` (distinct
  bytes → distinct keys, one shared byte budget).

### Changed: `server/src/web/server.ts`

Constructs one `MediaCache` and passes it into `registerImageProxy` so a single
budget covers both endpoints.

## Cacheability rules

A response is cached only if **all** hold:

1. The request carries no `Range` header (ranged requests bypass the cache and
   stream as today; only `<video>`/`<audio>` send Range, and those are the
   uncached large-media path anyway).
2. The final upstream status is a full **200** (never 206/3xx/4xx/5xx).
3. The content-type after `safeContentType` is `image/*` — so `/thumbnail`
   always qualifies and `/img` qualifies for image NFTs, while videos and audio
   never do.
4. The buffered body is ≤ `CACHE_ENTRY_MAX_BYTES`.

Anything failing these streams through the existing hardened
`upstream → byteCap → reply` path unchanged.

## Request flow & coalescing

For a cache-eligible request (no `Range`):

1. **Hit** (`cache.get` returns bytes) → serve immediately. No upstream fetch, no
   inflight slot consumed. This is the primary win: after one viewer warms an
   NFT, every later viewer and every snapshot replay is instant.
2. **Miss, no load in flight** → this request becomes the leader:
   - Run the existing candidate fetch loop (`entry.url` then `entry.fallbackUrl`,
     SSRF-validated, redirect-following).
   - Once response headers are known and the response is cacheable, stream to
     this client through a passive **collector tee** that forwards every chunk to
     the reply (delivery unchanged) while accumulating up to
     `CACHE_ENTRY_MAX_BYTES`. On a clean stream end within the cap, `cache.set`
     the buffer and resolve the in-flight promise with it.
   - If headers say not cacheable (video/audio, oversized declared length),
     resolve the in-flight promise `null` **immediately** so waiters fall through
     fast, and stream to the client exactly as today (no collector).
   - If the accumulation exceeds the cap mid-stream (declared length was absent
     or lied), stop accumulating and abandon caching, but keep forwarding to the
     client; resolve `null`.
3. **Miss, load in flight** → await the leader's promise:
   - Resolved with bytes → serve from those bytes.
   - Resolved `null` → fall through to an independent fetch (rare: only when the
     leader's body was uncacheable, i.e. large/video — same as today's behavior).

The failure/negative-cache path is unchanged: a fetch failure still calls
`failures.mark(launcherId)` and returns 502/504, and a successful 200/206 still
calls `failures.clear(launcherId)`. The cache sits in front of a successful
fetch, not around the failure bookkeeping.

## Serving & security

- Cached bytes are stored only after passing SSRF validation, `safeContentType`,
  and the byte cap, so the cache holds sanitized image bodies exclusively.
- A cache hit replays the same response headers a fresh serve would: `access-
  control-allow-origin: *`, `cache-control: public, max-age=86400`, the sanitized
  `content-type`, `x-content-type-options: nosniff`, `content-security-policy:
  sandbox; default-src 'none'`, and `content-length = body.length`. Ranged
  passthrough headers (`content-range`, `accept-ranges`) are not stored because
  only full 200 bodies are cached.
- The rate limiter still runs first on every request, including cache hits, so
  the cache does not open a bypass around abuse controls.

### No TTL / no explicit invalidation

`launcherId → art bytes` is immutable (an NFT's on-chain art does not change), so
a cached entry is never *wrong* — only eventually evicted by the byte-LRU. This
removes the need for a TTL or app→cache purge wiring:

- A late SafeSearch `sensitive` flip still fetches and blurs client-side
  (unchanged); the bytes are the same.
- `blocked` NFTs are never requested by the client (`mediaSrc` returns null),
  unchanged by this cache. (The proxy already does not gate on `blocked`; that is
  pre-existing and out of scope.)
- A reorg that evicts a `MediaIndex` entry may leave a stale cache entry, but it
  is harmless immutable art and is bounded by the byte budget.

## Testing (TDD)

`server/test/media-cache.test.ts` (new — the pure store):

- `set` evicts oldest entries until total bytes ≤ budget (byte-budget LRU).
- `get` promotes a key to newest, so a recently-read entry survives an eviction
  that drops a colder one.
- an entry whose body exceeds the whole budget is rejected, not stored, and
  evicts nothing.
- `get` on an absent key returns `undefined`.

`server/test/img-proxy.test.ts` (added cases — cache + coalescing, using the
existing `fakeUpstream` PassThrough + `app.inject`, and a `fetcher` that counts
calls):

- cache miss fetches once; an immediate second identical request serves from
  cache with **zero** further `fetcher` calls, status 200, correct bytes and
  content-type.
- two concurrent `/img?nft=X` requests (a deferred fetcher so the second arrives
  mid-load) trigger **one** upstream fetch (coalesced) and both get the bytes.
- a `video/mp4` 200 response is streamed but **not** cached (a later request
  fetches again).
- a request with a `Range` header bypasses the cache (not served from and not
  stored).
- a non-200 response (e.g. 404 with no fallback) is not cached.
- `/thumbnail` caches and coalesces the same way under the `thumb:` key.

All of `npm test`, `npm run typecheck`, and `npm run lint` stay green.

## Rollout

No env or deploy changes. Constants are compiled defaults; if ops tuning of the
budget is later wanted, promote `CACHE_BYTE_BUDGET` to an env var — deferred
under YAGNI.
