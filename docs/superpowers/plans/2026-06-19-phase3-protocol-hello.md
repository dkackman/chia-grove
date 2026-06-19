# Phase 3: Protocol `hello` + Client Reload Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The server announces a frozen `hello` handshake (`protocolVersion` + `appVersion`) on connect, and the client reloads once when its baked-in protocol version differs — inoculating the client population before #6 changes the wire format.

**Architecture:** A `PROTOCOL_VERSION` constant in `shared` is the single source of truth, imported by both server and client. The server sends `hello` as the first WebSocket message (before the snapshot). The client compares versions via a pure `protocolAction()` function (unit-tested) and a thin `feed.ts` glue that reloads once, guarded by `sessionStorage`. `index.html` is served `no-cache` so the reload fetches the new bundle. This release is **purely additive** — pre-Phase-3 clients ignore the unknown `hello` and keep working on the v1 wire.

**Tech Stack:** TypeScript, Fastify WebSocket, `@fastify/static`, npm workspaces, Vitest (node env), Node 24.

## Global Constraints

- Node ≥ 24.
- `PROTOCOL_VERSION` lives only in `shared/src/index.ts`; server and client import it (never duplicate the literal).
- The `Hello` message shape is **frozen** — its fields never change, so the guard can always parse it.
- Web tests run in the **node** environment (no DOM); guard logic must be a pure function, not direct `location`/`sessionStorage` access, to be testable.
- This release is additive only: `hello` is a new message type; unknown types are ignored by existing clients. No existing wire message changes. `PROTOCOL_VERSION` stays `1` (the bump to `2` is #6).

## Prerequisite

Phase 3 depends on Phase 2's `server/src/version.ts` (the `hello` `appVersion`). This branch (`feat/phase3-protocol-hello`) is created **off `feat/phase2-versioning-release`** (stacked). Open the PR with base = `feat/phase2-versioning-release`; GitHub auto-retargets it to `main` once PR #5 merges.

## Verification model

- `protocolAction()`, the Hub `hello`, and `/healthz` are unit-tested (TDD).
- The `index.html` `no-cache` header is config that can't be unit-tested without a build (static is only registered when `web/dist` exists); it is verified by code review + the manual check below.
- End-to-end (the guard actually reloading a browser) is exercised when #6 bumps `PROTOCOL_VERSION`; for this phase, confirm `hello` arrives first and `/healthz` reports `protocolVersion`.

---

### Task 1: `PROTOCOL_VERSION` + frozen `Hello` type in shared

**Files:**

- Modify: `shared/src/index.ts`

**Interfaces:**

- Produces: `export const PROTOCOL_VERSION = 1;` and `export interface Hello { type: "hello"; protocolVersion: number; appVersion: string }`, added to `WireMessage`. Consumed by Tasks 2 (Hub), 3 (`/healthz`), 4 (client).

This task is a type/constant definition (no behavior), so it has no standalone test; Tasks 2–4 exercise it. Adding it first lets the later tasks import it.

- [ ] **Step 1: Add the constant and type**

In `shared/src/index.ts`, after the `MediaKind` declarations near the top, add:

```ts
// Bumped only when the WebSocket wire format changes (independent of app
// semver). The server announces it in the frozen `Hello` handshake; the client
// reloads when its baked-in value differs. See docs/superpowers/specs.
export const PROTOCOL_VERSION = 1;
```

Then add the `Hello` interface next to the other message interfaces (e.g. after `ReorgEvent`):

```ts
// Frozen handshake — sent first on every connection. Its shape MUST NOT change
// so that an old client can always parse it and detect a protocol mismatch.
export interface Hello {
  type: "hello";
  protocolVersion: number;
  appVersion: string;
}
```

Finally extend `WireMessage`:

```ts
export type WireMessage = GroveEvent | Snapshot | Hello;
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: clean (exit 0).

- [ ] **Step 3: Commit**

```bash
git add shared/src/index.ts
git commit -m "feat: add PROTOCOL_VERSION and frozen Hello handshake type

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Server sends `hello` first on connect

**Files:**

- Modify: `server/src/web/hub.ts`
- Modify: `server/test/hub.test.ts`
- Modify: `server/src/index.ts` (Hub construction)

**Interfaces:**

- Consumes: `PROTOCOL_VERSION`, `Hello` (Task 1); `readVersion` (Phase 2).
- Produces: `new Hub(buffer, appVersion: string)`; `add()` sends `hello` then the snapshot.

- [ ] **Step 1: Update the Hub tests (failing first)**

In `server/test/hub.test.ts`:

Change `makeHub` to pass an app version:

```ts
function makeHub() {
  return new Hub(new RingBuffer<GroveEvent>(500), "test-version");
}
```

Add a new test after `makeHub`:

```ts
test("first message on connect is the hello handshake", () => {
  const hub = makeHub();
  const socket = new FakeSocket();
  hub.add(socket);
  expect(socket.parsed()[0]).toEqual({
    type: "hello",
    protocolVersion: 1,
    appVersion: "test-version",
  });
});
```

Update the index-shifted assertions (hello is now `[0]`, snapshot `[1]`):

- In "new client receives snapshot...": change `socket.parsed()[0]` to `socket.parsed()[1]`.
- In "publish fans out...": change `a.parsed()[1]` to `a.parsed()[2]` and `b.parsed()[1]` to `b.parsed()[2]`.
- In "slow client skips ambient...": change expected `["snapshot", "block"]` to `["hello", "snapshot", "block"]`.
- In "removed client receives nothing": change `expect(socket.sent).toHaveLength(1)` to `toHaveLength(2)` and the comment to `// just the hello + snapshot`.

- [ ] **Step 2: Run the Hub tests to verify failures**

Run: `npx vitest run server/test/hub.test.ts`
Expected: FAIL — `Hub` constructor takes one arg / no `hello` is sent.

- [ ] **Step 3: Implement `hello` in the Hub**

In `server/src/web/hub.ts`, update the import line:

```ts
import type { AmbientEvent, GroveEvent, Hello } from "@grove/shared";
import { PROTOCOL_VERSION } from "@grove/shared";
```

Add the `appVersion` constructor param:

```ts
  constructor(
    private readonly buffer: RingBuffer<GroveEvent>,
    private readonly appVersion: string
  ) {}
```

In `add()`, send `hello` before the snapshot:

```ts
  add(socket: WireSocket): void {
    if (socket.readyState !== OPEN) return;
    const hello: Hello = {
      type: "hello",
      protocolVersion: PROTOCOL_VERSION,
      appVersion: this.appVersion,
    };
    socket.send(JSON.stringify(hello));
    const events: GroveEvent[] = this.buffer.snapshot();
    if (this.lastAmbient) events.push(this.lastAmbient);
    socket.send(JSON.stringify({ type: "snapshot", events }));
    this.clients.add(socket);
  }
```

- [ ] **Step 4: Update Hub construction in index.ts**

In `server/src/index.ts`, change:

```ts
const hub = new Hub(new RingBuffer<GroveEvent>(10000));
```

to:

```ts
const hub = new Hub(new RingBuffer<GroveEvent>(10000), readVersion().appVersion);
```

(`readVersion` is already imported from Phase 2.)

- [ ] **Step 5: Run the Hub tests + typecheck**

Run: `npx vitest run server/test/hub.test.ts && npm run typecheck`
Expected: all Hub tests pass; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add server/src/web/hub.ts server/test/hub.test.ts server/src/index.ts
git commit -m "feat: send protocol hello as first message on ws connect

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: `/healthz` reports `protocolVersion`

**Files:**

- Modify: `server/src/web/server.ts`
- Modify: `server/test/server.test.ts`

**Interfaces:**

- Consumes: `PROTOCOL_VERSION` (Task 1).
- Produces: `/healthz` → `{ ok, appVersion, gitSha, protocolVersion }`.

- [ ] **Step 1: Update the healthz test (failing first)**

In `server/test/server.test.ts`, change the assertion to:

```ts
expect(res.json()).toEqual({
  ok: true,
  appVersion: "dev",
  gitSha: "",
  protocolVersion: 1,
});
```

Run: `npx vitest run server/test/server.test.ts`
Expected: FAIL — handler does not include `protocolVersion`.

- [ ] **Step 2: Add `protocolVersion` to the handler**

In `server/src/web/server.ts`, add to the imports:

```ts
import { PROTOCOL_VERSION } from "@grove/shared";
```

Update the `/healthz` handler to include it:

```ts
const version = readVersion();
app.get("/healthz", async () => ({
  ok: true,
  appVersion: version.appVersion,
  gitSha: version.gitSha,
  protocolVersion: PROTOCOL_VERSION,
}));
```

Run: `npx vitest run server/test/server.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add server/src/web/server.ts server/test/server.test.ts
git commit -m "feat: report protocolVersion at /healthz

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Client protocol guard

**Files:**

- Create: `web/src/net/protocol-guard.ts`
- Create: `web/test/protocol-guard.test.ts`
- Modify: `web/src/net/feed.ts`

**Interfaces:**

- Produces: `protocolAction(server: number, client: number, alreadyReloaded: boolean): "reload" | "clear" | "none"` — the pure decision consumed by `feed.ts`.

- [ ] **Step 1: Write the failing tests for the pure decision**

Create `web/test/protocol-guard.test.ts`:

```ts
import { expect, test } from "vitest";
import { protocolAction } from "../src/net/protocol-guard.js";

test("matching versions clear the reload guard", () => {
  expect(protocolAction(1, 1, false)).toBe("clear");
  expect(protocolAction(1, 1, true)).toBe("clear");
});

test("mismatch triggers a reload when not yet reloaded", () => {
  expect(protocolAction(2, 1, false)).toBe("reload");
});

test("mismatch does nothing if already reloaded (no loop)", () => {
  expect(protocolAction(2, 1, true)).toBe("none");
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run web/test/protocol-guard.test.ts`
Expected: FAIL — cannot resolve `../src/net/protocol-guard.js`.

- [ ] **Step 3: Implement the pure decision**

Create `web/src/net/protocol-guard.ts`:

```ts
export type ProtocolAction = "reload" | "clear" | "none";

/**
 * Decide what a client should do when the server announces its protocol
 * version. Pure so it is unit-testable in the node test environment; feed.ts
 * supplies the sessionStorage/location side effects.
 *
 * - versions match  -> "clear" the once-per-session reload guard
 * - mismatch, fresh -> "reload" once to pick up a matching bundle
 * - mismatch, already reloaded -> "none" (prevents a reload loop on a stale cache)
 */
export function protocolAction(
  serverProtocol: number,
  clientProtocol: number,
  alreadyReloaded: boolean
): ProtocolAction {
  if (serverProtocol === clientProtocol) return "clear";
  return alreadyReloaded ? "none" : "reload";
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run web/test/protocol-guard.test.ts`
Expected: PASS (3 passed).

- [ ] **Step 5: Wire the guard into feed.ts**

In `web/src/net/feed.ts`, update the shared import to also pull the constant:

```ts
import type { GroveEvent, WireMessage } from "@grove/shared";
import { PROTOCOL_VERSION } from "@grove/shared";
import { protocolAction } from "./protocol-guard.js";
import { startDemo } from "./demo.js";
```

Add a module-level constant near the other constants (after `SNAPSHOT_REPLAY_MS`):

```ts
const RELOAD_KEY = "grove.proto-reloaded";
```

In the `onmessage` handler, handle `hello` before snapshot/dispatch. Replace:

```ts
const parsed = JSON.parse(message.data as string) as WireMessage;
if (parsed.type === "snapshot") this.replay(parsed.events);
else this.dispatch(parsed);
```

with:

```ts
const parsed = JSON.parse(message.data as string) as WireMessage;
if (parsed.type === "hello") this.handleHello(parsed.protocolVersion);
else if (parsed.type === "snapshot") this.replay(parsed.events);
else this.dispatch(parsed);
```

Add the `handleHello` method (e.g. after `dispatch`):

```ts
  /** Reload once if the server's protocol differs from this bundle's. */
  private handleHello(serverProtocol: number): void {
    const already = sessionStorage.getItem(RELOAD_KEY) === "1";
    switch (protocolAction(serverProtocol, PROTOCOL_VERSION, already)) {
      case "reload":
        sessionStorage.setItem(RELOAD_KEY, "1");
        location.reload();
        break;
      case "clear":
        sessionStorage.removeItem(RELOAD_KEY);
        break;
      case "none":
        break;
    }
  }
```

- [ ] **Step 6: Run the web suite + typecheck + build**

Run: `npx vitest run web/ && npm run typecheck && npm run build`
Expected: web tests pass (incl. the 3 new); typecheck clean; build succeeds.

- [ ] **Step 7: Commit**

```bash
git add web/src/net/protocol-guard.ts web/test/protocol-guard.test.ts web/src/net/feed.ts
git commit -m "feat: client reloads once on protocol-version mismatch

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Serve `index.html` no-cache (reload guard prerequisite)

**Files:**

- Modify: `server/src/web/server.ts`

**Interfaces:** none (HTTP cache header only).

Context: confirmed there is **no service worker** in the app (no `serviceWorker`/`workbox` registration in `web/src` or `index.html`), so the only caching concern is the HTML entry document. Vite content-hashes JS/CSS filenames (safe to cache), but `index.html` must not be cached or a reload could re-serve a stale entry referencing old bundles.

- [ ] **Step 1: Add a no-cache header for HTML to the static handler**

In `server/src/web/server.ts`, update the `fastifyStatic` registration:

```ts
await app.register(fastifyStatic, {
  root: dist,
  setHeaders(res, filePath) {
    if (filePath.endsWith(".html")) {
      res.setHeader("Cache-Control", "no-cache");
    }
  },
});
```

- [ ] **Step 2: Typecheck + full server suite**

Run: `npm run typecheck && npx vitest run server/`
Expected: clean; all server tests pass (the existing `/healthz` test is unaffected; static is only registered when `web/dist` exists, which it does not in the test env).

- [ ] **Step 3: Manual verification note (post-deploy)**

After Phase 2/3 deploy, confirm:

```bash
curl -sI https://chia-grove.com/ | grep -i cache-control   # expect: no-cache
curl -s  https://chia-grove.com/healthz                     # includes "protocolVersion":1
```

(Record this in the PR description; it cannot be checked locally without a build + static mount.)

- [ ] **Step 4: Commit**

```bash
git add server/src/web/server.ts
git commit -m "build: serve index.html no-cache so reloads pick up new bundles

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage (Phase 3 section of the foundation spec):**

- "`PROTOCOL_VERSION = 1` + frozen `Hello` type in shared; add to `WireMessage`" → Task 1. ✓
- "Server sends `hello` first on connect, before snapshot, with PROTOCOL_VERSION + appVersion" → Task 2. ✓
- "Client compares protocolVersion; mismatch → reload once (sessionStorage guard); match → clear; unknown types ignored" → Task 4 (`protocolAction` + `handleHello`). ✓
- "appVersion in hello for display/logging; guard keys on protocolVersion" → Task 2 (appVersion carried), Task 4 (guard uses protocolVersion only). ✓
- "Caching guard: index.html no-cache; verify no SW" → Task 5 (no SW confirmed; no-cache added). ✓
- "protocolVersion added to /healthz in Phase 3" → Task 3. ✓
- "purely additive, zero skew at its own deploy" → `hello` is new; existing messages unchanged; PROTOCOL_VERSION stays 1. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full content; every command has expected output. ✓

**Type/name consistency:** `PROTOCOL_VERSION`/`Hello` defined in Task 1, imported identically in Tasks 2–4; `Hub(buffer, appVersion)` defined in Task 2 and constructed that way in index.ts; `protocolAction(server, client, alreadyReloaded)` defined in Task 4 Step 3 and called with that arg order in Step 5; `RELOAD_KEY` constant used consistently in `handleHello`. ✓

**Deferred to #6 (correctly out of scope):** the `Batch` message type, the frame-budgeted drain queue, and the `PROTOCOL_VERSION → 2` bump. None appear here.
