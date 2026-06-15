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
active Visualization  (web/src/themes/)
```

New WebSocket clients receive a `Snapshot` of the last 2000 events from `RingBuffer`, replayed over ~3 seconds by `GroveFeed.replay()`. After that, events stream live.

### Server internals

- `CoinsetPoller` polls `coinset.org` on `POLL_INTERVAL_MS` (default 3 s). It calls `coinsetView` which wraps `chia-wallet-sdk`'s `RpcClient`.
- `classifyBlock` uses `chia-wallet-sdk`'s `Clvm` + `puzzle.parseNft/parseCat/parseDid` to classify every `CoinSpend` into a `SproutEvent`. Launcher-hash spends are skipped (they become the `mint` flag on child spends).
- `CatRegistry` fetches the full CAT list from `api.dexie.space` on start and refreshes hourly. It enriches CAT sprout events with `catName`, `catTicker`, and `catIconUrl`.
- `Hub` handles backpressure: sockets above 1 MB buffered are terminated; ambient events are dropped for sockets above 64 KB.

### Web/scene internals

- The frontend supports multiple visualizations ("themes") behind the `Visualization` interface (`web/src/themes/types.ts`). The registry in `web/src/themes/index.ts` resolves the active theme from `?theme=` query param or `localStorage["grove.theme"]` (default: `grove`). Switching from the legend persists the choice and reloads; the WebSocket snapshot replay repopulates the new scene. Themes own their entire Three.js scene. Four themes ship: `grove`, `farm`, `gallery`, `mine`. Shared helpers (instancing, textures, CAT colors, amount scales, PRNG) live in `web/src/themes/shared/`.

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
  - `cats.ts` — `CatBlocks`: 3 `InstancedKind` families (opaque wool, transparent glass, emissive glowstone), 192-per-block budget, shared `nextSeat()` across specials.
  - `structures.ts` — `Villagers` (80-cap pool mesh, pop-in scale animation) + `Paintings` (40-cap, CORS-proxied NFT art via `gallery/media.ts`).
  - `vfx.ts` — `Vfx`: beacon columns, rim torches, creeper-burst particle system (frame-rate-independent via real `dt`).
  - `sky.ts` — pure functions for 150 s day-night cycle; `createMineSky()` drives sun + moon `DirectionalLight` and `FogExp2`.
  - `textures.ts` — procedural 16×16 `NearestFilter` pixel textures (wool weave, glass pane, glowstone cells, grass top/side, dirt).
  - `layout.ts` — `chunkPosition()` phyllotaxis spiral, 7×7 Chebyshev-ordered floor grid, `seatCell()` stack-not-sprawl seating, `chunkElevation()` deterministic terrain height (max 1 block).

### Event types (`shared/src/index.ts`)

| Type           | When emitted                        |
| -------------- | ----------------------------------- |
| `BlockEvent`   | Every new block                     |
| `SproutEvent`  | Every classified coin spend         |
| `AmbientEvent` | Each poll cycle (mempool, netspace) |
| `ReorgEvent`   | Chain reorg detected                |
| `Snapshot`     | Sent once on WebSocket connect      |

### Environment variables (server)

| Var                | Default |
| ------------------ | ------- |
| `PORT`             | `8080`  |
| `POLL_INTERVAL_MS` | `3000`  |
| `BACKFILL_BLOCKS`  | `150`   |

## Deployment

The app deploys to an Ubuntu droplet as a systemd service (`deploy/chia-grove.service`) with Caddy handling SSL termination for `chia-grove.com` and `chia-grove.kackman.net` (`deploy/Caddyfile`). `deploy/deploy.sh <user@host>` syncs the repo and restarts the service.
