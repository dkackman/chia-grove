# server/

Node/Fastify process that polls the Chia blockchain, classifies coin spends, filters content, and serves the frontend over WebSocket.

## Internals

- **`CoinsetPoller`** (`src/ingest/`) polls `coinset.org` on `POLL_INTERVAL_MS` (default 10 s) via `coinsetView`, which wraps `chia-wallet-sdk`'s `RpcClient`. Each tick first tries a direct `getBlockRecordByHeight` lookup for the next height (`tryGetBlockInfo`, the poller's "fast forward" path) and only falls back to `getBlockchainState` when that height isn't mined yet — this elides most `getBlockchainState` calls, since blocks land roughly every 18.75s. Set `LOG_LEVEL=debug` to see per-call method/args/latency logging from `coinsetView`.

- **`classifyBlock`** (`src/classify/classify.ts`) uses `chia-wallet-sdk`'s `Clvm` + `puzzle.parseNft/parseCat/parseDid` to classify every `CoinSpend` into a `SproutEvent`. Launcher-hash spends are skipped (they become the `mint` flag on child spends).

- **`CatRegistry`** fetches the full CAT list from `api.dexie.space` on start and refreshes hourly. It enriches CAT sprout events with `catName`, `catTicker`, and `catIconUrl`.

- **`MediaIndex`** (`src/web/media-index.ts`) records each NFT's on-chain art URL keyed by `launcherId`. NFT art is never sent to the client as a URL — `SproutEvent` carries only a `mediaKind` hint. The `/img` proxy resolves `?nft=<launcherId>` through `MediaIndex` (404 unknown, 400 disallowed) so it can never fetch an arbitrary client-supplied URL. launcherId keys are stable across spends, so the proxy URL caches well.

- **ContentFilter** (`src/content-filter/`) is a self-contained module (importing only `@grove/shared` types and `MediaIndex`) designed to be liftable into a separate project. Two tiers:
  1. _Cheap signals_ inline — lexicon, CHIP-7 `sensitive_content` flag, MintGarden collection/creator flags, curated denylist, curated collection allow-list (`signals/whitelist.ts`, matched by creator DID **or** collection id) — stamps `mediaFilter` on NFT `SproutEvent`s immediately. The allow-list never overrides a blocked/sensitive signal; a match only skips the Vision SafeSearch tier below for known-safe collections.
  2. _Google Vision SafeSearch_ async/out-of-band — for any image or video NFT spend whose cheap verdict was `ok` and that hasn't yet been SafeSearch-checked (`safesearchChecked` store flag ensures each `launcherId` is checked at most once; `content_hash` and `checked_uri` lookups additionally reuse a prior verdict across distinct NFTs sharing identical bytes, so the paid Vision call runs once per unique content). Images are classified by their art URL; videos by their static poster (best-effort — Vision can't decode video frames, and a video with no resolved thumbnail is skipped). URLs on MintGarden's ingestion-lagged CDNs (archive content, assets-CDN posters) are readiness-probed first via HEAD; on exhaustion, images fall back to one Vision attempt against the on-chain original URL (skipping hosts Google can't reach). A periodic sweep (`SAFESEARCH_SWEEP_INTERVAL_MS`) re-attempts still-unchecked NFTs in MediaIndex so verdicts don't depend on re-spends. adult LIKELY/VERY_LIKELY → `sensitive`. SafeSearch never downloads image bytes; Google fetches the URI directly via `image.source.imageUri`. Verdicts persist per `launcherId` in `store.ts` (SQLite via Node's built-in `node:sqlite`); failures are fail-open (render permissive) with in-memory backoff only — a deliberate, signed-off policy for a visualizer, not an oversight; see the header comment in `src/content-filter/index.ts` before reusing this module anywhere fail-open is wrong. A late verdict is pushed to clients as a `ContentFlagEvent` via Hub→RingBuffer.
  - `GOOGLE_VISION_API_KEY` unset disables SafeSearch (cheap signals still run). `CONTENT_DB_PATH` controls the SQLite path.
  - _Local NSFW pre-classifier_ (`signals/nsfw-preprocess.ts`, `signals/nsfw-infer.ts`, `signals/local-nsfw-runtime.ts`) — a self-hosted opennsfw2 model (`server/models/opennsfw2.onnx`, Apache 2.0; see `server/models/convert_opennsfw2_to_onnx.py` for how it was converted from the original Keras weights) run via `onnxruntime-node`, with `sharp` replicating opennsfw2's preprocessing (resize/crop/BGR-mean-subtract — parity-tested against a Python-generated fixture in `server/test/fixtures/`, since sharp and PIL's resize kernels aren't bit-identical). Decoupled from Vision: with no `GOOGLE_VISION_API_KEY` it runs standalone (observability only, logs `local-nsfw standalone result`); with a key set it runs in shadow mode alongside every Vision call and logs a comparison (`local-nsfw shadow comparison`) instead. By default neither mode changes the persisted verdict — `signals/local-nsfw.ts` has the clean/nsfw/uncertain thresholds (`localNsfwCleanBelow`/`localNsfwNsfwAbove`, both `ContentFilterOptions`). Setting `LOCAL_NSFW_ENFORCE_CLEAN=true` promotes it to an actual gate: a confident-clean local score (`band === "clean"`) skips Vision entirely and persists ok/checked directly (logged as `local-nsfw enforced clean`) — uncertain/nsfw scores are unaffected and still go to Vision, so only "clean" is ever decided locally. `LOCAL_NSFW_MODEL_PATH` unset disables the classifier entirely; when set, the path is resolved relative to the server process's cwd (`server/`), e.g. `./models/opennsfw2.onnx`.

- **`Hub`** handles backpressure: sockets above 1 MB buffered are terminated; ambient events are dropped for sockets above 64 KB.

- **`/healthz`** GET endpoint returns `{ ok, appVersion, gitSha, protocolVersion }` — used by deploy health checks.

## Environment variables

| Var                            | Default                        | Notes                                                                 |
| ------------------------------ | ------------------------------ | --------------------------------------------------------------------- |
| `PORT`                         | `8080`                         |                                                                       |
| `POLL_INTERVAL_MS`             | `10000`                        |                                                                       |
| `BACKFILL_BLOCKS`              | `150`                          |                                                                       |
| `GOOGLE_VISION_API_KEY`        | (unset)                        | Enables Vision SafeSearch; unset = cheap signals only                 |
| `CONTENT_DB_PATH`              | `./data/content-filter.sqlite` | SQLite verdict store path                                             |
| `SAFESEARCH_SWEEP_INTERVAL_MS` | `600000`                       | Re-check cadence for still-unchecked NFTs in MediaIndex; `0` disables |
| `LOCAL_NSFW_MODEL_PATH`        | (unset)                        | Enables local NSFW pre-classification (standalone or shadow mode)     |
| `LOCAL_NSFW_ENFORCE_CLEAN`     | (unset)                        | `true` promotes confident-clean local scores to skip Vision entirely  |
