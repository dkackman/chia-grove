# Board: Block Detail View Design

**Date:** 2026-07-02
**Scope:** Board theme (`web/src/themes/board/`), shared picker (`web/src/ui/`), server (`server/src/web/`, `server/src/content-filter/`)

## Problem

The Big Board only ever shows the live, rolling ledger (last 500 spend events, aggregated per block). There's no way to drill into a specific block, see every individual spend in it, step to adjacent blocks, or jump straight to an arbitrary historical block — including ones older than what the client happens to have buffered since connecting.

## Goal

- Clicking a block height in the ledger opens a **detail view**: the same split-flap board, showing every individual spend in that block (unaggregated), with forward/back controls to step to adjacent heights.
- A **find block** control, present on both the live and detail views, lets the user type a height and jump straight to its detail view.
- Detail-view state is reflected in the URL (`?theme=board&block=<height>`) so a link to a specific block is shareable and reloadable.
- Works for any historical height, not just what's in the client's in-memory buffer — the server fetches and classifies blocks on demand.
- NFT content filtering in the detail view is the real thing: cheap signals plus, if not already checked, a genuine SafeSearch pass persisted to the store — not a lookup-only shortcut.

## Non-Goals

- No in-scene (split-flap) text entry — find-block is a plain DOM input.
- No server-side response caching or rate limiting beyond input validation.
- No change to the live ledger's existing XCH/CAT aggregation.

## Interaction Model

The height column (leftmost 8 characters) of every ledger row is clickable, whether or not that particular row currently renders the height glyphs (continuation rows within a block group are included) — the whole vertical stripe belongs to that row's block. Clicking it opens detail mode for that height. Clicking anywhere else in a row keeps today's behavior (the existing spend/aggregate detail card via `ui/picker.ts` + `ui/detail-card.ts`).

This requires column-aware hit testing: `FlapGrid` instances already expose row *and* column via `instanceId` (`rowOf()` exists; a matching column derivation is `instanceId % cols`), so the picker's `metaFor`-based flow needs a companion path for "this hit was in the height gutter" that board.ts handles itself rather than routing through the generic card popup.

## URL State

Detail mode is reflected as `?theme=board&block=<height>`, in addition to the existing `?theme=`. On entering detail mode (via height click, find-block, or forward/back), the app calls `history.pushState` with the updated query string; returning to live clears `block` via `pushState` as well, so browser back/forward moves between viewed blocks and live. On initial page load, if `block` is present, the board starts directly in detail mode for that height (fetching before the first frame, showing a loading state) rather than requiring a click first.

## Backend: `GET /block/:height`

New Fastify route (`server/src/web/`), reusing the existing ingest pipeline rather than duplicating it:

