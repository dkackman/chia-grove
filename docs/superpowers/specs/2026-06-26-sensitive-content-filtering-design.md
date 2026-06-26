# Sensitive / blocked NFT content filtering

**Date:** 2026-06-26
**Status:** Approved (design)

## Goal

NFT art that MintGarden flags as **blocked** (hard takedown) or **sensitive**
(NSFW) must never display as real pixels anywhere in the UI. Card text, amounts,
asset/launcher ids, and external links stay fully visible — only the image/video
is suppressed. The mechanism is built so that additional filter factors can be
added later without changing the client.

## Decisions (from brainstorming)

- **Source of truth:** MintGarden `GET https://api.mintgarden.io/nfts/<nftId>`.
- **Blocked** (hard hide — art bytes made unreachable, neutral placeholder shown):
  - `nft.is_blocked === true`, OR
  - `nft.collection.blocked_content === true`, OR
  - `nft.creator.verification_state === 2` (community-blocklisted creator).
- **Sensitive** (soft — blurred in DOM, placeholder in WebGL):
  - `nft.collection.sensitive_content` truthy, OR
  - `nft.data.metadata_json.sensitive_content === true`, OR
  - `nft.data.metadata_json.sensitive_content === "true"`.
- **Precedence:** blocked wins over sensitive.
- **Unknown / lookup fails / malformed:** **permissive** (show normally). Most
  NFTs are benign and blurring the whole scene on incomplete coverage would gut
  the experience; the filter only acts on positively-flagged content.
- **Sensitive reveal:** none. Permanently blurred — no click-to-reveal this pass.
- **Applies everywhere by construction** (see "Coverage" below).

## Coverage — every NFT-pixel surface

NFT art reaches actual pixels in exactly three places, all funnelling through two
shared functions. grove / farm / board render NFT events as flora / crops /
split-flap glyphs — no image — so their only "media view" is the shared detail
card.

| Surface                                                                  | Renders           | Chokepoint                      |
| ------------------------------------------------------------------------ | ----------------- | ------------------------------- |
| DOM detail card (`web/src/ui/detail-card.ts`) — shared by **all** scenes | `<img>`/`<video>` | `mediaSrc()` + `mediaKind`      |
| gallery WebGL walls (`web/src/themes/gallery/gallery.ts`)                | texture           | `mediaSrc()` + `loadArtTexture` |
| mine paintings (`web/src/themes/mine/structures.ts`)                     | texture           | `mediaSrc()` + `loadArtTexture` |

The rule lives in **one resolver** in `web/src/ui/media.ts`. Because the flag
rides on the `SproutEvent` and every surface routes through that resolver, any
future render surface inherits the filter automatically.

## Architecture — server collapses all signals into one wire flag

```
classifyBlock (sync, unchanged)            GroveEvent[]
        |
        v
ContentFilter.enrich(events)   <-- new, async
   for each NFT sprout:
     disposition = cache[nftId]
                   ?? await fetch api.mintgarden.io/nfts/<nftId>
     map -> "blocked" | "sensitive" | "ok"   (mapMintgarden, pure + unit-tested)
     blocked   -> event.mediaFilter = "blocked"; media.delete(launcherId)
     sensitive -> event.mediaFilter = "sensitive"
        |
        v
hub.publish(events)   // flag baked into RingBuffer -> snapshot replay carries it
```

Because the flag is set before `hub.publish`, it is stored in the `RingBuffer`
and therefore replayed identically to new clients via `Snapshot`. No "update"
event is needed.

### Wire field (`shared/src/index.ts`)

```ts
export interface SproutEvent {
  // ...existing fields...
  mediaFilter?: "blocked" | "sensitive"; // absent = ok; NFT only
}
```

An **enum, not a boolean**, so future dispositions can be added. Crucially, all
the _combination logic_ (which signals mean what, future factors) lives
server-side in `ContentFilter`; the client only reacts to the resulting flag.
That is the extensibility seam.

`PROTOCOL_VERSION` is bumped **2 -> 3**. `mediaFilter` is technically additive
(an old client would ignore it), but this is a safety feature: the bump forces
every connected client to reload so none keep running un-filtered code.

## Components

### New: `server/src/classify/content-filter.ts`

- **`mapMintgarden(json: unknown): "blocked" | "sensitive" | "ok"`** — pure
  function applying the decision rules above with blocked precedence. Tolerant of
  missing/oddly-typed fields (defensive optional chaining); anything unrecognized
  maps to `"ok"`. Independently unit-tested.
