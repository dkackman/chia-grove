# AGENTS.md

Guidance for AI coding agents (Copilot, Codex, etc.) working in this repository.

## Build & Verify

Always run these before marking work complete:

```sh
npm run typecheck   # must pass — no type errors
npm test            # vitest across server/test/ and web/test/
npm run lint        # ESLint 10 flat config
```

## Repository Layout

npm workspaces monorepo. Three packages:

- `shared/` — event type definitions only, imported as `@grove/shared`
- `server/` — Node/Fastify backend (TypeScript via `tsx`, no compile step)
- `web/` — Vite + Three.js frontend

The `shared` package has no build step; both `server` and `web` import its `.ts` source directly via path aliases.

## Key Constraints

- **Node ≥ 24** required (`engines` in `package.json`; the server relies on native `fetch` and the built-in `node:sqlite`).
- All packages are `"type": "module"`. Use `.js` extensions on local imports (even for `.ts` source files), e.g. `import { foo } from "./bar.js"`.
- Do not add a build/compile step to `server` or `shared` — they run source TypeScript via `tsx`.
- The `web` package builds with Vite; don't add a separate `tsc` build there.
- Tests live in `server/test/` and `web/test/`, picked up by the root `vitest.config.ts`.

## Code Style

- Prettier 3 (`.prettierrc`): double quotes, semicolons, 100-char print width, trailing commas (es5).
- No comments unless the _why_ is non-obvious. No docstrings.
- Unused vars are a lint error unless prefixed with `_`.

## Shared Event Types

All WebSocket messages conform to `WireMessage` in `shared/src/index.ts`. The union is `Hello | Snapshot | Batch`; `Snapshot` and `Batch` carry `GroveEvent[]`. Do not add fields to existing event types without updating both the server emitter and the web consumer.

## Scene Performance

All themes use `InstancedKind` (`web/src/themes/shared/instanced.ts`) — a `THREE.InstancedMesh` wrapper with fixed slot caps and wrap-around ring assignment (oldest slot overwritten). Never use individual `THREE.Mesh` per sprout/block/coin.

Key `InstancedKind` behaviours to be aware of when modifying themes:

- Constructor accepts `THREE.Material | THREE.Material[]`. Array form enables per-face `BoxGeometry` materials (used by the mine theme's grass blocks).
- `mesh.count` starts at 0 and increments on each `plant()` call. Allocate large caps (thousands) without GPU cost — only planted slots are drawn.
- `Pose.y` (optional) sets a vertical offset per-instance (mine uses it for terrain elevation).
- `clearWhere(predicate)` zeroes matching instances via scale-0 matrix without a full buffer clear — use it for reorg culling.
- `boundsRadius` / `boundsCenterY` constructor params fix the bounding sphere so raycasting works before the spiral is populated.

Each theme sets its own cap constants: `CAPS` in `grove/flora.ts`, `farm/crops.ts` and `mine/cats.ts`; `GRASS_CAP`/`DIRT_CAP` (persistent terrain) in `mine/island.ts`; `SPECIAL_BUDGET` (per-block CAT budget) in `mine/cats.ts`; `PAINTING_CAP`/`VILLAGER_CAP` in `mine/structures.ts`.

## Testing Without a Server

Pass `?demo=1` in the URL to activate synthetic event generation (`web/src/net/demo.ts`) — no server or network required.
