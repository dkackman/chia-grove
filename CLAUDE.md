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
    ↓ async SafeSearch (image/video-poster spends + periodic sweep; cheap verdict ok, not yet checked) → ContentFlagEvent
Hub + RingBuffer  (server/src/web/)
    ↓ WebSocket (JSON)
GroveFeed  (web/src/net/feed.ts)
    ↓ GroveEvent dispatch
active Visualization  (web/src/themes/)
```

New WebSocket clients first receive a `Hello` handshake (protocol version check), then a `Snapshot` of the last 10,000 events from `RingBuffer`, drained at 120 events/frame by `DrainQueue` (~1.5 s at 60 fps). After that, events stream live as `Batch` messages.

## Deployment

The app deploys to an Ubuntu droplet as a systemd service (`deploy/chia-grove.service`) with Caddy handling SSL termination for `chia-grove.com` and `chia-grove.kackman.net` (`deploy/Caddyfile`). `deploy/deploy.sh <user@host>` syncs the repo and restarts the service.

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
