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

- **Node ≥ 24** required (uses `--experimental-vm-modules` path in vitest, native `fetch`, etc.).
- All packages are `"type": "module"`. Use `.js` extensions on local imports (even for `.ts` source files), e.g. `import { foo } from "./bar.js"`.
- Do not add a build/compile step to `server` or `shared` — they run source TypeScript via `tsx`.
- The `web` package builds with Vite; don't add a separate `tsc` build there.
- Tests live in `server/test/` and `web/test/`, picked up by the root `vitest.config.ts`.

## Code Style

- Prettier 3 (`.prettierrc`): double quotes, semicolons, 100-char print width, trailing commas (es5).
- No comments unless the _why_ is non-obvious. No docstrings.
- Unused vars are a lint error unless prefixed with `_`.

## Shared Event Types

All WebSocket messages conform to `WireMessage` in `shared/src/index.ts`. The union is `GroveEvent | Snapshot`. Do not add fields to existing event types without updating both the server emitter and the web consumer.

## Scene Performance

`FloraSystem` uses `THREE.InstancedMesh` with fixed slot caps. If adding a new plant kind, define a cap constant alongside the others in `flora.ts` and implement wrap-around slot assignment (oldest slot overwritten). Do not use individual `THREE.Mesh` per sprout.

## Testing Without a Server

Pass `?demo=1` in the URL to activate synthetic event generation (`web/src/net/demo.ts`) — no server or network required.
