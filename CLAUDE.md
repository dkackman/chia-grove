# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```sh
npm install          # install all workspaces
npm run dev:server   # ingest + WebSocket server on :8080 (needs network)
npm run dev:web      # Vite dev server on :5173, proxies /ws to :8080
npm test             # vitest across server/test/ and web/test/
npm run typecheck    # tsc across all three workspaces
npm run lint         # ESLint 10 (flat config, eslint.config.js)
npm run format       # Prettier 3 write
npm run build        # production Vite bundle → web/dist/
```

Run a single test file: `npx vitest run server/test/classify.test.ts`

Open `http://localhost:5173/?demo=1` for synthetic events without a running server.

Requires Node ≥ 24. Server runs via `tsx` (no build step needed for development).

## Architecture

This is an npm workspaces monorepo with three packages:

- **`shared/`** — TypeScript event types only (`@grove/shared`). Consumed by both server and web. No build step; both import the `.ts` source directly.
- **`server/`** — Node/Fastify process that polls the Chia blockchain and serves the frontend.
- **`web/`** — Three.js browser app that renders the 3D scene.

### Data Flow

```
coinset.org RPC
    ↓
CoinsetPoller  (server/src/ingest/)
    ↓ BlockInput
classifyBlock  (server/src/classify/classify.ts)
    ↓ GroveEvent[]
Hub + RingBuffer  (server/src/web/)
    ↓ WebSocket (JSON)
GroveFeed  (web/src/net/feed.ts)
    ↓ GroveEvent dispatch
grove.ts / flora.ts / fireflies.ts  (web/src/scene/)
```

New WebSocket clients receive a `Snapshot` of the last 500 events from `RingBuffer`, replayed over ~3 seconds by `GroveFeed.replay()`. After that, events stream live.

### Server internals

- `CoinsetPoller` polls `coinset.org` on `POLL_INTERVAL_MS` (default 3 s). It calls `coinsetView` which wraps `chia-wallet-sdk`'s `RpcClient`.
- `classifyBlock` uses `chia-wallet-sdk`'s `Clvm` + `puzzle.parseNft/parseCat/parseDid` to classify every `CoinSpend` into a `SproutEvent`. Launcher-hash spends are skipped (they become the `mint` flag on child spends).
- `CatRegistry` fetches the full CAT list from `api.dexie.space` on start and refreshes hourly. It enriches CAT sprout events with `catName`, `catTicker`, and `catIconUrl`.
- `Hub` handles backpressure: sockets above 1 MB buffered are terminated; ambient events are dropped for sockets above 64 KB.

### Web/scene internals

- `grove.ts` owns the Three.js renderer, camera orbit, and event dispatch. It exposes setter hooks (`setSproutHandler`, `setAmbientHandler`, etc.) that `main.ts` wires to `FloraSystem` and `Fireflies`.
- `FloraSystem` (`scene/flora.ts`) uses `THREE.InstancedMesh` for performance. Each kind (grass, mushroom, bloom, wisp) has 3 geometry variants and a fixed slot cap: grass 800, mushroom 140, bloom 40, wisp 80. Slots wrap (oldest overwritten).
- `layout.ts` places blocks on a phyllotaxis (sunflower-seed) spiral. Within each block's cluster, `sproutOffset` uses `mulberry32` seeded from the coin id for deterministic, stable scatter.
- `palette.ts` assigns persistent CAT colors by hashing the asset id into one of 12 bioluminescent hues.
- `sky.ts` scales moonlight with netspace and pulses on new blocks.

### Event types (`shared/src/index.ts`)

| Type | When emitted |
|------|-------------|
| `BlockEvent` | Every new block |
| `SproutEvent` | Every classified coin spend |
| `AmbientEvent` | Each poll cycle (mempool, netspace) |
| `ReorgEvent` | Chain reorg detected |
| `Snapshot` | Sent once on WebSocket connect |

### Environment variables (server)

| Var | Default |
|-----|---------|
| `PORT` | `8080` |
| `POLL_INTERVAL_MS` | `3000` |
| `BACKFILL_BLOCKS` | `30` |

## Deployment

The app deploys to an Ubuntu droplet as a systemd service (`deploy/chia-grove.service`) with Caddy handling SSL termination for `chia-grove.com` and `chia-grove.kackman.net` (`deploy/Caddyfile`). `deploy/deploy.sh <user@host>` syncs the repo and restarts the service.