1. Validate `:height` is a non-negative integer; 400 otherwise.
2. `rpcView.getBlockInfo(height)` (already exists in `server/src/ingest/coinset-view.ts`, currently only constructed inside `index.ts` for the poller — needs to be lifted to a shared instance the route handler can also use). If the RPC 404s, or `timestamp` is `null` (a non-transaction block), respond with a block that has zero spends — this becomes the same "empty state" the frontend shows when stepping onto a quiet block, no separate error path needed.
3. Otherwise `rpcView.getSpends(headerHash)` → `classifyBlock(block, cats, media)` → the same `BlockEvent` + `SproutEvent[]` shape already streamed over the WebSocket.
4. Run the NFT sprout events through `contentFilter.enrich(events)` — the *exact* method the live `onBlock` handler uses. No new "cheap-only" variant: cheap signals apply synchronously, and any NFT not yet SafeSearch-checked gets enqueued to `SafeSearchWorker` for a real Vision call, persisted to the store exactly like a live spend. A resulting `sensitive` verdict pushes a `ContentFlagEvent` to all connected clients via the existing `onFlag: (e) => hub.publish([e])` wiring — including anyone currently viewing that block's detail, since the flag travels the normal WebSocket path regardless of how the NFT was first observed.
5. Respond `{ events: GroveEvent[] }` (mirrors `Snapshot`'s shape).

`index.ts` needs light restructuring: `coinsetView(rpc)` and the constructed `contentFilter`/`cats`/`media` instances must be reachable from `buildServer` (or passed into route registration) rather than living only inside the poller's closure.

No caching or rate limiting for v1 — coinset RPC calls are free/public, and the Vision cost exposure is bounded by the store's existing `safesearchChecked` guard (same as live: each launcherId is checked at most once).

## Frontend: Board Detail Mode

`startBoard` gains a mode flag (`live` | `detail`). Live event ingestion into `events`/`displayRows` keeps running in the background regardless of mode, so returning to live is always current — nothing pauses.

- Entering detail mode (height click, find-block submit, or initial `?block=` on load) fetches `/block/<height>`. On success, renders the returned `SproutEvent[]` **unaggregated** — one row per spend, bypassing `toDisplayRows`' XCH/CAT aggregation entirely — into the same `FlapGrid` ledger via the normal riffle path (`instant=false`), the same animated flip used for any live update. Switching between adjacent blocks (prev/next) and toggling live↔detail both riffle rather than snap; reduced-motion still forces instant, as it does everywhere else today.
- `Header` gains a detail variant: block height, that block's own spend count/fees, and a status marker replacing the LIVE/HISTORY text (e.g. `BLOCK DETAIL`) to distinguish it from live scroll-back.
- Detail mode subscribes to `content-flag` events (mirroring the pattern `gallery`/`mine` already use) and patches the matching `launcherId`'s `mediaFilter` in the currently-held block's sprout list, so a late Vision verdict is reflected if the user then clicks that row for its card.
- A small DOM overlay (sibling to the existing detail-card, outside the canvas) provides:
  - `◀ prev` / `next ▶` — steps height ±1 always (no skipping over empty blocks); landing on a quiet block renders an empty ledger with a "no spends this block" line.
  - `return to live` — snaps back to the live ledger at `scrollOffset = 0`, clears `?block=`.
- Loading and fetch-error states render as placeholder ledger text (`LOADING…`, `BLOCK NOT FOUND`) rather than a popup, keeping the whole interaction in the board's own voice.

## Find-Block UI

One small reusable DOM component (text input + submit), mounted near the header, present on both live and detail views. Submitting a height enters detail mode for that block via the same fetch path as a height-click, regardless of current scroll position on the live view.

## Bundled Fix: Live Ledger Content-Flag Patching

Separately from detail mode, `board.ts`'s live event handling currently has no case for `content-flag` in its `feed.onEvent` switch — a late SafeSearch verdict on an already-received live spend never updates that event's `mediaFilter`, so its card (if clicked afterward) can show unfiltered media. This is fixed as part of this work: add a `content-flag` case that finds the matching `launcherId` in `events` and patches `mediaFilter`, mirroring the same handling added for detail mode and the existing pattern in `gallery`/`mine`.

## Data Flow

```
Browser click/find-block/URL load
    ↓ GET /block/:height
Fastify route (server/src/web/)
    ↓
coinsetView.getBlockInfo + getSpends   (server/src/ingest/coinset-view.ts)
    ↓
classifyBlock                          (server/src/classify/classify.ts)
    ↓ GroveEvent[]
contentFilter.enrich (same as live)    (server/src/content-filter/)
    ↓ JSON { events }
board.ts detail mode
    ↓ unaggregated rows, riffled in
FlapGrid ledger + Header (detail variant)
```

Late SafeSearch verdicts continue to flow through the existing `Hub → RingBuffer → WebSocket → GroveFeed → content-flag` path to every connected client, live or detail-viewing alike.

## Testing

- **Server:** unit tests for the new route — valid height with spends, non-transaction/empty block, out-of-range height, invalid `:height` (400), RPC failure. A test that `contentFilter.enrich` is invoked (not a bypassed/cheap-only path).
- **Web:**
  - Unit tests for column-aware hit testing (height-gutter clicks vs. rest-of-row clicks).
  - Unit tests for unaggregated row rendering in detail mode (no `toDisplayRows` aggregation applied).
  - Unit tests for the `content-flag` patch in both live and detail event handling.
  - URL state: entering/leaving detail mode produces the expected `?block=` query string; loading with `?block=` present starts in detail mode.
  - Manual smoke test with `npm run dev:server` + `npm run dev:web`: click a height, step forward/back, find a specific block, reload a shared detail URL, verify a sensitive NFT in a freshly-fetched historical block gets blurred once its (real) SafeSearch check lands.

## Files Touched (expected)

| File                                              | Change                                                                 |
| -------------------------------------------------- | ----------------------------------------------------------------------- |
| `server/src/index.ts`                              | Lift `coinsetView`/`contentFilter`/`cats`/`media` for route access     |
| `server/src/web/server.ts`                         | Register new `/block/:height` route                                    |
| new: `server/src/web/block-lookup.ts` (or similar) | Route handler: validate, fetch, classify, enrich, respond              |
| `web/src/themes/board/board.ts`                    | Mode flag, detail fetch/nav, content-flag patch (live + detail), URL sync |
| `web/src/themes/board/header.ts`                   | Detail-mode header variant                                             |
| `web/src/themes/board/rows.ts`                     | Unaggregated single-block row rendering (reuse `rowText`, skip `toDisplayRows`) |
| new: `web/src/themes/board/find-block.ts` (or similar) | DOM find-block + prev/next/return-to-live overlay component      |
| `web/src/ui/picker.ts`                              | Column-aware height-gutter hit path                                    |
