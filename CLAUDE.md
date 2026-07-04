# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Workspaces

This is an npm workspaces monorepo with three packages. Each has its own `CLAUDE.md` with detailed internals:

- **[`shared/`](shared/CLAUDE.md)** — TypeScript event types only (`@grove/shared`). No build step; both server and web import `.ts` source directly.
- **[`server/`](server/CLAUDE.md)** — Node/Fastify process that polls the Chia blockchain and serves the frontend.
- **[`web/`](web/CLAUDE.md)** — Three.js browser app that renders the 3D scene (five themes: grove, farm, gallery, mine, board).

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

Requires Node ≥ 24. Server runs via `tsx` (no build step needed for development).

## Data Flow

```
coinset.org RPC
    ↓
CoinsetPoller  (server/src/ingest/)
    ↓ BlockInput
classifyBlock  (server/src/classify/classify.ts)
    ↓ GroveEvent[]
ContentFilter  (server/src/content-filter/)
    ↓ cheap signals stamp NFT SproutEvents with mediaFilter + signals[] inline
    ↓ async SafeSearch (image NFT spends, cheap verdict ok, not yet checked) → ContentFlagEvent
Hub + RingBuffer  (server/src/web/)
    ↓ WebSocket (JSON)
GroveFeed  (web/src/net/feed.ts)
    ↓ GroveEvent dispatch
active Visualization  (web/src/themes/)
```

New WebSocket clients first receive a `Hello` handshake (protocol version check), then a `Snapshot` of the last 10,000 events from `RingBuffer`, drained at 120 events/frame by `DrainQueue` (~1.5 s at 60 fps). After that, events stream live as `Batch` messages.

## Deployment

The app deploys to an Ubuntu droplet as a systemd service (`deploy/chia-grove.service`) with Caddy handling SSL termination for `chia-grove.com` and `chia-grove.kackman.net` (`deploy/Caddyfile`). `deploy/deploy.sh <user@host>` syncs the repo and restarts the service.
