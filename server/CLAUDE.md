# server/

Node/Fastify process that polls the Chia blockchain, classifies coin spends, filters content, and serves the frontend over WebSocket.

## Internals

- **`CoinsetPoller`** (`src/ingest/`) polls `coinset.org` on `POLL_INTERVAL_MS` (default 3 s) via `coinsetView`, which wraps `chia-wallet-sdk`'s `RpcClient`.

- **`classifyBlock`** (`src/classify/classify.ts`) uses `chia-wallet-sdk`'s `Clvm` + `puzzle.parseNft/parseCat/parseDid` to classify every `CoinSpend` into a `SproutEvent`. Launcher-hash spends are skipped (they become the `mint` flag on child spends).

- **`CatRegistry`** fetches the full CAT list from `api.dexie.space` on start and refreshes hourly. It enriches CAT sprout events with `catName`, `catTicker`, and `catIconUrl`.

- **`MediaIndex`** (`src/web/media-index.ts`) records each NFT's on-chain art URL keyed by `launcherId`. NFT art is never sent to the client as a URL — `SproutEvent` carries only a `mediaKind` hint. The `/img` proxy resolves `?nft=<launcherId>` through `MediaIndex` (404 unknown, 400 disallowed) so it can never fetch an arbitrary client-supplied URL. launcherId keys are stable across spends, so the proxy URL caches well.

- **ContentFilter** (`src/content-filter/`) is a self-contained module (importing only `@grove/shared` types and `MediaIndex`) designed to be liftable into a separate project. Two tiers:
  1. _Cheap signals_ inline — lexicon, CHIP-7 `sensitive_content` flag, MintGarden collection/creator flags, curated denylist — stamps `mediaFilter` and `signals?: string[]` on NFT `SproutEvent`s immediately.
  2. _Google Vision SafeSearch_ async/out-of-band — for any image NFT spend whose cheap verdict was `ok` and that hasn't yet been SafeSearch-checked (`safesearchChecked` store flag ensures each `launcherId` is checked at most once). adult LIKELY/VERY_LIKELY → `sensitive`. SafeSearch never downloads image bytes; Google fetches the on-chain URI directly via `image.source.imageUri`. Verdicts persist per `launcherId` in `store.ts` (SQLite via Node's built-in `node:sqlite`). A late verdict is pushed to clients as a `ContentFlagEvent` via Hub→RingBuffer.
  - `GOOGLE_VISION_API_KEY` unset disables SafeSearch (cheap signals still run). `CONTENT_DB_PATH` controls the SQLite path.

- **`Hub`** handles backpressure: sockets above 1 MB buffered are terminated; ambient events are dropped for sockets above 64 KB.

- **`/healthz`** GET endpoint returns `{ ok, appVersion, gitSha, protocolVersion }` — used by deploy health checks.

## Environment variables

| Var                     | Default                        | Notes                                                 |
| ----------------------- | ------------------------------ | ----------------------------------------------------- |
| `PORT`                  | `8080`                         |                                                       |
| `POLL_INTERVAL_MS`      | `3000`                         |                                                       |
| `BACKFILL_BLOCKS`       | `150`                          |                                                       |
| `GOOGLE_VISION_API_KEY` | (unset)                        | Enables Vision SafeSearch; unset = cheap signals only |
| `CONTENT_DB_PATH`       | `./data/content-filter.sqlite` | SQLite verdict store path                             |

## Tests

```sh
npm test                                          # all server tests
npx vitest run server/test/classify.test.ts      # single file
```
