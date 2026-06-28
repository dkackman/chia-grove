# Google SafeSearch + Extractable Content-Filter Module — Design

**Date:** 2026-06-28
**Status:** Approved (pre-implementation)

## Problem

The content filter (`server/src/classify/content-filter.ts`) currently derives an
NFT's disposition from a single MintGarden lookup, combining structured flags, a
curated denylist, and a text lexicon. We want to add **Google Cloud Vision
SafeSearch** as an additional signal: when the **adult** category is `LIKELY` or
`VERY_LIKELY`, the NFT is marked **sensitive**.

Constraints and goals from the requirements:

1. SafeSearch flags **adult** at `LIKELY`/`VERY_LIKELY` → `sensitive`.
2. Pass the NFT's on-chain **data URI to Google**; we never download the bytes.
3. SafeSearch is **paid and slower**, so it must not block the live event stream.
4. Run it **once per NFT mint** and persist the result in **SQLite** so future
   lookups never re-classify.
5. Design the whole content filter so it can be **lifted into a separate project**
   later with minimal effort.
6. The stream should carry a single `sensitive_content` indication plus **which
   signals fired**; `blocked` stays its own distinct signal.

## Decisions (resolved during brainstorming)

- **Architecture:** _inline cache hit, async cache miss._ Cheap signals (lexicon,
  CHIP-7 `sensitive_content`, MintGarden collection/creator flags + blocks,
  denylist) run **inline** as today. SafeSearch runs **async, out-of-band**, only
  when the cheap verdict is `ok`. Every signal is persisted per `launcherId` in
  SQLite. `blocked` remains a distinct signal from `sensitive`.
- **Separation:** _clean module boundary, same process._ A self-contained
  `server/src/content-filter/` module with a narrow public interface, its own
  SQLite store, importing only `@grove/shared` types and `MediaIndex`.
- **SafeSearch scope:** _only when cheaper signals say `ok`_, only on `mint`
  events with `mediaKind === "image"`. Skips items the cheap signals already
  flagged (no paid second opinion on already-flagged NFTs).
- **SQLite scope:** _unified verdict per NFT_ — final disposition plus per-signal
  provenance and raw SafeSearch likelihoods, keyed by `launcherId`.
- **Async propagation:** a new lightweight `content-flag` event flows through the
  existing Hub → RingBuffer → Snapshot/Batch machinery so live viewers patch the
  on-screen NFT and reconnecting clients replay the patch.
- **Stream shape:** keep `mediaFilter: "blocked" | "sensitive"`; **add**
  `signals?: string[]` for provenance.

### Small implementation calls (baked in)

1. **Vision auth:** REST `images:annotate` with an **API key** (no
   `@google-cloud/vision` SDK) — fewer dependencies, more liftable.
2. **SafeSearch yields only `sensitive`** (adult), never `blocked`. `/img` bytes
   stay reachable for SafeSearch-flagged art; it is only blurred client-side.
   `blocked` remains MintGarden/denylist-only.
3. **`node:sqlite`** (built into Node ≥ 24) over `better-sqlite3` — zero new deps.

## Architecture

```
coinset.org RPC
    ↓
CoinsetPoller (server/src/ingest/)
    ↓ BlockInput
classifyBlock (server/src/classify/classify.ts)   ← pure chain decoding only
    ↓ GroveEvent[]
ContentFilter.enrich()  (server/src/content-filter/)
    ├─ inline: cheap signals (MintGarden fetch → chip7/mg/creator/denylist + lexicon)
    │          → stamp mediaFilter + signals[] on the SproutEvent
    │          → read/write SQLite store (keyed by launcherId)
    └─ async (fire-and-forget): if verdict==ok && mint && image && no prior SafeSearch
               → SafeSearchWorker queue → Vision REST (image.source.imageUri)
               → write store → onFlag(ContentFlagEvent) → hub.publish()
    ↓
Hub + RingBuffer (server/src/web/)
    ↓ WebSocket (JSON)  — sprout (with signals[]) AND later content-flag patches
GroveFeed (web/src/net/feed.ts)
    ↓ dispatch
active Visualization (web/src/themes/)  — markSensitive(launcherId) on the NFT pool
```

### New module — `server/src/content-filter/`

