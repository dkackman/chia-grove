# CI/CD, Versioning & Protocol-Version Foundation — Design

**Date:** 2026-06-18
**Status:** Approved (pending written-spec review)
**Follow-on:** #6 WebSocket event batching (separate spec) lands after this foundation soaks.

## Motivation

The original task (#6) batches WebSocket events into one message per block and
adds a frame-budgeted client drain. That change alters the wire format, which
raised the question: how do already-connected clients survive a wire-format
change? Browsers can't hot-swap a loaded JS bundle, so a tab open across such a
deploy will reconnect to the new server, still render the (unchanged) reconnect
snapshot, then silently drop the new message type and _appear_ live while frozen
until reload.

Rather than special-case #6, we build the foundation that makes #6 — and every
future breaking change — land as a normal versioned release:

1. A CI gate so nothing untested reaches a release.
2. Application versioning + tag-triggered automated deploy.
3. A protocol-version handshake + client reload guard that **inoculates the
   client population** ahead of any wire change.

### The inoculation insight

Shipping the protocol guard as its own release _before_ #6 is the whole point:

- **This foundation release** adds an additive `hello` handshake carrying
  `protocolVersion: 1`. Old tabs receive an unknown message type, ignore it, and
  keep working on the unchanged v1 wire. **Zero skew at this deploy.** But every
  client loaded from this release onward now carries the reload guard.
- **The later #6 release** bumps `protocolVersion → 2`. Every client loaded
  since the foundation release sees `2 ≠ 1` on reconnect and reloads into the new
  bundle. Clean.

The one unavoidable limit: tabs open from _before_ the foundation release still
freeze at the #6 deploy (they predate the guard). Letting the foundation soak
shrinks that population to near zero — which is exactly why we do it first.

## Goals

- Every PR and push to `main` is gated by lint + typecheck + test + build.
- Tagging `v<semver>` deploys that exact commit to the droplet automatically.
- The running app reports its version and protocol version for verification.
- A frozen protocol handshake + a once-per-session client reload guard.
- Reconcile and document the Caddy config so repo/droplet drift stops being
  tribal knowledge.

## Non-goals

- npm registry publishing — the three workspaces stay private; "publish" means
  deploy to the droplet.
- Containerization (Docker/GHCR) — keep the systemd + `tsx` runtime.
- Atomic release directories / capistrano-style symlink swaps — in-place rsync
  is retained; revisit only if downtime becomes a problem.
- Folding Caddy config into the release workflow — Caddy stays a manual infra
  step (keeps the deploy user's sudo scoped to a single command).
- Implementing #6 batching itself — separate spec.

## Locked decisions (from brainstorming)

| Decision                          | Choice                                           |
| --------------------------------- | ------------------------------------------------ |
| Client consumption model (for #6) | Unified frame-budgeted drain queue               |
| Publish target                    | Automated SSH/rsync deploy to droplet on tag     |
| Deploy atomicity                  | In-place rsync (as today)                        |
| Scope before #6                   | Full foundation (Phases 1–3), then #6            |
| Version source of truth           | Git tag; injected at build via `version.json`    |
| Server version plumbing           | `version.json` read at startup (not systemd env) |
| SSH transport                     | Port 22 SSH, as deploys work today               |
| Caddy config management           | Manual infra step, documented + reconciled       |

## Current state (verified)

- npm workspaces monorepo (`shared`, `server`, `web`); all private, `0.0.0`;
  root `package.json` has no `version`.
- No `.github/` — zero CI today.
- Deploy today: `deploy/deploy.sh user@host` builds locally, `rsync -az --delete`
  (excludes `node_modules`, `.git`, `.superpowers`) to `/opt/chia-grove`, then
  `npm install --omit=dev` + `sudo systemctl restart chia-grove` over SSH.
- Server runs via `tsx src/index.ts` (no compile step) under systemd
  (`User=grove`, `Restart=always`).
- `chia-wallet-sdk` is a **native NAPI module** — its platform binary must be
  installed on the droplet, which is why `node_modules` is excluded from rsync
  and deps install on the target.
- Caddy (apt package) reverse-proxies `:8080`, terminates TLS, and sets CSP.
  `deploy/infra/server-setup.sh` opens ufw 80+443 and writes a **placeholder**
  `/etc/caddy/Caddyfile` (only `chia-grove.kackman.net`, no headers); the repo's
  `deploy/Caddyfile` is the intended config (`chia-grove.com` + redirect + CSP)
  but is **not** applied by any deploy. Live config was hand-edited out-of-band.

## Phase 1 — CI gate

**File:** `.github/workflows/ci.yml`

- **Triggers:** `pull_request`; `push` to `main`.
- **Job** (`ubuntu-latest`, `actions/setup-node@v4` with `node-version: 24`, npm
  cache): `npm ci` → `npm run lint` → `npm run typecheck` → `npm test` →
  `npm run build`. Single sequential job; the build step proves the Vite bundle
  compiles.
- **Branch protection:** require this check before merging to `main`. This is a
  GitHub repo setting, applied manually and noted in the deploy docs (cannot be
  set from code).

Standalone and zero runtime risk; shippable on its own.

## Phase 2 — Versioning + tag-triggered deploy

**Files:** `.github/workflows/release.yml`, adapted `deploy/deploy.sh`,
new `version.json` (generated at deploy time), `/healthz` extension.

- **Source of truth: the git tag.** No `version` field maintained in
  `package.json`. The workflow validates `${GITHUB_REF_NAME}` matches
  `v<semver>` and derives the version from it.
- **Build stamping:** the workflow writes a repo-root `version.json`:
  `{ "appVersion": "1.2.0", "gitSha": "<sha>", "builtAt": "<iso8601>" }`.
  - Client: Vite `define` exposes `__APP_VERSION__` (and `__GIT_SHA__`) baked into
    the bundle.
  - Server: reads `version.json` at startup.
  - **Dev fallback:** `version.json` is generated only by the release workflow,
    so it is absent in local dev and in manual `deploy.sh` runs. Both client and
    server fall back to a `"dev"` sentinel (`appVersion: "dev"`, empty `gitSha`)
    when the value is missing — never crash on its absence. `version.json` is
    git-ignored.
- **`/healthz`** returns `{ ok: true, appVersion, gitSha, protocolVersion }` so a
  deploy can be curl-verified.
- **Deploy flow on tag `v*`:** checkout → node 24 → `npm ci` → gates
  (lint/typecheck/test) → `npm run build` on the runner → write `version.json` →
  SSH/rsync to droplet → `npm ci --omit=dev` **on the droplet** → `sudo
systemctl restart chia-grove`.
  - `node_modules` stays excluded from rsync (native binary resolves on target).
  - `npm install` → **`npm ci`** for deterministic, lockfile-pinned installs
    (both on the runner and the droplet).
- **Secrets:** `SSH_PRIVATE_KEY`, `DEPLOY_HOST` (e.g. `grove@157.230.15.201`),
  `SSH_KNOWN_HOSTS`. The deploy user already has `NOPASSWD` sudo scoped to only
  `systemctl restart chia-grove` (`/etc/sudoers.d/chia-grove`) — unchanged.
- `deploy/deploy.sh` remains usable for manual deploys; it and the workflow
  share the same rsync+restart logic (host/user parameterized).

## Phase 3 — Protocol `hello` + client reload guard

**Files:** `shared/src/index.ts`, `server/src/web/hub.ts`,
`web/src/net/feed.ts`, static-asset cache headers (`server/src/web/server.ts`).

- **`shared/src`:** add `export const PROTOCOL_VERSION = 1;` and a **frozen**
  message type whose shape must never change, then add `Hello` to `WireMessage`:

  ```ts
  export interface Hello {
    type: "hello";
    protocolVersion: number;
    appVersion: string;
  }
  ```

- **Server (`Hub.add`):** send `hello` as the **first** message on a new
  connection, before the snapshot, carrying `PROTOCOL_VERSION` and the server's
  `appVersion` (from `version.json`).
- **Client (`GroveFeed`):** handle `hello` specially (not dispatched to theme
  listeners — it's a control message). Compare `hello.protocolVersion` to the
  baked-in `PROTOCOL_VERSION`:
  - **Mismatch →** `location.reload()` exactly once, guarded by a
    `sessionStorage` flag (`grove.proto-reloaded`) to prevent reload loops if a
    stale bundle keeps mismatching; append a cache-busting query on reload.
  - **Match →** clear the guard flag.
  - Unknown message types remain ignored, so this release is **purely additive**
    and causes no skew at its own deploy.
- **Caching guard:** ensure `index.html` is served `Cache-Control: no-cache` so a
  reload always re-fetches the current entry document (Vite content-hashes JS/CSS
  filenames, so only the HTML entry matters). Verify no service worker is
  actively caching before relying on reload (a past Workbox concern was a false
  alarm — confirm, don't assume).
- `appVersion` is included in `hello` for display/logging; the guard keys only on
  `protocolVersion` (the compatibility contract), which is orthogonal to app
  semver.

## Caddy / certs (out of scope, documented)

- **Certs are fully automatic and orthogonal to deploys.** Caddy provisions and
  renews Let's Encrypt certs via ACME on first request to each configured domain;
  ufw already allows 80+443. Certs + the ACME account key persist in Caddy's data
  dir (`/var/lib/caddy/.local/share/caddy/`), untouched by app rsync/restart.
  Nothing in the pipeline manages certs.
- **Action item:** reconcile `deploy/Caddyfile` (intended: `chia-grove.com` +
  `kackman.net` redirect + CSP/security headers) with the live config, and
  document the manual apply step (`scp deploy/Caddyfile → /etc/caddy/Caddyfile &&
systemctl reload caddy`). The release workflow does **not** touch Caddy, so the
  deploy user's sudo scope stays minimal.

## Testing strategy

- **Phase 1:** the workflow is its own verification (gates must pass on a PR).
- **Phase 2:** `version.json` parsing + `/healthz` payload covered by a server
  test; the workflow validated on a throwaway tag (or `act` locally if feasible).
- **Phase 3 (TDD):**
  - Hub emits `hello` as the first message on connect, before the snapshot.
  - `hello.protocolVersion` carries `PROTOCOL_VERSION`; `appVersion` populated.
  - Feed reloads exactly once on version mismatch, never on match, and does not
    loop (sessionStorage guard honored). Reload is injected (not a real
    `location.reload`) so it's unit-testable.
  - Old-client tolerance: an unknown message type is ignored without error.

## Sequencing

1. **Phase 1 — CI gate.** Ship immediately; no runtime risk.
2. **Phase 2 — versioning + `release.yml`.** Replaces manual deploy; verify via
   `/healthz`.
3. **Phase 3 — protocol `hello` + guard (`PROTOCOL_VERSION = 1`).** Additive,
   zero-skew; **let it soak** so the client population picks up the guard.
4. **#6 — event batching, `PROTOCOL_VERSION → 2`.** Separate spec; lands as a
   normal versioned release with clean client auto-reload.

Each phase is an independent spec → plan → release cycle; Phases 1–3 are grouped
here because they share the versioning/protocol decisions.

## Pitfalls & mitigations

- **Native NAPI module** (`chia-wallet-sdk`): never ship `node_modules` from the
  runner; install prod deps on the droplet. (Retained.)
- **Non-deterministic installs:** use `npm ci`, not `npm install`.
- **Reload loop + stale cache:** once-per-session guard + cache-busting query +
  `no-cache` on `index.html` + confirm no caching SW.
- **Non-atomic deploy + restart downtime:** brief refused-connection window
  while the new process starts (`cats.start()` Dexie fetch + backfill); clients
  reconnect via existing backoff. Accepted for an ambient app.
- **`tsx` in prod = server never compiled:** the CI `typecheck` gate is the only
  thing catching server type errors before a tag ships.
- **Runner → droplet SSH:** port 22 reachable as today; key-only auth via
  secrets. Deploy user sudo stays scoped to the single restart command.
- **Caddyfile drift:** reconciled and documented (above); not auto-applied.