- **`class ContentFilter`**:
  - `enrich(events: GroveEvent[]): Promise<void>` — for each NFT `SproutEvent`,
    resolve its disposition and set `event.mediaFilter` (+ for blocked, call
    `media.delete(launcherId)`).
  - Bounded **LRU cache keyed by `nftId`** (sensitivity is stable per NFT;
    repeated spends/transfers are free). Capacity comparable to the ring buffer.
  - **Bounded concurrency** and a per-request **`AbortController` timeout** so a
    slow MintGarden can't stall the poll loop or the 150-block backfill.
  - **Permissive on error/timeout** (returns `"ok"`). Successful determinations
    (including `"ok"`) are cached; transient fetch errors are _not_ cached so a
    later spend can retry.
  - MintGarden is a fixed trusted host and the URL is built from a server-derived
    `nftId`, so the SSRF machinery used by `/img` is unnecessary — plain `fetch`
    with an `AbortController` timeout suffices.

### Changed: `server/src/web/media-index.ts`

- Add `delete(launcherId: string): void`. Blocked NFTs have their `MediaIndex`
  entry removed so `/img?nft=<launcherId>` returns 404 — the bytes are
  unreachable through the proxy (defense in depth), independent of the client
  flag. (Sensitive entries are kept; the DOM card needs them to render the
  blurred image.)

### Changed: `server/src/index.ts`

`onBlock` becomes async:
`classifyBlock(...)` -> `await filter.enrich(events)` -> `hub.publish(events)`.
A `ContentFilter` is constructed alongside `MediaIndex` and passed the `media`
instance.

### Changed: `server/src/ingest/coinset-poller.ts` + `types.ts`

`ChainHandlers.onBlock` returns `void | Promise<void>`; `walkTo` `await`s it so
block ordering is preserved (a block isn't published before the previous one's
enrichment resolves).

### Changed (client): `web/src/ui/media.ts` — single source of truth

Add a disposition resolver consumed by every surface:

```ts
export type MediaDisposition =
  | { render: "art"; src: string; kind: MediaKind } // show normally
  | { render: "blur"; src: string; kind: MediaKind } // DOM blurs; WebGL placeholders
  | { render: "placeholder" } // blocked: no bytes
  | { render: "none" }; // genuinely no art

export function resolveMedia(event: SproutEvent): MediaDisposition;
```

- `mediaFilter === "blocked"` -> `placeholder` (never yields a src; bytes never
  fetched).
- `mediaFilter === "sensitive"` -> `blur` (src present; surface decides blur vs
  placeholder).
- otherwise existing behavior (`art` if a src resolves, else `none`).

`mediaSrc()` is kept for callers that only need the URL but returns `null` for
blocked, so even an un-updated caller cannot fetch blocked bytes.

### Changed (client): `web/src/ui/detail-card.ts`

Switch on `resolveMedia(event)`:

- `art` -> current `nftMediaEl`.
- `blur` -> same media element with a `sensitive` CSS class (`filter: blur(...)`,
  un-interactable) plus a small "sensitive content" caption.
- `placeholder` -> a neutral placeholder element (no media bytes).
- `none` -> nothing (as today).

Text, amount, ids, and the spacescan / mintgarden links are unaffected in all
cases. (CAT icons via `catIconUrl` are registry logos, not NFT art, and are out
of scope.)

### Changed (client): `web/src/themes/gallery/gallery.ts`, `mine/structures.ts`

Before calling `loadArtTexture`, check `resolveMedia(event)`. For `blur` or
`placeholder`, assign a shared neutral **placeholder texture** instead of
fetching real art. `art` keeps current behavior. A new shared placeholder texture
helper (procedural, in `web/src/themes/shared/`) is referenced by both.

`gallery/select.ts` continues to gate on `event.kind === "nft" && !!mediaKind`;
sensitive NFTs retain `mediaKind` so they still get a frame (with placeholder
texture). Blocked NFTs also retain `mediaKind` (only the bytes are withheld), so
they likewise show a placeholder frame rather than vanishing.

### Changed (client): `web/src/net/demo.ts`

Seed a couple of synthetic events with `mediaFilter: "blocked"` and
`"sensitive"` so both paths are exercisable offline via `?demo=1`.

## Testing

- **`mapMintgarden`** (server unit): each blocked signal individually; each
  sensitive signal individually (`true`, `"true"`, collection flag); blocked
  precedence over sensitive; unknown/empty -> `ok`; malformed/non-object -> `ok`.
- **`ContentFilter`** (server unit, mocked fetch): cache hit avoids refetch;
  timeout -> `ok` and not cached; blocked disposition calls `media.delete`;
  enrich sets `mediaFilter` on NFT sprouts only.
- **`media-index`**: `delete` removes an entry (subsequent `get` is `undefined`).
- **`resolveMedia`** (web unit): blocked -> `placeholder` and no src; sensitive ->
  `blur` with src; normal -> `art`; no media -> `none`; demo `dataUri` honored
  except when blocked.

## Out of scope (future factors, enabled by the seam)

- Collection / creator allow-lists and local block-lists.
- Parsing on-chain `sensitive_content` directly from `metadataUris` JSON as a
  fallback when MintGarden has no record.
- User-toggleable reveal / per-theme reveal UX.
- Filtering CAT icons or other non-NFT media.