```
server/src/content-filter/
  index.ts              # ContentFilter — the single public class
  types.ts              # ContentInput, Signal, SignalName, Verdict, Disposition
  verdict.ts            # combine signals → { disposition, signals[] } via strongest()
  signals/
    mintgarden.ts       # one fetch → chip7, mintgarden, mintgarden-creator, denylist
    lexicon.ts          # text-keyword heuristic (moved from classify/lexicon.ts)
    denylist.ts         # curated collection denylist (moved from classify/denylist.ts)
    safesearch.ts       # Vision REST call + likelihood→disposition (pure, injected fetch)
  safesearch-worker.ts  # bounded-concurrency async queue
  store.ts              # SQLite (node:sqlite) keyed by launcherId
```

- **Public surface:** `new ContentFilter(media, opts)` and `enrich(events)` —
  the only entry points grove uses. `opts` carries `onFlag`, `googleApiKey`,
  `dbPath`, plus the existing tuning knobs (fetch impl, base URL, timeouts,
  concurrency, budgets, negative-cache TTL, `now`).
- **Isolation:** the module imports only `@grove/shared` and `MediaIndex`. No
  grove internals reach into it. `classify.ts` reverts to pure chain decoding
  (it already only sets `mediaKind`/`launcherId`/`nftId` and registers media).
- The existing `Disposition = "blocked" | "sensitive" | "ok"`, `strongest()`,
  and the negative-cache / bounded-concurrency / budget machinery move with the
  module largely intact.

### `SignalName` taxonomy

The cheap MintGarden fetch yields up to four signals from one HTTP call, plus the
local lexicon. SafeSearch is the fifth, async one:

| SignalName           | Source                                             | Disposition it can raise |
| -------------------- | -------------------------------------------------- | ------------------------ |
| `chip7`              | off-chain metadata `sensitive_content` (via MG)    | sensitive                |
| `mintgarden`         | collection `sensitive_content` / `blocked_content` | sensitive **or** blocked |
| `mintgarden-creator` | creator `verification_state === 2`                 | blocked                  |
| `denylist`           | curated collection-id denylist                     | sensitive or blocked     |
| `lexicon`            | text-keyword heuristic over name/desc              | sensitive                |
| `safesearch`         | Vision adult `LIKELY`/`VERY_LIKELY`                | sensitive                |

`verdict.ts` combines them: `disposition = strongest(...)`, and `signals[]` lists
every signal that fired at `sensitive` or `blocked`.

## Data model — SQLite store

`node:sqlite`, one row per NFT keyed by `launcher_id`:

```sql
CREATE TABLE IF NOT EXISTS nft (
  launcher_id           TEXT PRIMARY KEY,
  nft_id                TEXT,
  disposition           TEXT NOT NULL,          -- 'ok' | 'sensitive' | 'blocked'
  sig_chip7             INTEGER NOT NULL DEFAULT 0,
  sig_mintgarden        INTEGER NOT NULL DEFAULT 0,
  sig_creator           INTEGER NOT NULL DEFAULT 0,
  sig_denylist          INTEGER NOT NULL DEFAULT 0,
  sig_lexicon           INTEGER NOT NULL DEFAULT 0,
  sig_safesearch        INTEGER NOT NULL DEFAULT 0,
  safesearch_adult      TEXT,                   -- raw likelihood string, null if not run
  safesearch_raw_json   TEXT,                   -- full SafeSearch annotation, null if not run
  safesearch_checked_at INTEGER,                -- epoch ms, null if not run
  checked_at            INTEGER NOT NULL        -- epoch ms of last cheap-signal write
);
```

- `store.ts` is the persistent cache that fronts the in-memory map. `resolve()`
  consults the store first; a hit short-circuits the MintGarden fetch.
- `safesearch_checked_at IS NULL` is the "SafeSearch not yet run" sentinel that
  gates the async path (so we run Vision at most once per NFT).
- Tests open `:memory:`.

## Event-stream changes

### `shared/src/index.ts`

```ts
export interface SproutEvent {
  // ...unchanged...
  mediaFilter?: "blocked" | "sensitive";
  signals?: string[]; // NEW: which content-filter signals fired
}

export interface ContentFlagEvent {
  // NEW
  type: "content-flag";
  launcherId: string;
  mediaFilter: "sensitive" | "blocked";
  signals: string[];
}

export type GroveEvent = BlockEvent | SproutEvent | AmbientEvent | ReorgEvent | ContentFlagEvent;

export const PROTOCOL_VERSION = 4; // was 3 — wire format changed
```

`ContentFlagEvent` rides the existing `Snapshot`/`Batch` transport (both carry
`GroveEvent[]`), so no transport change is needed.

### Server

- `index.ts`: `new ContentFilter(media, { onFlag: (e) => hub.publish([e]), googleApiKey, dbPath })`.
  `onBlock` still calls `await contentFilter.enrich(events)`; the cheap path
  resolves within the existing budget, the SafeSearch path is fire-and-forget.
