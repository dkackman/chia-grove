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

All themes use `InstancedKind` (`web/src/themes/shared/instanced.ts`) — a `THREE.InstancedMesh` wrapper with fixed slot caps and wrap-around ring assignment (oldest slot overwritten). Never use individual `THREE.Mesh` per sprout/block/coin.

Key `InstancedKind` behaviours to be aware of when modifying themes:

- Constructor accepts `THREE.Material | THREE.Material[]`. Array form enables per-face `BoxGeometry` materials (used by the mine theme's grass blocks).
- `mesh.count` starts at 0 and increments on each `plant()` call. Allocate large caps (thousands) without GPU cost — only planted slots are drawn.
- `Pose.y` (optional) sets a vertical offset per-instance (mine uses it for terrain elevation).
- `clearWhere(predicate)` zeroes matching instances via scale-0 matrix without a full buffer clear — use it for reorg culling.
- `boundsRadius` / `boundsCenterY` constructor params fix the bounding sphere so raycasting works before the spiral is populated.

Each theme sets its own cap constants. Grove: grass 800, mushroom 140, bloom 40, wisp 80. Farm: wheat 800, gourd 300, sunflower 40, scarecrow 80. Mine: grass/dirt 6 000 each (persistent terrain), CAT blocks 192 per-block budget, paintings 40, villagers 80.

## Testing Without a Server

Pass `?demo=1` in the URL to activate synthetic event generation (`web/src/net/demo.ts`) — no server or network required.

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **chia-grove** (2972 symbols, 7801 relationships, 217 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> Index stale? Run `node .gitnexus/run.cjs analyze` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? `npx gitnexus analyze` (npm 11 crash → `npm i -g gitnexus`; #1939).

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows. For regression review, compare against the default branch: `detect_changes({scope: "compare", base_ref: "main"})`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `query({search_query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method without first running `impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit changes without running `detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/chia-grove/context` | Codebase overview, check index freshness |
| `gitnexus://repo/chia-grove/clusters` | All functional areas |
| `gitnexus://repo/chia-grove/processes` | All execution flows |
| `gitnexus://repo/chia-grove/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
