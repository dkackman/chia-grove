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
npm run start        # production server (serves web/dist/ + WebSocket)
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
active Visualization  (web/src/themes/)
```

New WebSocket clients first receive a `Hello` handshake (protocol version check), then a `Snapshot` of the last 10,000 events from `RingBuffer`, drained at 60 events/frame by `DrainQueue` (~3 s at 60 fps). After that, events stream live as `Batch` messages.

### Server internals

- `CoinsetPoller` polls `coinset.org` on `POLL_INTERVAL_MS` (default 3 s). It calls `coinsetView` which wraps `chia-wallet-sdk`'s `RpcClient`.
- `classifyBlock` uses `chia-wallet-sdk`'s `Clvm` + `puzzle.parseNft/parseCat/parseDid` to classify every `CoinSpend` into a `SproutEvent`. Launcher-hash spends are skipped (they become the `mint` flag on child spends).
- `CatRegistry` fetches the full CAT list from `api.dexie.space` on start and refreshes hourly. It enriches CAT sprout events with `catName`, `catTicker`, and `catIconUrl`.
- NFT art is never sent to the client as a URL. `classifyBlock` records each NFT's on-chain art URL in a bounded `MediaIndex` (`server/src/web/media-index.ts`, keyed by NFT `launcherId`); the `SproutEvent` carries only a `mediaKind` hint. The `/img` proxy resolves `?nft=<launcherId>` through `MediaIndex` (404 unknown, 400 disallowed) so it can never fetch an arbitrary client-supplied URL. launcherId keys are stable across spends, so the proxy URL caches well.
- `Hub` handles backpressure: sockets above 1 MB buffered are terminated; ambient events are dropped for sockets above 64 KB.
- The `/healthz` GET endpoint returns `{ ok, appVersion, gitSha, protocolVersion }` — used by deploy health checks.

### Web/scene internals

- The frontend supports multiple visualizations ("themes") behind the `Visualization` interface (`web/src/themes/types.ts`). The registry in `web/src/themes/index.ts` resolves the active theme from `?theme=` query param or `localStorage["grove.theme"]` (default: `grove`). Switching from the legend persists the choice and reloads; the WebSocket snapshot replay repopulates the new scene. Themes own their entire Three.js scene. Five themes ship: `grove`, `farm`, `gallery`, `mine`, `board`. Shared helpers (instancing, textures, CAT colors, amount scales, PRNG) live in `web/src/themes/shared/`.

- **`InstancedKind`** (`web/src/themes/shared/instanced.ts`) is the shared `THREE.InstancedMesh` wrapper used by all themes. Key details:
  - Constructor accepts `THREE.Material | THREE.Material[]` (array enables per-face BoxGeometry materials).
  - `mesh.count` starts at 0 and grows as `plant()` is called — large caps (e.g. 6 000 for terrain) are cheap until filled.
  - `Pose` has an optional `y?: number` for vertical offset (used by mine for terrain elevation).
  - `clearWhere(predicate)` zeroes matching slots by scale-0 matrix — used for reorg culling without a full clear.
  - `boundsRadius` / `boundsCenterY` constructor params pin the bounding sphere so raycasting works before the spiral fills out.

- **grove** (`web/src/themes/grove/`): bioluminescent night meadow.
  - `grove.ts` owns the Three.js renderer, camera orbit, and event dispatch. It exposes setter hooks (`setSproutHandler`, `setAmbientHandler`, etc.) wired by the theme's `start()` to `FloraSystem` and `Fireflies`.
  - `FloraSystem` (`themes/grove/flora.ts`) uses `THREE.InstancedMesh` for performance. Each kind (grass, mushroom, bloom, wisp) has 3 geometry variants and a fixed slot cap: grass 800, mushroom 140, bloom 40, wisp 80. Slots wrap (oldest overwritten).
  - `layout.ts` places blocks on a phyllotaxis (sunflower-seed) spiral. Within each block's cluster, `sproutOffset` uses `mulberry32` seeded from the coin id for deterministic, stable scatter.
  - `palette.ts` provides scene colors; CAT asset colors are hashed into one of 12 bioluminescent hues by `themes/shared/cat-color.ts`.
  - `sky.ts` scales moonlight with netspace and pulses on new blocks.

- **farm** (`web/src/themes/farm/`): daytime crop field with serpentine rows. Each block is the next row, plowed by a tractor in alternating directions; crops sprout behind it (wheat=XCH, gourd=CAT, sunflower=NFT, scarecrow=DID). Chickens=mempool, sun brightness=netspace, crows=reorg. `CropSystem` uses `InstancedKind` with 3 geometry variants each; slot caps: wheat 800, gourd 300, sunflower 40, scarecrow 80. Slots wrap (oldest overwritten).

- **gallery** (`web/src/themes/gallery/`): interior art gallery showing NFT mints as framed canvases on illuminated walls. Navigate with arrow keys (desktop) or swipe (mobile). Spotlight warmth tracks netspace; lights pulse on new blocks; reorg removes pieces. Non-NFT events are ignored.

- **mine** (`web/src/themes/mine/`): Minecraft-inspired voxel island growing on a phyllotaxis spiral. XCH spends pave grass/dirt land; CATs become color-and-material voxel blocks (family + dye hashed from assetId); NFTs become framed paintings (clickable → MintGarden); DIDs become villager figures. Rim torches track mempool; 150 s day-night cycle scales with netspace; mints fire beacon beams; reorg triggers a creeper burst. Terrain is persistent (keyed by block-slot index); only activity-layer specials churn.
  - `island.ts` — `Island` class: persistent grass/dirt instanced terrain (6-material per-face grass blocks, 6 000-slot caps, build-to-stable via `Map<number, ChunkGround>`).
  - `cats.ts` — `CatBlocks`: 3 `InstancedKind` families (opaque wool, transparent glass, emissive glowstone); slot caps opaque 2000 / transparent 600 / emissive 400; 600-per-block budget caps airdrop bursts. Uses `resolveCatBlock()` from `material.ts` for family + dye assignment.
  - `material.ts` — `resolveCatBlock()`: maps a CAT `assetId` hash to a `CatFamily`, material name, and dye color. Separated from `cats.ts` so material logic is independently testable.
  - `water.ts` — translucent ocean plane (GPU vertex wave shader) the island sits in; `WATER_LEVEL` constant used by terrain to align shoreline.
  - `structures.ts` — `Villagers` (80-cap pool mesh, pop-in scale animation) + `Paintings` (40-cap, launcher-id–proxied NFT art via `gallery/media.ts` + `ui/media.ts` (`mediaSrc`)).
  - `vfx.ts` — `Vfx`: beacon columns, rim torches, creeper-burst particle system (frame-rate-independent via real `dt`).
  - `sky.ts` — pure functions for 150 s day-night cycle; `createMineSky()` drives sun + moon `DirectionalLight` and `FogExp2`.
  - `textures.ts` — procedural 16×16 `NearestFilter` pixel textures (wool weave, glass pane, glowstone cells, grass top/side, dirt).
  - `layout.ts` — `chunkPosition()` phyllotaxis spiral, 7×7 Chebyshev-ordered floor grid, `seatCell()` stack-not-sprawl seating, `chunkElevation()` deterministic terrain height (max 1 block).

- **board** (`web/src/themes/board/`): "The Big Board" — a Solari split-flap departure board rendering the chain as a live spend ledger. Each spend flips in as a new row (per-character riffle via `FlapGrid`, an instanced cell grid with a per-instance glyph attribute); a header strip shows block/mempool/netspace/clock, a side tile shows the latest NFT mint's art, and reorg riffles rows back to the fork height. Pure formatting (`rows.ts`, `glyphs.ts`, `palette.ts`) is unit-tested.

### Event types (`shared/src/index.ts`)

| Type           | When emitted                                         |
| -------------- | ---------------------------------------------------- |
| `BlockEvent`   | Every new block                                      |
| `SproutEvent`  | Every classified coin spend                          |
| `AmbientEvent` | Each poll cycle (mempool, netspace)                  |
| `ReorgEvent`   | Chain reorg detected                                 |
| `Hello`        | First message on every connection (protocol version) |
| `Snapshot`     | Sent after `Hello` on connect (full ring buffer)     |
| `Batch`        | Live streaming: one or more events per frame         |

### Environment variables (server)

| Var                | Default |
| ------------------ | ------- |
| `PORT`             | `8080`  |
| `POLL_INTERVAL_MS` | `3000`  |
| `BACKFILL_BLOCKS`  | `150`   |

## Deployment

The app deploys to an Ubuntu droplet as a systemd service (`deploy/chia-grove.service`) with Caddy handling SSL termination for `chia-grove.com` and `chia-grove.kackman.net` (`deploy/Caddyfile`). `deploy/deploy.sh <user@host>` syncs the repo and restarts the service.