- SafeSearch worker, on a `sensitive` result: write store, then
  `onFlag({ type: "content-flag", launcherId, mediaFilter: "sensitive", signals })`.

### Client

- `feed.ts` / dispatch: `ContentFlagEvent` flows through `onEvent` like any other
  event.
- `web/src/themes/gallery/pieces.ts` and `web/src/themes/mine/structures.ts`:
  add `markSensitive(launcherId)` — find the hung piece via the existing
  `byLauncher` map and swap its texture to `sensitivePlaceholderTexture()`.
- `gallery/index.ts` and `mine/index.ts`: on `content-flag`, call `markSensitive`.
- `web/src/ui/detail-card.ts`: if the card is open on that `launcherId`, re-render
  it as sensitive.
- `board`, `farm`, `grove`: ignore `content-flag` (they don't render NFT art).
- `web/src/net/demo.ts`: optionally emit a delayed `content-flag` for one demo NFT
  to exercise the patch path offline.

## SafeSearch worker

- **Eligibility:** `event.mint && event.mediaKind === "image" && cheapVerdict === "ok"
&& store.safesearch_checked_at IS NULL && googleApiKey present`.
- **Call:** Vision REST `POST https://vision.googleapis.com/v1/images:annotate?key=<API_KEY>`
  with body
  `{ requests: [{ image: { source: { imageUri: <on-chain data URI> } },
   features: [{ type: "SAFE_SEARCH_DETECTION" }] }] }`.
  Google fetches the URI; we never download.
- **Mapping:** `adult ∈ {LIKELY, VERY_LIKELY}` → `sensitive`; else `ok`. The raw
  annotation (all five likelihoods) is persisted for audit.
- **Liveness/cost:** bounded-concurrency gate (reuse the existing pattern) and a
  per-request timeout. Failures/timeouts leave the NFT `ok` and are recorded so
  we don't hammer Vision; a transient failure does not poison the store as a
  permanent `ok` (mirror the existing 404-vs-5xx handling). Because the on-chain
  data URI is the source, the worker reads it from the `SproutEvent`/`MediaIndex`,
  not the client.

## Configuration

| Var                     | Default                        | Effect                                          |
| ----------------------- | ------------------------------ | ----------------------------------------------- |
| `GOOGLE_VISION_API_KEY` | (unset)                        | Enables SafeSearch. Unset ⇒ cheap signals only. |
| `CONTENT_DB_PATH`       | `./data/content-filter.sqlite` | SQLite file path. Persists across restarts.     |

- `.gitignore`: ignore `data/` (or the db path). The droplet retains the file
  across deploys; systemd working dir must allow writes.
- CLAUDE.md: update the env table and the "Server internals" / architecture
  sections to describe the new module and the two-tier flow.

## Error handling

- **Cheap path** keeps current semantics: 404 → cacheable `ok`; 5xx/429 →
  transient, negatively cached briefly; malformed → permissive `ok`.
- **SafeSearch** never blocks publish; on any failure the NFT stays `ok` and the
  store records the attempt to avoid repeated paid calls within a TTL.
- **SQLite** open/IO failure degrades to in-memory-only operation (log + carry on)
  rather than crashing ingest.
- **content-flag** for an unknown/no-longer-rendered `launcherId` is a no-op on
  the client.

## Testing

- `signals/safesearch.ts`: likelihood→disposition mapping and request shaping with
  an injected `fetch` (no network).
- `signals/mintgarden.ts`: decomposition of one MintGarden JSON into the correct
  set of `SignalName`s (port + extend existing `content-filter.test.ts`).
- `verdict.ts`: `strongest()` combination and `signals[]` assembly, incl.
  blocked-wins-over-sensitive and multi-signal cases.
- `store.ts`: round-trip read/write, the SafeSearch-not-run sentinel, and cache
  short-circuit, against `:memory:`.
- `ContentFilter.enrich`: cheap-inline stamping, async eligibility gating, and
  `onFlag` emission with an injected worker/fetch and a fake clock.
- Client: `content-flag` dispatch → `markSensitive` swaps the texture; an unknown
  launcher is a no-op.

## Out of scope / YAGNI

- No separate service/process now (clean module boundary only).
- No SafeSearch on video/audio/HTML media (Vision SafeSearch is image-only).
- No re-classification scheduling/backfill of historical NFTs (lazy on next mint/
  spend).
- No second-opinion SafeSearch on already-flagged NFTs.

```

```
